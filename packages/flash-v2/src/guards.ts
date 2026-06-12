// ─────────────────────────────────────────────────────────────────────────────
// guards.ts — the footguns, encoded. Each guard exists because the API will
// happily build a transaction that fails on-chain (it does NOT validate
// trigger prices vs the oracle), or silently does something different than
// you asked (97% of size = full close). Call these BEFORE you sign.
// GOTCHAS.md → every guard links to its entry.
// ─────────────────────────────────────────────────────────────────────────────

import type { TradeType } from "./types.ts";

/** On-chain rule: limit/TP/SL orders need > $10 collateral AFTER entry fees. */
export const MIN_COLLATERAL_USD_AFTER_FEES = 10;
/** Practical floor: $11 clears the $10-after-fees rule; $12+ is comfortable. */
export const RECOMMENDED_MIN_COLLATERAL_USD = 11;

/**
 * Will this collateral still support TP/SL/limit orders after entry fees?
 * Open a "$10 position" and fees drop you below $10 → trigger placement FAILS.
 * @example
 * checkCollateralForTriggers(11, 0.011)  // → { ok: true, remaining: 10.989 }
 */
export function checkCollateralForTriggers(
  collateralUsd: number,
  entryFeeUsd = 0,
): { ok: boolean; remaining: number; reason?: string } {
  const remaining = collateralUsd - entryFeeUsd;
  if (remaining > MIN_COLLATERAL_USD_AFTER_FEES) return { ok: true, remaining };
  return {
    ok: false,
    remaining,
    reason:
      `$${remaining.toFixed(2)} after fees ≤ $${MIN_COLLATERAL_USD_AFTER_FEES} — TP/SL/limit will fail on-chain. ` +
      `Use ≥ $${RECOMMENDED_MIN_COLLATERAL_USD} collateral.`,
  };
}

export type PriceKind = "limit" | "tp" | "sl";

/**
 * Validate a limit/TP/SL price against the live mark BEFORE building the tx.
 * The API does NOT check this — it returns a transaction that the program
 * rejects with InvalidLimitPrice (custom error 6057).
 *
 * Rules (LONG):  limit < mark · TP > mark · SL < mark.   SHORT is the mirror.
 * @example
 * validateTriggerPrice({ side: "LONG", kind: "tp", price: 70, markPrice: 65 }) // ok
 * validateTriggerPrice({ side: "LONG", kind: "tp", price: 60, markPrice: 65 }) // → 6057 explained
 */
export function validateTriggerPrice(args: {
  side: TradeType;
  kind: PriceKind;
  price: number;
  markPrice: number;
}): { ok: boolean; reason?: string } {
  const { side, kind, price, markPrice } = args;
  if (!(price > 0) || !(markPrice > 0)) {
    return { ok: false, reason: "price and markPrice must be > 0" };
  }
  const long = side === "LONG";
  const mustBeBelow = (long && (kind === "limit" || kind === "sl")) || (!long && kind === "tp");
  const ok = mustBeBelow ? price < markPrice : price > markPrice;
  if (ok) return { ok: true };
  return {
    ok: false,
    reason:
      `${side} ${kind.toUpperCase()} must be ${mustBeBelow ? "below" : "above"} mark ` +
      `(${price} vs mark ${markPrice}) — on-chain this is InvalidLimitPrice (6057).`,
  };
}

/** The program treats ≥97% of position size (or 0) as a FULL close. */
export const FULL_CLOSE_THRESHOLD = 0.97;

/**
 * Which close you'll actually get. "Close 98%" is silently a FULL close —
 * a different on-chain instruction with different response fields.
 * @param positionSizeUsd Pass the LIVE position size. If it's 0/unknown
 * (snapshot not loaded yet) this conservatively returns true — verify
 * `positionSizeUsd > 0` before trusting a "partial" answer.
 * @example
 * isFullClose(98, 100)  // → true  (≥97%)
 * isFullClose(90, 100)  // → false (partial)
 */
export function isFullClose(closeUsd: number, positionSizeUsd: number): boolean {
  if (closeUsd === 0) return true;
  if (!(positionSizeUsd > 0)) return true;
  return closeUsd >= positionSizeUsd * FULL_CLOSE_THRESHOLD;
}

/** Re-exported here so manual fetch users can normalize errors the same way. */
export { assertNoErr } from "./errors.ts";
