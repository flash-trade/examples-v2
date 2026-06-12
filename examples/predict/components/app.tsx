// ─────────────────────────────────────────────────────────────────────────────
// components/app.tsx — the orchestrator: providers, session, rounds, and the
// settlement watcher. THE HARD PART: settlement is driven by OBSERVED state
// (snapshot + shared clock), guarded three ways against double-close —
// "settling" status, an in-flight ref, and a retry backoff. The settled PnL
// shown is the same client-side mark-price number the user watched live
// (GOTCHAS §20) — never the indexer's, never a raw-unit guess.
// GOTCHAS.md → "Two chains, one flow" · "The 97% full-close threshold"
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConnectionProvider, WalletProvider, useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { assertNoErr } from "flash-v2";

import { ClockProvider, useClock } from "@/lib/clock";
import { APP_NAME, TAGLINE, calmError } from "@/lib/copy";
import { enableOneClickTrading, type EnableState, type EnableWalletCtx } from "@/lib/enable";
import { flash, baseConnection } from "@/lib/flash";
import { depositUsdc, executeWithdrawalStep, withdrawUsdc, type FundsStep } from "@/lib/funds";
import { computePositionView } from "@/lib/format";
import { useBalances, useBasketBalance, useLatencyLog, useMarketLimits, useMarkets, usePrice, useUsdcMint } from "@/lib/hooks";
import { lockedQuoteFrom, timeframe, type LockedQuote, type TimeframeId } from "@/lib/payoff";
import {
  adoptOrphan, loadRounds, newRoundId, pendingAcks, positionFor, reconcile, roundStats, saveRounds, withAck, withResult, withStatus,
  type Round, type Side,
} from "@/lib/rounds";
import { loadSession, revokeSession, type LoadedSession } from "@/lib/session";
import { makeSessionSigner } from "@/lib/signer";
import { StreamProvider, useStream } from "@/lib/stream";

import { ActiveRound } from "./active-round";
import { EnableSheet } from "./enable-sheet";
import { FundsSheet } from "./funds-sheet";
import { History } from "./history";
import { MechanicsDisclosure } from "./mechanics-disclosure";
import { PriceChart } from "./price-chart";
import { SettleCard } from "./settle-card";
import { StatsStrip } from "./stats-strip";
import { Ticket, type TicketPhase } from "./ticket";
import { WalletBar } from "./wallet-bar";

const DISCLOSURE_ACK_KEY = "predict-disclosure-ack";
const SETTLE_RETRY_MS = 10_000;

/** The ambient radial's tint — the one sanctioned document mutation. */
const setMood = (mood: "up" | "down") => {
  document.body.dataset.mood = mood;
};

export function App() {
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={flash.network.baseRpc}>
      <WalletProvider wallets={wallets} autoConnect>
        <ClockProvider>
          <Shell />
        </ClockProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

function Shell() {
  const { publicKey } = useWallet();
  const owner = publicKey ? publicKey.toBase58() : null;
  return (
    <StreamProvider owner={owner}>
      <Inner owner={owner} />
    </StreamProvider>
  );
}

function Inner({ owner }: { owner: string | null }) {
  const walletCtx = useWallet();
  const anchorWallet = useAnchorWallet();
  const { snapshot, loaded } = useStream();
  const now = useClock();
  const latency = useLatencyLog();

  // ── market + ticket state ──────────────────────────────────────────────────
  const markets = useMarkets();
  const [market, setMarket] = useState("SOL");
  const [side, setSide] = useState<Side>("LONG");
  const [timeframeId, setTimeframeId] = useState<TimeframeId>("5m");
  const [stake, setStake] = useState("11");
  const { price } = usePrice(market, 1000);
  const limits = useMarketLimits(market);

  const profileLev = timeframe(timeframeId).leverage;
  const leverage = useMemo(() => {
    if (!limits) return profileLev;
    const max = limits.maxLeverage > 0 ? limits.maxLeverage : profileLev;
    const min = limits.minLeverage > 0 ? limits.minLeverage : 1;
    return Math.max(min, Math.min(profileLev, max));
  }, [limits, profileLev]);

  // ── balances ───────────────────────────────────────────────────────────────
  const usdcMint = useUsdcMint();
  const balances = useBalances(owner, usdcMint);
  const basket = useBasketBalance(owner, snapshot?.basketPubkey ?? null, usdcMint);
  const inBasketUsd = basket.bal?.inBasketUsd ?? null;

  // ── session ────────────────────────────────────────────────────────────────
  const [session, setSession] = useState<LoadedSession | null>(null);
  useEffect(() => {
    setSession(owner ? loadSession(owner) : null);
  }, [owner]);
  const signer = useMemo(
    () => (session && anchorWallet ? makeSessionSigner(anchorWallet, session, flash.network) : null),
    [session, anchorWallet],
  );

  // ── rounds (chain is truth; this is the cache) ─────────────────────────────
  const [rounds, setRounds] = useState<Round[]>([]);
  const prevSaved = useRef<Round[] | null>(null);
  useEffect(() => {
    const loadedRounds = owner ? loadRounds(owner) : [];
    setRounds(loadedRounds);
    prevSaved.current = loadedRounds;
  }, [owner]);
  useEffect(() => {
    if (!owner) return;
    if (prevSaved.current !== rounds) {
      saveRounds(owner, rounds);
      prevSaved.current = rounds;
    }
  }, [owner, rounds]);

  // ── toasts (calm copy only) ────────────────────────────────────────────────
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  }, []);

  // ── settlement engine ──────────────────────────────────────────────────────
  const inflight = useRef<Set<string>>(new Set());
  const retryAt = useRef<Map<string, number>>(new Map());

  const settleRound = useCallback(
    async (round: Round) => {
      if (inflight.current.has(round.id)) return;
      if (!signer) {
        say("Your session key needs a refresh — re-enable one-tap rounds to settle.");
        return;
      }
      const due = retryAt.current.get(round.id) ?? 0;
      if (Date.now() < due) return;
      inflight.current.add(round.id);
      setRounds((rs) => withStatus(rs, round.id, "settling"));
      try {
        // The PnL the user watched is the PnL they settle with (GOTCHAS §20) —
        // priced at the round's OWN market, fetched at settle time.
        const metrics = snapshot ? positionFor(snapshot, round.market, round.side) : undefined;
        const mark = await flash.price(round.market).then((p) => p.priceUi).catch(() => null);
        const view = metrics ? computePositionView(metrics, mark ?? Number(metrics.entryPriceUi)) : null;

        const res = await flash.closePosition({
          marketSymbol: round.market,
          side: round.side,
          inputUsdUi: "0", // explicit FULL close — the 97% trap never applies
          withdrawTokenSymbol: "USDC",
          owner: signer.owner,
          slippagePercentage: "1",
          ...signer.tradeFields,
        });
        assertNoErr("close-position", res);
        if (!res.transactionBase64) throw new Error(res.err ?? "no transaction returned");
        const sent = await signer.sendTrade(res.transactionBase64);
        latency.add({ action: `settle ${round.market}`, chain: "er", ms: sent.confirmMs, sendMs: sent.sendMs, signature: sent.signature });

        const pnlUsd = view?.pnlUsd ?? 0;
        setRounds((rs) =>
          withResult(rs, round.id, { pnlUsd, won: pnlUsd > 0, settledAt: Date.now(), signature: sent.signature }),
        );
        setMood(pnlUsd > 0 ? "up" : "down");
        void basket.refresh();
      } catch (e) {
        console.error("[settle]", e);
        retryAt.current.set(round.id, Date.now() + SETTLE_RETRY_MS);
        const gone = /Position is empty/i.test(e instanceof Error ? e.message : String(e));
        setRounds((rs) =>
          gone
            ? rs.map((r) => (r.id === round.id ? { ...r, status: "closed-elsewhere" as const } : r))
            : withStatus(rs, round.id, "active"),
        );
        say(calmError(e));
      } finally {
        inflight.current.delete(round.id);
      }
    },
    [signer, snapshot, latency, basket, say],
  );

  // The watcher: observed state in, settle dispatches out.
  const recon = useMemo(() => reconcile(rounds, snapshot, now), [rounds, snapshot, now]);
  useEffect(() => {
    if (!loaded) return;
    if (recon.closedElsewhere.length) {
      setRounds((rs) =>
        rs.map((r) => (recon.closedElsewhere.some((c) => c.id === r.id) ? { ...r, status: "closed-elsewhere" as const } : r)),
      );
    }
    for (const r of recon.toSettle) void settleRound(r);
  }, [recon, loaded, settleRound]);

  // ── commit flow: review (one quote) → confirm (sign those numbers) ─────────
  const [phase, setPhase] = useState<TicketPhase>("idle");
  const [review, setReview] = useState<LockedQuote | null>(null);
  const [ticketError, setTicketError] = useState<string | null>(null);

  const doReview = useCallback(async () => {
    setTicketError(null);
    setPhase("quoting");
    try {
      const stakeNum = Number(stake);
      const res = await flash.openPosition({
        inputTokenSymbol: "USDC",
        outputTokenSymbol: market,
        inputAmountUi: stake,
        leverage,
        tradeType: side,
        slippagePercentage: "1",
      });
      assertNoErr("open-position quote", res);
      setReview(lockedQuoteFrom(res, stakeNum, leverage, side));
      setPhase("review");
    } catch (e) {
      console.error("[quote]", e);
      setTicketError(calmError(e));
      setPhase("idle");
    }
  }, [stake, market, leverage, side]);

  const doConfirm = useCallback(async () => {
    if (!signer) return;
    setPhase("signing");
    setTicketError(null);
    try {
      const stakeNum = Number(stake);
      const res = await flash.openPosition({
        inputTokenSymbol: "USDC",
        outputTokenSymbol: market,
        inputAmountUi: stake,
        leverage,
        tradeType: side,
        slippagePercentage: "1",
        owner: signer.owner,
        ...signer.tradeFields,
      });
      assertNoErr("open-position", res);
      if (!res.transactionBase64) throw new Error(res.err ?? "no transaction returned");
      const sent = await signer.sendTrade(res.transactionBase64);
      latency.add({ action: `${side} ${leverage}× ${market}`, chain: "er", ms: sent.confirmMs, sendMs: sent.sendMs, signature: sent.signature });

      const tf = timeframe(timeframeId);
      const round: Round = {
        id: newRoundId(),
        market,
        side,
        stakeUsd: stakeNum,
        leverage,
        timeframe: timeframeId,
        placedAt: Date.now(),
        expiresAt: Date.now() + tf.ms,
        // Authoritative numbers: the SIGNED response, not the preview.
        quote: lockedQuoteFrom(res, stakeNum, leverage, side),
        status: "active",
      };
      setRounds((rs) => [...rs, round]);
      setMood(side === "LONG" ? "up" : "down");
      setPhase("idle");
      setReview(null);
      void basket.refresh();
    } catch (e) {
      console.error("[open]", e);
      setTicketError(calmError(e));
      setPhase("review");
    }
  }, [signer, stake, market, leverage, side, timeframeId, latency, basket]);

  // ── enable / revoke ────────────────────────────────────────────────────────
  const [enableOpen, setEnableOpen] = useState(false);
  const [enableState, setEnableState] = useState<EnableState | null>(null);
  const [busy, setBusy] = useState(false);

  const doEnable = useCallback(async () => {
    if (!walletCtx.publicKey || !walletCtx.signTransaction || !anchorWallet) return;
    setBusy(true);
    try {
      const ctx: EnableWalletCtx = {
        publicKey: walletCtx.publicKey,
        signTransaction: walletCtx.signTransaction,
        signAllTransactions: walletCtx.signAllTransactions,
      };
      const result = await enableOneClickTrading({
        wallet: ctx,
        anchorWallet,
        snapshot,
        usdcMint,
        balances: { sol: balances.sol, usdc: balances.usdc },
        onStep: setEnableState,
        onLog: latency.add,
      });
      if (result.session) setSession(result.session);
      if (result.ok) {
        setEnableOpen(false);
        if (result.needsUsdc) setFundsOpen(true);
      }
    } catch (e) {
      say(calmError(e));
    } finally {
      setBusy(false);
    }
  }, [walletCtx, anchorWallet, snapshot, usdcMint, balances.sol, balances.usdc, latency, say]);

  const doRevoke = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    try {
      await revokeSession(session, baseConnection);
      setSession(null);
      say("Session revoked — rent returned to your wallet.");
    } catch (e) {
      say(calmError(e));
    } finally {
      setBusy(false);
    }
  }, [session, say]);

  // ── funds ──────────────────────────────────────────────────────────────────
  const [fundsOpen, setFundsOpen] = useState(false);
  const [fundsStep, setFundsStep] = useState<FundsStep | null>(null);
  const [executePending, setExecutePending] = useState(false);

  const fundsWallet = useMemo<EnableWalletCtx | null>(() => {
    if (!walletCtx.publicKey || !walletCtx.signTransaction) return null;
    return {
      publicKey: walletCtx.publicKey,
      signTransaction: walletCtx.signTransaction,
      signAllTransactions: walletCtx.signAllTransactions,
    };
  }, [walletCtx.publicKey, walletCtx.signTransaction, walletCtx.signAllTransactions]);

  const doDeposit = useCallback(
    async (amount: string) => {
      const w = fundsWallet;
      if (!w || !usdcMint) return;
      setBusy(true);
      try {
        const r = await depositUsdc({ wallet: w, usdcMint, amount, onStep: setFundsStep, onLog: latency.add });
        if (!r.ok && r.error) say(r.error);
        await Promise.all([balances.refresh(), basket.refresh()]);
      } finally {
        setBusy(false);
      }
    },
    [fundsWallet, usdcMint, latency, balances, basket, say],
  );

  const doWithdraw = useCallback(
    async (amount: string) => {
      const w = fundsWallet;
      if (!w || !usdcMint) return;
      setBusy(true);
      try {
        const r = await withdrawUsdc({ wallet: w, usdcMint, amount, onStep: setFundsStep, onLog: latency.add });
        setExecutePending(Boolean(r.executePending));
        if (!r.ok && r.error) say(r.error);
        await Promise.all([balances.refresh(), basket.refresh()]);
      } finally {
        setBusy(false);
      }
    },
    [fundsWallet, usdcMint, latency, balances, basket, say],
  );

  const doExecuteWithdraw = useCallback(async () => {
    const w = fundsWallet;
    if (!w || !usdcMint) return;
    setBusy(true);
    try {
      const r = await executeWithdrawalStep({ wallet: w, usdcMint, onStep: setFundsStep, onLog: latency.add });
      setExecutePending(Boolean(r.executePending));
      if (!r.ok && r.error) say(r.error);
      await Promise.all([balances.refresh(), basket.refresh()]);
    } finally {
      setBusy(false);
    }
  }, [fundsWallet, usdcMint, latency, balances, basket, say]);

  // ── disclosure gate ────────────────────────────────────────────────────────
  const [disclosureAcked, setDisclosureAcked] = useState(true); // assume acked until mount check
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  useEffect(() => {
    const acked = typeof window !== "undefined" && window.localStorage.getItem(DISCLOSURE_ACK_KEY) === "1";
    setDisclosureAcked(acked);
    setDisclosureOpen(!acked);
  }, []);
  const ackDisclosure = useCallback(() => {
    window.localStorage.setItem(DISCLOSURE_ACK_KEY, "1");
    setDisclosureAcked(true);
    setDisclosureOpen(false);
  }, []);

  // ── derived view state ─────────────────────────────────────────────────────
  const active = rounds.filter((r) => r.status === "active" || r.status === "settling");
  const acks = pendingAcks(rounds);
  const stats = roundStats(rounds);
  const chartRound = active.find((r) => r.market === market);
  const chartEntry = chartRound ? { price: chartRound.quote.entryPrice, side: chartRound.side } : null;
  const sessionActive = Boolean(session && signer);

  const blockedReason = !owner
    ? "Connect a wallet to play."
    : !sessionActive
      ? "Enable one-tap rounds to play — one approval, no funds move."
      : inBasketUsd !== null && inBasketUsd < Number(stake || 0)
        ? "Deposit USDC to your basket first."
        : null;

  return (
    <main className="relative z-10 mx-auto min-h-[100dvh] w-full max-w-6xl px-4 pb-10">
      <WalletBar
        inBasketUsd={inBasketUsd}
        walletUsdc={balances.usdc}
        sessionActive={sessionActive}
        busy={busy}
        onFunds={() => setFundsOpen(true)}
        onEnable={() => setEnableOpen(true)}
        onRevoke={doRevoke}
        onShowDisclosure={() => setDisclosureOpen(true)}
      />

      <div className="mt-2 grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* ticket column */}
        <div className="lg:col-span-5">
          <h1 className="mb-1 font-display text-2xl font-black leading-tight sm:text-3xl">
            Call the next move<span className="text-up">.</span>
          </h1>
          <p className="mb-4 text-[13px] text-dim">{TAGLINE}</p>
          <Ticket
            markets={markets}
            market={market}
            onMarket={setMarket}
            side={side}
            onSide={(s) => {
              setSide(s);
              setMood(s === "LONG" ? "up" : "down");
            }}
            timeframeId={timeframeId}
            onTimeframe={setTimeframeId}
            stake={stake}
            onStake={setStake}
            maxStake={inBasketUsd}
            leverage={leverage}
            price={price}
            blockedReason={blockedReason}
            phase={phase}
            review={review}
            error={ticketError}
            onReview={doReview}
            onConfirm={doConfirm}
            onCancelReview={() => {
              setPhase("idle");
              setReview(null);
            }}
          />
        </div>

        {/* live column */}
        <div className="space-y-6 lg:col-span-7 lg:pt-16">
          <PriceChart symbol={market} price={price} entry={chartEntry} />
          <StatsStrip stats={stats} />

          {recon.orphans.length > 0 && (
            <div className="row-in rounded-2xl border border-warn/30 bg-warn/5 p-4">
              <p className="text-[12.5px] text-warn">
                {recon.orphans.length === 1 ? "A position" : `${recon.orphans.length} positions`} on this wallet{" "}
                {recon.orphans.length === 1 ? "isn't" : "aren't"} tracked here (opened elsewhere or cache cleared).
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {recon.orphans.map((o) => (
                  <button
                    key={`${o.market}|${o.side}`}
                    type="button"
                    onClick={() => setRounds((rs) => [...rs, adoptOrphan(o, Date.now())])}
                    className="press cursor-pointer rounded-full border border-warn/40 px-3 py-1.5 font-mono text-[11px] text-warn"
                  >
                    Adopt {o.market} {o.side === "LONG" ? "▲" : "▼"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {active.length > 0 ? (
            <section aria-label="Active rounds" className="space-y-3">
              <h3 className="font-mono text-[10px] uppercase tracking-[0.25em] text-faint">
                Live rounds <span className="text-up">●</span>
              </h3>
              {active.map((r) => (
                <ActiveRound key={r.id} round={r} onSettleNow={settleRound} />
              ))}
            </section>
          ) : (
            <div className="rounded-2xl border border-edge bg-panel/50 p-6 text-center text-[13px] text-faint">
              No live rounds. Your next call starts on the left.
            </div>
          )}

          <History rounds={rounds} />
        </div>
      </div>

      <footer className="mt-12 border-t border-edge pt-4 text-[11px] leading-relaxed text-faint">
        <p>
          {APP_NAME} is a starter built on Flash Trade V2 — every round is a real position on Solana mainnet, with real money.
          Most people who play short-term price games lose money. Never stake more than you can afford to lose.{" "}
          <button type="button" onClick={() => setDisclosureOpen(true)} className="cursor-pointer underline decoration-edge2 underline-offset-2 hover:text-dim">
            How it works
          </button>
        </p>
      </footer>

      {/* overlays */}
      {acks.length > 0 && <SettleCard round={acks[0] as Round} onAck={(r) => setRounds((rs) => withAck(rs, r.id))} />}
      <MechanicsDisclosure open={disclosureOpen} gate={!disclosureAcked} onAck={ackDisclosure} />
      <EnableSheet open={enableOpen} busy={busy} state={enableState} onEnable={() => void doEnable()} onClose={() => setEnableOpen(false)} />
      <FundsSheet
        open={fundsOpen}
        busy={busy}
        walletUsdc={balances.usdc}
        inBasketUsd={inBasketUsd}
        step={fundsStep}
        executePending={executePending}
        onDeposit={(a) => void doDeposit(a)}
        onWithdraw={(a) => void doWithdraw(a)}
        onExecuteWithdraw={() => void doExecuteWithdraw()}
        onClose={() => setFundsOpen(false)}
      />

      {toast && (
        <div className="fixed inset-x-0 bottom-4 z-50 mx-auto w-fit max-w-[90vw] row-in" role="status" aria-live="polite">
          <div className="rounded-full border border-edge2 bg-panel2 px-5 py-2.5 text-[12.5px] text-ink shadow-xl">{toast}</div>
        </div>
      )}
    </main>
  );
}
