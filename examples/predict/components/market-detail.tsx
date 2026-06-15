// ─────────────────────────────────────────────────────────────────────────────
// components/market-detail.tsx — tap a card → this overlay. The full prediction
// surface for one token+timeframe:
//   • Above / Below direction toggle (each side is a real, separate bet — odds
//     don't sum to 100¢; the gap is the honest house edge, like a book's vig).
//   • The STRIKE LADDER: a row per strike, each a YES bet at its own odds.
//   • MULTI-OUTCOME BUCKETS: "where does it land?".
//   • The BUY TICKET: stake → to-win · profit · max-loss (= stake), locked math.
// Every number is priced LIVE through this market's real trade spread + leverage
// caps (useMarketLimits) by lib/markets.ts — measured from the SIGNED FILL, never
// the oracle, so a take-profit can't land inside the spread. Nothing is shown
// until the limits load (no spread-blind odds, ever).
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { assertNoErr, validateTriggerPrice, type OpenPositionResponse } from "flash-v2";
import {
  cents,
  profitUsd,
  slippageForSpread,
  strikeLadder,
  toWinUsd,
  type Direction,
  type PricedMarket,
} from "@/lib/markets";
import { useMarketLimits } from "@/lib/hooks";
import { lockedQuoteFrom, timeframe, type TimeframeId } from "@/lib/payoff";
import { newRoundId, type Round } from "@/lib/rounds";
import { calmError, fmtPrice } from "@/lib/copy";
import { flash } from "@/lib/flash";
import type { ActiveSigner } from "@/lib/signer";
import { TokenIcon } from "./token-icon";

const MIN_STAKE = 11; // the $11-after-fees floor (RECOMMENDED_MIN_COLLATERAL_USD)

const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
const fmtStrike = (n: number) => (n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(n >= 1 ? 2 : 4));

/** The bet reconciled to the SIGNED response — the authoritative numbers the user
 *  actually signs, never the pre-trade estimate. `ok:false` blocks the commit. */
interface ReconciledBet {
  ok: boolean;
  reason?: string;
  /** real fill entry from the venue. */
  entry: number;
  /** price the take-profit actually fires at. */
  tpExit: number;
  /** profit the API computes for the TP ON THIS FILL (the spread guard). */
  profitUsd: number;
  toWinUsd: number;
  maxLossUsd: number;
  entryFeeUsd: number;
  liq: number;
}

/** Reconcile an open-position response against the market we meant to back, and
 *  decide whether it can honestly be signed. THREE gates, all from the real fill:
 *    (a) the strike is a valid TP trigger vs the real entry (else on-chain 6057) — fix #4
 *    (b) the venue actually priced a take-profit
 *    (c) THE SPREAD GUARD: the TP nets a profit > 0. profit ≤ 0 means the strike
 *        landed inside the spread and would fire as a ~100% LOSS — the exact bug
 *        the v2.1 redesign exists to kill. The user can never sign through it. */
function reconcileBet(res: OpenPositionResponse, m: PricedMarket, stakeUsd: number): ReconciledBet {
  const side = m.construction.side;
  const entry = Number(res.newEntryPrice) || 0;
  const liq = Number(res.newLiquidationPrice) || 0;
  const entryFeeUsd = Number(res.entryFee) || 0;
  const tp = res.takeProfitQuote;
  // The venue's OWN profit-at-TP on the real fill — ground truth. The spread is
  // paid on BOTH legs, so this already nets the exit spread (a TP inside the
  // round-trip spread reports ≤ 0). Never trust local math over this number.
  const realProfitUsd = tp ? Number(tp.profitUsdUi) || 0 : 0;
  const tpExit = tp ? Number(tp.exitPriceUi) || 0 : 0;
  const base = { entry, tpExit, profitUsd: realProfitUsd, toWinUsd: stakeUsd + Math.max(0, realProfitUsd), maxLossUsd: stakeUsd, entryFeeUsd, liq };

  const valid = validateTriggerPrice({ side, kind: "tp", price: m.construction.takeProfitPrice, markPrice: entry });
  if (!valid.ok) return { ...base, ok: false, reason: "This strike isn't beyond the live fill, so the bet can't pay out. Pick a farther strike." };
  if (!tp) return { ...base, ok: false, reason: "Couldn't price the take-profit on this fill. Try again in a moment." };
  // THE SPREAD GUARD: on the real round-trip the TP must net a profit, else the
  // move is inside the (two-leg) spread and would fire as a loss.
  if (realProfitUsd <= 0) return { ...base, ok: false, reason: "On the live fill this bet can't win right now — the move is inside the spread. Try a farther strike or another market." };
  // DIVERGENCE GUARD: the live payout must be close to the odds we displayed.
  // A big shortfall (stale browse price / model drift) blocks rather than let the
  // user sign a bet materially worse than advertised.
  const shownProfit = profitUsd(stakeUsd, m.prob);
  if (shownProfit > 0 && realProfitUsd < shownProfit * 0.6) {
    return { ...base, ok: false, reason: `The live payout dropped to about ${fmtUsd(base.toWinUsd)} (we showed ~${fmtUsd(stakeUsd + shownProfit)}). Re-review or pick another strike.` };
  }
  return { ...base, ok: true };
}

export function MarketDetail({
  token,
  price,
  timeframe: tf,
  signer,
  canBet,
  availableUsd,
  onClose,
  onNeedWallet,
  onPlaced,
}: {
  token: string;
  price: number;
  timeframe: TimeframeId;
  signer: ActiveSigner | null;
  canBet: boolean;
  /** USDC available to bet; null until known. Gates stake ≤ balance. */
  availableUsd: number | null;
  onClose: () => void;
  onNeedWallet?: () => void;
  onPlaced?: (round: Round) => void;
}) {
  const limits = useMarketLimits(token);
  const [dir, setDir] = useState<Direction>("ABOVE");
  // Side-appropriate spread: a LONG (Above) enters through the long spread, a
  // SHORT (Below) through the short spread. The engine measures from that fill.
  const spread = limits ? (dir === "ABOVE" ? limits.spreadLongPct : limits.spreadShortPct) : 0;

  const ladder = useMemo(
    () =>
      limits
        ? strikeLadder({
            token, oracle: price, spread, maxLeverage: limits.maxLeverage,
            minLeverage: limits.minLeverage, direction: dir, timeframe: tf,
          })
        : [],
    [token, price, spread, dir, tf, limits],
  );
  const [picked, setPicked] = useState<PricedMarket | null>(null);
  const active = picked && picked.direction === dir ? picked : ladder[Math.floor(ladder.length / 2)] ?? null;
  const [stake, setStake] = useState("25");

  const stakeUsd = Math.max(0, Number(stake.replace(/[^0-9.]/g, "")) || 0);
  const tooSmall = stakeUsd > 0 && stakeUsd < MIN_STAKE;
  const tooBig = availableUsd != null && stakeUsd > availableUsd + 1e-9;
  const yesCents = active ? cents(active.prob) : 0;

  type Phase = "idle" | "quoting" | "review" | "signing";
  const [phase, setPhase] = useState<Phase>("idle");
  const [review, setReview] = useState<ReconciledBet | null>(null);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Any change to the bet (strike, side, stake) invalidates a pending review —
  // you can only sign numbers you just reviewed.
  useEffect(() => {
    setPhase((p) => (p === "quoting" || p === "signing" ? p : "idle"));
    setReview(null);
  }, [active, stakeUsd]);

  // The openPosition request — IDENTICAL for the review quote and the signed
  // commit, so the numbers you review are the numbers you sign. Slippage clears
  // the live spread; the take-profit IS the YES win (= the strike).
  const reqFor = useCallback(
    (m: PricedMarket) => ({
      inputTokenSymbol: "USDC",
      outputTokenSymbol: m.token,
      inputAmountUi: stakeUsd.toFixed(2),
      leverage: Number(m.construction.leverage.toFixed(4)),
      tradeType: m.construction.side,
      slippagePercentage: slippageForSpread(m.spread),
      takeProfit: m.construction.takeProfitPrice.toFixed(4),
    }),
    [stakeUsd],
  );

  // STEP 1 — review: quote the REAL fill (no owner = no tx), reconcile, and BLOCK
  // if the take-profit can't pay out on this fill. The user never reaches a sign
  // prompt for a bet that's a loss by construction.
  const doReview = useCallback(async () => {
    // Guard: never quote from an in-flight phase or on an invalid/over-balance stake.
    if (!active || phase === "quoting" || phase === "signing") return;
    if (stakeUsd <= 0 || stakeUsd < MIN_STAKE || (availableUsd != null && stakeUsd > availableUsd + 1e-9)) return;
    setTicketError(null);
    setResult(null);
    setPhase("quoting");
    try {
      const res = await flash.openPosition(reqFor(active));
      assertNoErr("open-position quote", res);
      setReview(reconcileBet(res, active, stakeUsd));
      setPhase("review");
    } catch (e) {
      setTicketError(calmError(e));
      setPhase("idle");
    }
  }, [active, reqFor, stakeUsd, phase, availableUsd]);

  // STEP 2 — confirm: re-quote WITH owner (the price may have moved since review),
  // re-run the same reconciliation, and only sign + send if it STILL passes. A
  // re-quote that went bad bumps back to the review with the new reason.
  const doConfirm = useCallback(async () => {
    if (!active || !signer || phase === "signing") return; // double-submit guard
    setPhase("signing");
    setTicketError(null);
    try {
      const res = await flash.openPosition({ ...reqFor(active), owner: signer.owner, ...signer.tradeFields });
      assertNoErr("open-position", res);
      const recon = reconcileBet(res, active, stakeUsd);
      if (!recon.ok) {
        setReview(recon);
        setPhase("review");
        return;
      }
      if (!res.transactionBase64) throw new Error(res.err ?? "no transaction returned");
      const sent = await signer.sendTrade(res.transactionBase64);
      // Record the bet so the settlement engine can run its clock + resolve it.
      const lev = active.construction.leverage;
      const round: Round = {
        id: newRoundId(),
        market: active.token,
        side: active.construction.side,
        stakeUsd,
        leverage: lev,
        timeframe: tf,
        placedAt: Date.now(),
        expiresAt: Date.now() + timeframe(tf).ms,
        quote: lockedQuoteFrom(res, stakeUsd, lev, active.construction.side),
        status: "active",
        strike: active.construction.takeProfitPrice,
        winProfitUsd: recon.profitUsd,
      };
      setResult({ ok: true, msg: `Bet placed · ${sent.signature.slice(0, 8)}…` });
      setReview(null);
      setPhase("idle");
      onPlaced?.(round);
    } catch (e) {
      setTicketError(calmError(e));
      setPhase("review");
    }
  }, [active, signer, reqFor, stakeUsd, onPlaced, phase]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="glass relative z-10 flex max-h-[92dvh] w-full max-w-[520px] flex-col gap-4 overflow-y-auto rounded-t-[22px] p-5 sm:rounded-[22px]">
        {/* header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <TokenIcon symbol={token} size={34} />
            <div className="leading-tight">
              <p className="font-display text-[16px] font-bold text-ink">{token}</p>
              <p className="font-mono text-[11px] tabular-nums text-dim">{fmtPrice(price)} · {timeframe(tf).label}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full bg-white/5 px-3 py-1.5 font-mono text-[11px] text-dim hover:text-ink">Close</button>
        </div>

        {/* direction toggle — each side is its own real bet */}
        <div className="flex rounded-full bg-white/5 p-0.5 text-[13px] font-bold">
          <button onClick={() => { setDir("ABOVE"); setPicked(null); }} className={`flex-1 rounded-full py-2 transition-colors ${dir === "ABOVE" ? "bg-up/15 text-up" : "text-faint"}`}>▲ Above</button>
          <button onClick={() => { setDir("BELOW"); setPicked(null); }} className={`flex-1 rounded-full py-2 transition-colors ${dir === "BELOW" ? "bg-down/15 text-down" : "text-faint"}`}>Below ▼</button>
        </div>

        {!limits ? (
          <div className="flex flex-col gap-2 py-6" aria-hidden>
            <p className="text-center font-mono text-[11px] text-faint">pricing this market…</p>
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-11 animate-pulse rounded-[12px] bg-white/5" />)}
          </div>
        ) : (
          <>
            {/* the strike ladder — pick your odds by picking a strike */}
            <div className="flex flex-col gap-1.5">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">{dir === "ABOVE" ? "climbs above" : "drops below"} — pick a strike</p>
              {ladder.map((m) => {
                const on = active === m;
                const c = cents(m.prob);
                return (
                  <button
                    key={m.strike}
                    onClick={() => setPicked(m)}
                    className={`flex items-center justify-between rounded-[12px] border px-3.5 py-2.5 text-left transition-colors ${on ? "border-up/40 bg-up/[0.06]" : "border-edge hover:border-edge2"}`}
                  >
                    <span className="font-mono text-[13px] tabular-nums text-ink">{fmtStrike(m.strike)}</span>
                    <span className="flex items-center gap-3">
                      <span className="font-mono text-[11px] tabular-nums text-dim">win {fmtUsd(toWinUsd(1, m.prob))}/$1</span>
                      <span className={`font-mono text-[14px] font-bold tabular-nums ${dir === "ABOVE" ? "text-up" : "text-down"}`}>{c}¢</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {/* the buy ticket */}
            {active && (
              <div className="film flex flex-col gap-3 rounded-[16px] p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] text-ink">
                    {token} {dir === "ABOVE" ? "above" : "below"} <span className="font-mono tabular-nums">{fmtStrike(active.strike)}</span>
                  </p>
                  <span className={`font-mono text-[15px] font-bold tabular-nums ${dir === "ABOVE" ? "text-up" : "text-down"}`}>{yesCents}¢</span>
                </div>

                <label className="glass-strong flex items-center justify-between rounded-[12px] px-3.5 py-2.5">
                  <span className="text-[12px] text-dim">Stake</span>
                  <span className="flex items-baseline gap-1">
                    <span className="font-mono text-sm text-faint">$</span>
                    <input value={stake} onChange={(e) => setStake(e.target.value)} inputMode="decimal" className="w-20 bg-transparent text-right font-mono text-[16px] tabular-nums text-ink outline-none" />
                  </span>
                </label>

                {/* the honest numbers — locked from the same math the trade uses */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Stat label="to win" value={fmtUsd(toWinUsd(stakeUsd, active.prob))} tone="up" />
                  <Stat label="profit" value={`+${fmtUsd(profitUsd(stakeUsd, active.prob))}`} tone="up" />
                  <Stat label="max loss" value={`−${fmtUsd(stakeUsd)}`} tone="down" />
                </div>

                {(phase === "review" || phase === "signing") && review ? (
                  <div className="flex flex-col gap-2.5">
                    {/* RECONCILED to the signed fill — the numbers you actually sign */}
                    <div className="flex flex-col gap-1.5 rounded-[12px] border border-edge px-3.5 py-3">
                      <ReconRow k="fills at" v={fmtStrike(review.entry)} />
                      <ReconRow k="wins at" v={fmtStrike(review.tpExit)} />
                      <ReconRow k="to win" v={fmtUsd(review.toWinUsd)} tone={review.ok ? "up" : undefined} />
                      <ReconRow k="profit" v={`${review.profitUsd >= 0 ? "+" : "−"}${fmtUsd(Math.abs(review.profitUsd))}`} tone={review.profitUsd > 0 ? "up" : "down"} />
                      <ReconRow k="max loss" v={`−${fmtUsd(review.maxLossUsd)}`} tone="down" />
                      <ReconRow k="entry fee" v={fmtUsd(review.entryFeeUsd)} />
                    </div>
                    {!review.ok && <p className="text-center font-mono text-[11px] leading-relaxed text-down">{review.reason}</p>}
                    {ticketError && <p className="text-center font-mono text-[11px] text-down">{ticketError}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setPhase("idle"); setReview(null); }}
                        disabled={phase === "signing"}
                        className="rounded-[12px] bg-white/5 px-4 py-3 text-[13px] font-semibold text-dim hover:text-ink disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => void doConfirm()}
                        disabled={!review.ok || phase === "signing" || !signer}
                        className={`flex-1 rounded-[12px] py-3 text-[14px] font-bold transition-transform active:scale-[0.99] disabled:opacity-50 ${dir === "ABOVE" ? "cta-glow-up bg-up text-up-deep" : "cta-glow-down bg-down text-down-deep"}`}
                      >
                        {phase === "signing" ? "Signing…" : review.ok ? `Confirm · ${yesCents}¢` : "Can't win now"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => (canBet ? void doReview() : onNeedWallet?.())}
                      disabled={phase === "quoting" || (canBet && (stakeUsd <= 0 || tooSmall || tooBig))}
                      className={`rounded-[12px] py-3 text-[14px] font-bold transition-transform active:scale-[0.99] disabled:opacity-50 ${dir === "ABOVE" ? "cta-glow-up bg-up text-up-deep" : "cta-glow-down bg-down text-down-deep"}`}
                    >
                      {phase === "quoting"
                        ? "Pricing…"
                        : !canBet
                          ? "Connect & enable to bet"
                          : tooSmall
                            ? `Stake at least $${MIN_STAKE}`
                            : tooBig
                              ? "Add funds to bet"
                              : `Review ${dir === "ABOVE" ? "Above" : "Below"} · ${yesCents}¢`}
                    </button>
                    {result && (
                      <p className={`text-center font-mono text-[11px] tabular-nums ${result.ok ? "text-up" : "text-down"}`}>{result.msg}</p>
                    )}
                    {ticketError && <p className="text-center font-mono text-[11px] text-down">{ticketError}</p>}
                  </>
                )}
                <p className="text-center font-mono text-[10px] leading-relaxed text-faint">
                  Odds are formula-set on a real capped-loss position. Wins if {token} reaches the strike before the deadline;
                  otherwise it closes at the deadline price. You can never lose more than your stake.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "up" | "down" }) {
  return (
    <div className="rounded-[10px] bg-white/[0.03] px-2 py-2">
      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint">{label}</p>
      <p className={`mt-0.5 font-mono text-[14px] font-bold tabular-nums ${tone === "up" ? "text-up" : "text-down"}`}>{value}</p>
    </div>
  );
}

function ReconRow({ k, v, tone }: { k: string; v: string; tone?: "up" | "down" }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[11px] text-faint">{k}</span>
      <span className={`font-mono text-[12px] font-semibold tabular-nums ${tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-ink"}`}>{v}</span>
    </div>
  );
}
