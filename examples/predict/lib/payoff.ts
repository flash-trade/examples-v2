// ─────────────────────────────────────────────────────────────────────────────
// lib/payoff.ts — the honest math behind a round: pure functions, no React.
// THE HARD PART: the live payoff line is LOCAL math (never quote-per-tick —
// rate limits + jitter); ONE real quote at the commit gate overrides every
// estimate and becomes the round's locked numbers. Fees scale with size, so
// break-even move % is leverage-INDEPENDENT; liquidation distance ≈ 92%/L.
// GOTCHAS.md → "Three numbers that surprise you on your first real fill"
// ─────────────────────────────────────────────────────────────────────────────

/** Conservative entry+exit fee estimate (fraction of SIZE) until a real quote lands. */
export const EST_ROUNDTRIP_FEE_RATE = 0.0016; // 0.08% open + 0.08% close

/** The protocol's liquidation buffer factor (GOTCHAS §20 display formula). */
export const LIQ_FACTOR = 0.92;

/** Timeframes a round can run. Leverage profiles are conservative-moderate:
 *  break-even move is leverage-independent, and liquidation distance (≈92%/L)
 *  is hardest to reach in short windows — so short rounds can carry more
 *  leverage without raising knockout risk. Clamped to live market caps. */
export const TIMEFRAMES = [
  { id: "5m", label: "5 min", ms: 5 * 60_000, leverage: 5 },
  { id: "15m", label: "15 min", ms: 15 * 60_000, leverage: 3.3 },
  { id: "1h", label: "1 hour", ms: 60 * 60_000, leverage: 2 },
] as const;

export type TimeframeId = (typeof TIMEFRAMES)[number]["id"];

export function timeframe(id: TimeframeId) {
  const tf = TIMEFRAMES.find((t) => t.id === id);
  if (!tf) throw new Error(`unknown timeframe: ${id}`);
  return tf;
}

/** Dollars of PnL per 1% move in the chosen direction. */
export function pnlPerPct(stakeUsd: number, leverage: number): number {
  return (stakeUsd * leverage) / 100;
}

/** Move (in %) the price must travel your way before fees are covered.
 *  feesUsd defaults to the local estimate when no quote exists yet. */
export function breakEvenMovePct(stakeUsd: number, leverage: number, feesUsd?: number): number {
  const size = stakeUsd * leverage;
  const fees = feesUsd ?? size * EST_ROUNDTRIP_FEE_RATE;
  if (size <= 0) return 0;
  return (fees / size) * 100;
}

/** Adverse move (in %) that knocks the round out early (liquidation). */
export function knockoutMovePct(leverage: number): number {
  if (leverage <= 0) return 100;
  return (LIQ_FACTOR / leverage) * 100;
}

/** Liquidation price from entry — the GOTCHAS §20 approximation. */
export function liqPriceApprox(entry: number, leverage: number, side: "LONG" | "SHORT"): number {
  const dist = LIQ_FACTOR / leverage;
  return side === "LONG" ? entry * (1 - dist) : entry * (1 + dist);
}

/** Hourly borrow drag in USD for a given size (marginFeePercentage is %/hr). */
export function borrowDragUsd(sizeUsd: number, marginFeePctHourly: number, hours: number): number {
  return sizeUsd * (marginFeePctHourly / 100) * hours;
}

/** Everything the ticket renders live, from local math alone. */
export interface PayoffFacts {
  sizeUsd: number;
  perPctUsd: number;
  breakEvenPct: number;
  knockoutPct: number;
  estFeesUsd: number;
}

export function payoffFacts(stakeUsd: number, leverage: number): PayoffFacts {
  const sizeUsd = stakeUsd * leverage;
  return {
    sizeUsd,
    perPctUsd: pnlPerPct(stakeUsd, leverage),
    breakEvenPct: breakEvenMovePct(stakeUsd, leverage),
    knockoutPct: knockoutMovePct(leverage),
    estFeesUsd: sizeUsd * EST_ROUNDTRIP_FEE_RATE,
  };
}

/** The numbers locked at commit — taken from the SIGNED open's response, never
 *  from a stale preview. PancakeSwap's #1 trust failure is a displayed payout
 *  that drifts before settle; ours cannot, because these lock here. */
export interface LockedQuote {
  entryPrice: number;
  liqPrice: number;
  entryFeeUsd: number;
  /** hourly borrow %, straight from the API */
  marginFeePctHourly: number;
  perPctUsd: number;
  breakEvenPct: number;
  /** EFFECTIVE size from the venue's fill math (GOTCHAS §21) — not stake×lev. */
  sizeUsd: number;
}

/** Build the locked quote from an open-position response — the ONE place the
 *  API's strings become the round's numbers (review and confirm both use it). */
export function lockedQuoteFrom(
  res: {
    newEntryPrice: string;
    newLiquidationPrice: string;
    entryFee: string;
    marginFeePercentage: string;
    outputAmountUi: string;
  },
  stakeUsd: number,
  leverage: number,
  side: "LONG" | "SHORT",
): LockedQuote {
  const entryFeeUsd = Number(res.entryFee) || 0;
  const entryPrice = Number(res.newEntryPrice) || 0;
  // The venue's actual fill: output tokens × entry — the spread reshapes it.
  const filled = (Number(res.outputAmountUi) || 0) * entryPrice;
  const sizeUsd = filled > 0 ? filled : stakeUsd * leverage;
  // Knockout is OURS to compute (GOTCHAS §20): the builder's
  // newLiquidationPrice is spread-valued and degenerates (it can land on the
  // wrong side of entry). Effective leverage = filled size / stake.
  const effLev = stakeUsd > 0 ? sizeUsd / stakeUsd : leverage;
  return {
    entryPrice,
    liqPrice: liqPriceApprox(entryPrice, effLev, side),
    entryFeeUsd,
    marginFeePctHourly: Number(res.marginFeePercentage) || 0,
    perPctUsd: sizeUsd / 100,
    breakEvenPct: sizeUsd > 0 ? ((entryFeeUsd * 2) / sizeUsd) * 100 : 0,
    sizeUsd,
  };
}

/** PnL in USD at a given move % (for drawing the payoff line). */
export function pnlAtMovePct(stakeUsd: number, leverage: number, movePct: number, feesUsd?: number): number {
  const size = stakeUsd * leverage;
  const fees = feesUsd ?? size * EST_ROUNDTRIP_FEE_RATE;
  const gross = (size * movePct) / 100;
  const net = gross - fees;
  // Loss is capped at stake: the position liquidates before losing more.
  return Math.max(net, -stakeUsd);
}
