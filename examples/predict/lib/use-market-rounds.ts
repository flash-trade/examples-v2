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

  // Load this owner's bets; persist on every change (only after the load landed,
  // so we never stomp stored rounds with the empty initial state).
  useEffect(() => {
    if (owner) {
      setRounds(loadRounds(owner, STORE_PREFIX));
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

  const inflight = useRef<Set<string>>(new Set());
  const retryAt = useRef<Map<string, number>>(new Map());

  // Close a still-open position at mark (expiry). Explicit FULL close ("0" — the
  // 97% trap never applies); the result is the PnL the user was watching.
  const settleRound = useCallback(
    async (round: Round) => {
      if (inflight.current.has(round.id) || !signer) return;
      if (Date.now() < (retryAt.current.get(round.id) ?? 0)) return;
      inflight.current.add(round.id);
      setRounds((rs) => withStatus(rs, round.id, "settling"));
      try {
        const metrics = snapshot ? positionFor(snapshot, round.market, round.side) : undefined;
        const mark = await flash.price(round.market).then((p) => p.priceUi).catch(() => null);
        const view = metrics ? computePositionView(metrics, mark ?? Number(metrics.entryPriceUi)) : null;
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
        setRounds((rs) =>
          gone
            ? rs.map((r) => (r.id === round.id ? { ...r, status: "closed-elsewhere" as const } : r))
            : withStatus(rs, round.id, "active"),
        );
      } finally {
        inflight.current.delete(round.id);
      }
    },
    [signer, snapshot],
  );

  const recon = useMemo(() => reconcile(rounds, snapshot, now), [rounds, snapshot, now]);

  // Expired but still open → settle at mark.
  useEffect(() => {
    for (const r of recon.toSettle) void settleRound(r);
  }, [recon, settleRound]);

  // Vanished without our close → the take-profit fired (WIN) or it liquidated
  // (LOSE). Infer from the live mark vs the strike, ONCE per round. The exact
  // realized amount is on-chain; this scores the card (win uses the reconciled
  // win-profit, loss is the capped −stake).
  const resolving = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const r of recon.closedElsewhere) {
      if (resolving.current.has(r.id)) continue;
      resolving.current.add(r.id);
      void (async () => {
        const mark = await flash.price(r.market).then((p) => p.priceUi).catch(() => null);
        const strike = r.strike ?? r.quote.entryPrice;
        const won = mark != null && (r.side === "LONG" ? mark >= strike * 0.999 : mark <= strike * 1.001);
        const pnlUsd = won ? (r.winProfitUsd ?? 0) : -r.stakeUsd;
        setRounds((rs) => withResult(rs, r.id, { pnlUsd, won, settledAt: Date.now() }));
      })();
    }
  }, [recon]);

  return { rounds, now, addRound, settleNow: (r) => void settleRound(r) };
}
