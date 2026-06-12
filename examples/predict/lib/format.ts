// ─────────────────────────────────────────────────────────────────────────────
// lib/format.ts — display formatting for keys, prices, USD, PnL, and latency.
// THE HARD PART: the API speaks UI DECIMAL STRINGS (and leverage can be the
// literal string "Infinity") — every formatter here tolerates that without
// NaN leaking into the UI. GOTCHAS.md → "Responses are V1-shaped" (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────

/** "FMTg…xtvj" — middle-truncate a pubkey or signature. */
export function shortKey(key: string, n = 4): string {
  if (key.length <= n * 2 + 1) return key;
  return `${key.slice(0, n)}…${key.slice(-n)}`;
}

/** Parse an API decimal string defensively. Returns null on junk/Infinity. */
export function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** USDC has 6 decimals on-chain — tiny but REAL values must never display as
 *  $0.00 (a $5 position's fee is ~$0.004). Adaptive precision: more digits as
 *  the magnitude shrinks, never inventing precision the chain doesn't have. */
function usdDigits(abs: number, base: number): number {
  if (abs === 0) return base;
  if (abs < 0.01) return 4;
  if (abs < 1) return 3;
  return base;
}

/** "$151.23" / "−$0.0042" — USD with sign folded in, 6-dec-aware. */
export function fmtUsd(v: string | number | null | undefined, digits = 2): string {
  const n = num(v);
  if (n === null) return "—";
  const abs = Math.abs(n);
  const d = usdDigits(abs, digits);
  const sign = n < 0 ? "−" : "";
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })}`;
}

/** Signed USD for PnL: "+$0.42" / "−$0.0042" (6-dec-aware for small books). */
export function fmtPnlUsd(v: string | number | null | undefined): string {
  const n = num(v);
  if (n === null) return "—";
  const abs = Math.abs(n);
  return `${n >= 0 ? "+" : "−"}$${abs.toFixed(usdDigits(abs, 2))}`;
}

/** "+3.81%" / "−1.20%". */
export function fmtPct(v: string | number | null | undefined, digits = 2): string {
  const n = num(v);
  if (n === null) return "—";
  return `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(digits)}%`;
}

/** Plain number with fixed digits, em-dash on junk. */
export function fmtNum(v: string | number | null | undefined, digits = 2): string {
  const n = num(v);
  return n === null ? "—" : n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** "5.0×" — leverage; tolerates the API's literal "Infinity". */
export function fmtLeverage(v: string | number | null | undefined): string {
  const n = num(v);
  return n === null ? "∞×" : `${n.toFixed(1)}×`;
}

/** "38 ms" / "1.24 s". */
export function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** Median of a number list (null when empty). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  if (sorted.length % 2 === 0 && lo !== undefined && hi !== undefined) {
    return Math.round((lo + hi) / 2);
  }
  return hi ?? null;
}

// ── Flash-parity position math (client-side, like Flash's own UI) ───────────
// Flash's UI shows mark-price PnL incl. fees, NOT the indexer's spread-through
// pnlWithFeeUsdUi (which can read wildly different on the same position).
// Compute what the product computes:
//   pricePnl = (mark − entry)/entry × size × dir
//   pnl      = pricePnl − (exitFee + borrowFee)        [raw 6-dec ÷ 1e6]
//   pct      = pnl / collateral × 100
//   lev      = size / collateral
//   liq      ≈ entry × (1 ∓ collateral/size × 0.92)    [≈ maintenance buffer]
export interface PositionView {
  pnlUsd: number;
  pnlPct: number;
  leverage: number;
  liqUi: number | null;
}

export function computePositionView(
  p: {
    sideUi: string;
    sizeUsdUi: string;
    collateralUsdUi: string;
    entryPriceUi: string;
    exitFeeUsd: string;
    borrowFeeUsd: string;
  },
  markUi: number | null,
): PositionView | null {
  const size = num(p.sizeUsdUi);
  const coll = num(p.collateralUsdUi);
  const entry = num(p.entryPriceUi);
  if (size === null || coll === null || entry === null || entry <= 0 || markUi === null) return null;
  const dir = p.sideUi.toUpperCase() === "LONG" ? 1 : -1;
  const fees = ((num(p.exitFeeUsd) ?? 0) + (num(p.borrowFeeUsd) ?? 0)) / 1e6;
  const pnlUsd = ((markUi - entry) / entry) * size * dir - fees;
  const pnlPct = coll > 0 ? (pnlUsd / coll) * 100 : 0;
  const leverage = coll > 0 ? size / coll : 0;
  const liqUi = size > 0 ? entry * (1 - dir * (coll / size) * 0.92) : null;
  return { pnlUsd, pnlPct, leverage, liqUi };
}
