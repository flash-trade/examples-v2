// ─────────────────────────────────────────────────────────────────────────────
// lib/use-market-rounds.ts — the prediction-market settlement engine.
//
// Makes the "by <timeframe>" honest: a bet is a capped-loss perp + bundled TP, so
// it resolves ON-CHAIN by itself when the strike is hit (WIN) or it liquidates
// (LOSE). But a bet that does NEITHER by its deadline would otherwise ride forever
// (and bleed borrow fees) — so at expiry we CLOSE it at mark, exactly like the
// proven Updown settleRound (lib/components/app.tsx). Reconciliation is on OBSERVED
// state (snapshot + clock), never a bare timer; an in-flight set + "settling"
// status guard double-close. Rounds are a CACHE — chain positions are the truth.
//
// SEPARATE store namespace from the Updown app (a shared key would cross-
// contaminate reconciliation). Chain truth always wins over the cache.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assertNoErr, type BasketSnapshot } from "flash-v2";
import { flash } from "./flash";
import { computePositionView } from "./format";
import type { ActiveSigner } from "./signer";
import {
  loadRounds,
  positionFor,
  reconcile,
  saveRounds,
  withResult,
  withStatus,
  type Round,
} from "./rounds";

/** localStorage namespace for /markets bets — distinct from the Updown app. */
const STORE_PREFIX = "predict-markets";
const SETTLE_RETRY_MS = 8_000;

export interface MarketRounds {
  rounds: Round[];
  /** monotonic 1s clock for countdowns + expiry. */
  now: number;
  addRound: (round: Round) => void;
  settleNow: (round: Round) => void;
}

export function useMarketRounds(
  owner: string | null,
  snapshot: BasketSnapshot | null,
  signer: ActiveSigner | null,
): MarketRounds {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const loadedFor = useRef<string | null>(null);
  const inflight = useRef<Set<string>>(new Set());
  const retryAt = useRef<Map<string, number>>(new Map());
  const resolving = useRef<Set<string>>(new Set());

  // Load this owner's bets; persist on every change (only after the load landed,
  // so we never stomp stored rounds with the empty initial state).
  useEffect(() => {
    // Wallet switch: drop cross-owner in-flight / backoff / resolving state so a
    // prior owner's ids can't suppress the new owner's settlement (review M3).
    inflight.current.clear();
    retryAt.current.clear();
    resolving.current.clear();
    if (owner) {
      // A round persisted as "settling" means a close was dispatched but the tab
      // closed before it confirmed (the in-flight guard is gone). Demote it to
      // "active" so reconciliation re-drives it from chain truth (review C2).
      setRounds(loadRounds(owner, STORE_PREFIX).map((r) => (r.status === "settling" ? { ...r, status: "active" as const } : r)));
      loadedFor.current = owner;
    } else {
      setRounds([]);
      loadedFor.current = null;
    }
  }, [owner]);

  useEffect(() => {
    if (owner && loadedFor.current === owner) saveRounds(owner, rounds, STORE_PREFIX);
  }, [owner, rounds]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const addRound = useCallback((round: Round) => setRounds((rs) => [round, ...rs]), []);

  // Score a position that VANISHED on-chain (its take-profit fired = WIN, or it
  // liquidated = LOSE). The exact realized amount is on-chain; we infer win/lose
  // from the live mark vs the strike, ONCE per round. CRITICAL: on a failed price
  // fetch we DO NOT resolve (return so a later tick retries) — branding a winner a
  // total loss because one price GET failed is the worst outcome (review C1/C2).
  // NOTE (documented residual): a sharp reversal between the vanish and this poll
  // can still misread win↔lose; the exact realized PnL is the on-chain receipt.
  const resolveVanished = useCallback(async (round: Round) => {
    if (resolving.current.has(round.id)) return;
    resolving.current.add(round.id);
    const mark = await flash.price(round.market).then((p) => p.priceUi).catch(() => null);
    if (mark == null || !Number.isFinite(mark)) {
      resolving.current.delete(round.id); // no guess on a bad fetch — retry next tick
      return;
    }
    const strike = round.strike ?? round.quote.entryPrice;
    const won = round.side === "LONG" ? mark >= strike * 0.999 : mark <= strike * 1.001;
    const pnlUsd = won ? (round.winProfitUsd ?? 0) : -round.stakeUsd;
    setRounds((rs) => withResult(rs, round.id, { pnlUsd, won, settledAt: Date.now() }));
  }, []);

  // Close a still-open position at mark (expiry). Explicit FULL close ("0" — the
  // 97% trap never applies); the result is the PnL the user was watching.
  const settleRound = useCallback(
    async (round: Round) => {
      if (inflight.current.has(round.id) || !signer) return;
      if (Date.now() < (retryAt.current.get(round.id) ?? 0)) return;
      inflight.current.add(round.id);
      // If the position is already GONE (TP/liq fired, or a prior timed-out close
      // finally landed), don't fire a close against nothing — resolve it as
      // vanished. This also stops a timeout-retry from double-closing (review H2).
      const metrics = snapshot ? positionFor(snapshot, round.market, round.side) : undefined;
      if (!metrics) {
        inflight.current.delete(round.id);
        setRounds((rs) => rs.map((r) => (r.id === round.id ? { ...r, status: "closed-elsewhere" as const } : r)));
        void resolveVanished(round);
        return;
      }
      setRounds((rs) => withStatus(rs, round.id, "settling"));
      try {
        const mark = await flash.price(round.market).then((p) => p.priceUi).catch(() => null);
        const view = computePositionView(metrics, mark ?? Number(metrics.entryPriceUi));
        const res = await flash.closePosition({
          marketSymbol: round.market,
          side: round.side,
          inputUsdUi: "0",
          withdrawTokenSymbol: "USDC",
          owner: signer.owner,
          slippagePercentage: "1",
          ...signer.tradeFields,
        });
        assertNoErr("close-position", res);
        if (!res.transactionBase64) throw new Error(res.err ?? "no transaction returned");
        const sent = await signer.sendTrade(res.transactionBase64);
        const pnlUsd = view?.pnlUsd ?? 0;
        setRounds((rs) => withResult(rs, round.id, { pnlUsd, won: pnlUsd > 0, settledAt: Date.now(), signature: sent.signature }));
      } catch (e) {
        retryAt.current.set(round.id, Date.now() + SETTLE_RETRY_MS);
        const gone = /Position is empty/i.test(e instanceof Error ? e.message : String(e));
        if (gone) {
          // Already closed (TP/liq landed). Flip + SCORE it — never leave a
          // resultless round that vanishes from the UI (review H4).
          setRounds((rs) => rs.map((r) => (r.id === round.id ? { ...r, status: "closed-elsewhere" as const } : r)));
          void resolveVanished(round);
        } else {
          setRounds((rs) => withStatus(rs, round.id, "active"));
        }
      } finally {
        inflight.current.delete(round.id);
      }
    },
    [signer, snapshot, resolveVanished],
  );

  const recon = useMemo(() => reconcile(rounds, snapshot, now), [rounds, snapshot, now]);

  // Expired but still open → settle at mark.
  useEffect(() => {
    for (const r of recon.toSettle) void settleRound(r);
  }, [recon, settleRound]);

  // Vanished without our close → score it (retry-safe win/lose inference).
  useEffect(() => {
    for (const r of recon.closedElsewhere) void resolveVanished(r);
  }, [recon, resolveVanished]);

  return { rounds, now, addRound, settleNow: (r) => void settleRound(r) };
}
