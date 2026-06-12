// ─────────────────────────────────────────────────────────────────────────────
// components/ticket.tsx — the commit surface, v2: glass, plain words, zero
// trading vocabulary. Market via picker sheet (no scroll row); stake is a
// labeled glass field + balance slider + "use max" (no amount chips); facts
// speak in the user's dollars; ONE real quote at Review locks the numbers
// before anything signs. $11 floor enforced (the chain's, not ours).
// GOTCHAS.md → "The $11 rule" · "owner is optional exactly once" (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useMemo } from "react";
import type { PriceInfo } from "flash-v2";
import { RECOMMENDED_MIN_COLLATERAL_USD } from "flash-v2";
import { fmtPrice } from "@/lib/copy";
import { fmtUsd } from "@/lib/format";
import { payoffFacts, TIMEFRAMES, type LockedQuote, type TimeframeId } from "@/lib/payoff";
import type { Side } from "@/lib/rounds";
import { MarketPicker } from "./market-picker";

const MIN_STAKE = RECOMMENDED_MIN_COLLATERAL_USD; // $11 — the chain's floor

export type TicketPhase = "idle" | "quoting" | "review" | "signing";

interface Props {
  markets: string[] | null;
  market: string;
  onMarket: (m: string) => void;
  side: Side;
  onSide: (s: Side) => void;
  timeframeId: TimeframeId;
  onTimeframe: (t: TimeframeId) => void;
  stake: string;
  onStake: (s: string) => void;
  maxStake: number | null;
  leverage: number; // clamped to market caps by the app
  price: PriceInfo | null;
  blockedReason: string | null;
  phase: TicketPhase;
  review: LockedQuote | null;
  error: string | null;
  onReview: () => void;
  onConfirm: () => void;
  onCancelReview: () => void;
}

export function Ticket(props: Props) {
  const {
    markets, market, onMarket, side, onSide, timeframeId, onTimeframe, stake, onStake, maxStake,
    leverage, price, blockedReason, phase, review, error, onReview, onConfirm, onCancelReview,
  } = props;

  const stakeNum = Number(stake) || 0;
  const facts = useMemo(() => payoffFacts(stakeNum, leverage), [stakeNum, leverage]);
  const stakeOk = stakeNum >= MIN_STAKE && (maxStake === null || stakeNum <= maxStake + 1e-9);
  const inReview = phase === "review" || phase === "signing";
  const sliderMax = maxStake !== null ? Math.max(MIN_STAKE, Math.floor(maxStake)) : null;
  const stakeShown = stakeNum || MIN_STAKE;

  return (
    <div className="glass p-5 sm:p-6">
      {/* market */}
      <MarketPicker markets={markets} market={market} price={price} disabled={inReview} onSelect={onMarket} />

      {/* direction — the product's two verbs */}
      <div className="mt-4 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Your call">
        <button
          type="button"
          role="radio"
          aria-checked={side === "LONG"}
          disabled={inReview}
          onClick={() => onSide("LONG")}
          className={`press cursor-pointer rounded-2xl border py-4 font-display text-lg font-black tracking-wide ${
            side === "LONG"
              ? "border-up/70 bg-up/15 text-up"
              : "border-white/10 bg-white/[0.03] text-faint hover:text-dim"
          } disabled:opacity-60`}
        >
          ▲ UP
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={side === "SHORT"}
          disabled={inReview}
          onClick={() => onSide("SHORT")}
          className={`press cursor-pointer rounded-2xl border py-4 font-display text-lg font-black tracking-wide ${
            side === "SHORT"
              ? "border-down/70 bg-down/15 text-down"
              : "border-white/10 bg-white/[0.03] text-faint hover:text-dim"
          } disabled:opacity-60`}
        >
          ▼ DOWN
        </button>
      </div>

      {/* how long */}
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-faint">How long</p>
      <div className="mt-1.5 flex gap-1.5" role="radiogroup" aria-label="Round length">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf.id}
            type="button"
            role="radio"
            aria-checked={timeframeId === tf.id}
            disabled={inReview}
            onClick={() => onTimeframe(tf.id)}
            className={`press flex flex-1 cursor-pointer flex-col items-center rounded-2xl border py-2.5 ${
              timeframeId === tf.id ? "border-ink/40 bg-white/[0.07]" : "border-white/10 bg-white/[0.03]"
            } disabled:opacity-60`}
          >
            <span className={`font-display text-[13px] font-bold ${timeframeId === tf.id ? "text-ink" : "text-dim"}`}>{tf.label}</span>
            <span className="font-mono text-[9.5px] text-faint">pays ×{tf.leverage}</span>
          </button>
        ))}
      </div>

      {/* your stake */}
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-faint">Your stake</p>
      <div className="glass-strong mt-1.5 px-4 py-3">
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-lg text-faint">$</span>
          <input
            inputMode="decimal"
            value={stake}
            disabled={inReview}
            onChange={(e) => onStake(e.target.value.replace(/[^0-9.]/g, ""))}
            onFocus={(e) => e.target.select()}
            aria-label="Your stake in dollars"
            className="w-full bg-transparent font-mono text-[28px] font-medium leading-none text-ink placeholder:text-faint focus:outline-none disabled:opacity-60"
            placeholder={String(MIN_STAKE)}
          />
          {maxStake !== null && (
            <button
              type="button"
              disabled={inReview}
              onClick={() => onStake(String(Math.max(MIN_STAKE, Math.floor(maxStake * 100) / 100)))}
              className="shrink-0 cursor-pointer whitespace-nowrap font-mono text-[11px] text-dim underline decoration-edge2 underline-offset-2 hover:text-ink disabled:opacity-50"
            >
              use max
            </button>
          )}
        </div>
        {sliderMax !== null && sliderMax > MIN_STAKE && (
          <input
            type="range"
            min={MIN_STAKE}
            max={sliderMax}
            step={1}
            value={Math.min(Math.max(stakeNum || MIN_STAKE, MIN_STAKE), sliderMax)}
            disabled={inReview}
            onChange={(e) => onStake(e.target.value)}
            aria-label="Slide to set your stake"
            className="stake-range mt-3 w-full cursor-pointer"
          />
        )}
        <p className="mt-2 font-mono text-[10.5px] text-faint">
          {maxStake === null ? `$${MIN_STAKE} minimum` : `Balance ${fmtUsd(maxStake)} · $${MIN_STAKE} minimum`}
        </p>
      </div>
      {stakeNum > 0 && stakeNum < MIN_STAKE && (
        <p className="mt-1.5 text-[11.5px] text-warn">${MIN_STAKE} minimum — below that the blockchain rejects the round.</p>
      )}
      {maxStake !== null && stakeNum > maxStake && (
        <p className="mt-1.5 text-[11.5px] text-warn">That&apos;s more than your balance ({fmtUsd(maxStake)}). Deposit first.</p>
      )}

      {/* what can happen — three lines, nothing to decode */}
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-faint">What can happen</p>
      <ul className="mt-1.5 space-y-1.5">
        <li className="film flex items-center gap-3 px-3.5 py-2.5 text-[13px]">
          <span aria-hidden className="text-up">▲</span>
          <span className="text-dim">Moves your way 1%</span>
          <span className="ml-auto font-mono text-up">+${facts.perPctUsd.toFixed(2)}</span>
        </li>
        <li className="film flex items-center gap-3 px-3.5 py-2.5 text-[13px]">
          <span aria-hidden className="text-down">▼</span>
          <span className="text-dim">Moves against you 1%</span>
          <span className="ml-auto font-mono text-down">−${facts.perPctUsd.toFixed(2)}</span>
        </li>
        <li className="film flex items-center gap-3 px-3.5 py-2.5 text-[13px]">
          <span aria-hidden className="text-down">✕</span>
          <span className="text-dim">
            {side === "LONG" ? "Falls" : "Jumps"} {facts.knockoutPct.toFixed(0)}% — round ends
          </span>
          <span className="ml-auto whitespace-nowrap font-mono text-ink">−{fmtUsd(stakeShown)} max</span>
        </li>
      </ul>

      {/* commit gate */}
      {!inReview ? (
        <>
          <button
            type="button"
            disabled={!stakeOk || phase === "quoting" || !price}
            onClick={onReview}
            className={`press group mt-5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-full py-4 font-display text-sm font-black disabled:cursor-not-allowed disabled:opacity-35 ${
              side === "LONG" ? "bg-up text-up-deep cta-glow-up" : "bg-down text-down-deep cta-glow-down"
            }`}
          >
            {phase === "quoting" ? "Locking your numbers…" : `Review ${side === "LONG" ? "UP" : "DOWN"} round`}
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-bg/15 transition-transform group-hover:translate-x-0.5">→</span>
          </button>
          {blockedReason && <p className="mt-2 text-center text-[11.5px] text-dim">{blockedReason}</p>}
        </>
      ) : (
        <div className="row-in glass-strong mt-5 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-up">Your numbers — locked, they don&apos;t drift</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[12px]">
            <div className="flex justify-between gap-2"><dt className="text-faint">You get in at</dt><dd>{fmtPrice(review?.entryPrice)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-faint">Round ends early at</dt><dd className="text-down">{fmtPrice(review?.liqPrice)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-faint">Backing your call</dt><dd>{fmtUsd(review?.sizeUsd ?? 0)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-faint">Each 1% your way</dt><dd className="text-up">+{fmtUsd(review?.perPctUsd ?? 0)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-faint">Fees, in and out (≈)</dt><dd>{fmtUsd((review?.entryFeeUsd ?? 0) * 2)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-faint">Cost per hour held</dt><dd>{(review?.marginFeePctHourly ?? 0).toFixed(4)}%</dd></div>
          </dl>
          {(() => {
            const mark = price?.priceUi ?? null;
            const entry = review?.entryPrice ?? null;
            const gapPct = mark && entry ? ((entry - mark) / mark) * 100 : 0;
            return Math.abs(gapPct) >= 0.25 ? (
              <p className="mt-2 rounded-lg border border-warn/25 bg-warn/5 px-2.5 py-1.5 text-[11px] leading-snug text-warn">
                Heads up: you&apos;d get in {Math.abs(gapPct).toFixed(1)}% {gapPct > 0 ? "above" : "below"} the live price — that&apos;s
                the venue&apos;s cut of the entry. The round starts that far {gapPct > 0 === (side === "LONG") ? "behind" : "ahead"}.
              </p>
            ) : null;
          })()}
          <p className="mt-2 text-[11.5px] leading-snug text-dim">
            {fmtUsd(stakeNum)} says {market} {side === "LONG" ? "goes up" : "goes down"} in{" "}
            {TIMEFRAMES.find((t) => t.id === timeframeId)?.label}. Worst case: −{fmtUsd(stakeNum)}.
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={onCancelReview} disabled={phase === "signing"} className="press flex-1 cursor-pointer rounded-full border border-white/10 bg-white/[0.03] py-3 text-[12px] text-dim disabled:opacity-40">
              Back
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={phase === "signing" || !!blockedReason}
              className={`press flex-[2] cursor-pointer rounded-full py-3 font-display text-[13px] font-black disabled:cursor-not-allowed disabled:opacity-60 ${
                side === "LONG" ? "bg-up text-up-deep cta-glow-up" : "bg-down text-down-deep cta-glow-down"
              }`}
            >
              {phase === "signing" ? "Opening your round…" : "Confirm — open the round"}
            </button>
          </div>
          {blockedReason && <p className="mt-2 text-center text-[11.5px] text-warn">{blockedReason}</p>}
        </div>
      )}

      {error && <p className="row-in mt-3 rounded-xl border border-down/30 bg-down/10 px-3 py-2 text-[12px] text-down">{error}</p>}
    </div>
  );
}
