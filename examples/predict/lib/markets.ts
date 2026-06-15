// ─────────────────────────────────────────────────────────────────────────────
// lib/markets.ts — the PREDICTION-MARKET engine.
//
// Turns a price threshold into a YES/NO market priced in CENTS (= implied
// probability), constructed underneath as a capped-loss Flash V2 perp with a
// bundled TAKE-PROFIT at the strike (the YES win) and the liquidation KNOCKOUT
// (the NO / lose). One open-position call carries the TP (OpenPositionRequest
// `takeProfit`, flash-v2 types.ts:32), so a "buy YES" is a single signed trade.
//
// THE HONEST MODEL (say it out loud; never pretend otherwise):
//   • Odds are FORMULA-SET from a real leveraged position, NOT discovered by
//     other traders' order flow. q does not aggregate anyone's belief.
//   • The payout comes from Flash's LP pool, NOT a shared pot of losers' stakes.
//   • What IS real: the underlying price, both barriers, and the iron rule —
//     you can NEVER lose more than your stake (the knockout = −stake, native).
//
// THE MATH (derived in the feasibility study; see SPEC-PREDICT-V2.md):
//   A perp is a clipped line; a binary is a step. Clamp BOTH ends — the native
//   knockout floors loss at −C, a take-profit at the strike ceils the win at +P
//   — and you get a one-touch binary {−C, +P}. Its YES price is:
//
//       R (payout multiple) = L·(t − fee)          // profit per $1 of stake
//       q (YES prob, 0..1)  = 1 / (1 + R)          // the "cents" when ×100
//
//   where L = leverage, t = favorable move to the strike (TP), C = stake,
//   fee = round-trip fee rate. Leverage is set by the KNOCKOUT distance
//   (koDist = 0.92/L), so the two real price levels — strike and knockout —
//   fully define the odds. Symmetric barriers give q≈0.52 for ANY leverage;
//   ASYMMETRY is what spans the ladder (far TP + near knockout = long shot).
// ─────────────────────────────────────────────────────────────────────────────

import { EST_ROUNDTRIP_FEE_RATE, LIQ_FACTOR, timeframe, type TimeframeId } from "./payoff";
import type { TradeType } from "flash-v2";

/** YES = the price ends ABOVE the strike (LONG) or BELOW it (SHORT). */
export type Direction = "ABOVE" | "BELOW";

/** Drift-style probability band: never quote a 0¢ or 100¢ "certainty". */
export const PROB_FLOOR = 0.03;
export const PROB_CEIL = 0.97;

/** Far favorable move (%) the longest-shot strike sits at, per timeframe — keeps
 *  strikes within a believable move so leverage (and the knockout) stay sane. */
const FAR_MOVE_PCT: Record<TimeframeId, number> = { "5m": 1.2, "15m": 2.5, "1h": 5 };

/** The default odds ladder — the YES prices we offer per token+timeframe. */
const DEFAULT_TARGETS = [0.85, 0.7, 0.55, 0.4, 0.25] as const;

export interface MarketConstruction {
  /** perp side expressing YES (ABOVE→LONG, BELOW→SHORT). */
  side: TradeType;
  /** target leverage — clamped to the market's live custody caps at open time. */
  leverage: number;
  /** take-profit price = the strike (the YES win boundary). */
  takeProfitPrice: number;
  /** knockout / liquidation price (the NO, lose-your-stake boundary). */
  knockoutPrice: number;
}

export interface Market {
  token: string;
  direction: Direction;
  /** the threshold price the question asks about (= the take-profit). */
  strike: number;
  /** the live price the odds were derived from (odds drift until you commit). */
  entry: number;
  timeframe: TimeframeId;
  /** implied probability of YES, clamped to [PROB_FLOOR, PROB_CEIL]. */
  prob: number;
  /** payout multiple R: profit per $1 of stake on YES (to-win = stake·(1+R)). */
  payoutMult: number;
}

export interface PricedMarket extends Market {
  construction: MarketConstruction;
}

const clampProb = (q: number) => Math.min(PROB_CEIL, Math.max(PROB_FLOOR, q));

// ── display helpers (cents = probability, the prediction-market lexicon) ───────

/** "42¢" — a YES/NO price as whole cents. */
export function cents(prob: number): number {
  return Math.round(clampProb(prob) * 100);
}

/** Total you receive per $1 staked on a winning YES (cost + profit). */
export function toWinPerDollar(prob: number): number {
  return 1 / clampProb(prob);
}

/** Total returned on a winning bet of `stakeUsd` (the "to win $X"). */
export function toWinUsd(stakeUsd: number, prob: number): number {
  return stakeUsd * toWinPerDollar(prob);
}

/** Profit (not total) on a winning bet — to-win minus the stake. */
export function profitUsd(stakeUsd: number, prob: number): number {
  return toWinUsd(stakeUsd, prob) - stakeUsd;
}

// ── the core: a strike + a knockout → leverage, odds, payout ──────────────────

/** Price one market from its two real price levels (strike = TP = YES win,
 *  knockoutPrice = liquidation = NO/lose). Leverage is implied by the knockout
 *  distance; the odds fall out of the construction. Pure. */
export function priceMarket(opts: {
  token: string;
  direction: Direction;
  entry: number;
  strike: number;
  knockoutPrice: number;
  timeframe: TimeframeId;
  feesRate?: number;
}): PricedMarket {
  const { token, direction, entry, strike, knockoutPrice, timeframe: tf } = opts;
  const feesRate = opts.feesRate ?? EST_ROUNDTRIP_FEE_RATE;
  const side: TradeType = direction === "ABOVE" ? "LONG" : "SHORT";

  const t = entry > 0 ? Math.abs(strike - entry) / entry : 0; // favorable move to TP
  const koDist = entry > 0 ? Math.abs(entry - knockoutPrice) / entry : 0; // adverse move to knockout
  // koDist = 0.92 / L  ⇒  L = 0.92 / koDist. Fees scale with size, so fees/C = feesRate·L,
  // giving R = L·t − feesRate·L = L·(t − feesRate).
  const leverage = koDist > 0 ? LIQ_FACTOR / koDist : 1;
  const payoutMult = Math.max(0, leverage * (t - feesRate));
  const prob = clampProb(1 / (1 + payoutMult));

  return {
    token, direction, strike, entry, timeframe: tf, prob, payoutMult,
    construction: { side, leverage, takeProfitPrice: strike, knockoutPrice },
  };
}

/** Solve the construction for a TARGET probability — pick leverage so the strike
 *  lands within the timeframe's believable move, then derive both price levels.
 *  This is how the ladder is generated (target 85¢, 70¢, 55¢, … and solve). */
export function marketForTargetProb(opts: {
  token: string;
  direction: Direction;
  entry: number;
  timeframe: TimeframeId;
  targetProb: number;
  maxLeverage?: number;
  feesRate?: number;
}): PricedMarket {
  const { token, direction, entry, timeframe: tf, targetProb } = opts;
  const feesRate = opts.feesRate ?? EST_ROUNDTRIP_FEE_RATE;
  const maxLev = opts.maxLeverage ?? 100;

  const q = clampProb(targetProb);
  const R = (1 - q) / q; // payout multiple needed for this YES price
  const tFar = FAR_MOVE_PCT[tf] / 100; // keep the strike within a believable move
  // L from t = R/L + fee ≤ tFar  ⇒  L ≥ R / (tFar − fee). Clamp to [1.1, maxLev].
  const span = Math.max(tFar - feesRate, 1e-4);
  const leverage = Math.min(maxLev, Math.max(1.1, R / span));
  const t = R / leverage + feesRate; // favorable move to the strike
  const koDist = LIQ_FACTOR / leverage; // adverse move to the knockout

  const strike = direction === "ABOVE" ? entry * (1 + t) : entry * (1 - t);
  const knockoutPrice = direction === "ABOVE" ? entry * (1 - koDist) : entry * (1 + koDist);
  // Re-price from the realized levels so prob reflects the clamped leverage exactly.
  return priceMarket({ token, direction, entry, strike, knockoutPrice, timeframe: tf, feesRate });
}

/** A token+timeframe+direction → the odds ladder (a row of YES markets). */
export function strikeLadder(opts: {
  token: string;
  entry: number;
  direction: Direction;
  timeframe: TimeframeId;
  targets?: readonly number[];
  maxLeverage?: number;
}): PricedMarket[] {
  const targets = opts.targets ?? DEFAULT_TARGETS;
  return targets.map((targetProb) =>
    marketForTargetProb({
      token: opts.token, direction: opts.direction, entry: opts.entry,
      timeframe: opts.timeframe, targetProb, maxLeverage: opts.maxLeverage,
    }),
  );
}

// ── multi-outcome buckets ("where does it land?") ─────────────────────────────

export interface OutcomeBucket {
  label: string;
  /** inclusive lower / exclusive upper price edge; null = open-ended. */
  lo: number | null;
  hi: number | null;
  /** normalized probability of landing in this bucket (sums to ~1 across buckets). */
  prob: number;
  /** the perp that expresses "lands in this bucket" (ABOVE the lo edge, TP'd below hi). */
  market: PricedMarket;
}

export interface BucketMarket {
  token: string;
  entry: number;
  timeframe: TimeframeId;
  buckets: OutcomeBucket[];
}

/** Build a multi-outcome market by partitioning the price axis at `edges`
 *  (ascending prices). Each bucket's raw probability comes from the perp
 *  construction; raw probabilities are normalized to sum to 1 (a proper
 *  outcome distribution), the way a real multi-outcome market's prices sum to $1. */
export function bucketMarket(opts: {
  token: string;
  entry: number;
  timeframe: TimeframeId;
  edges: number[];
  maxLeverage?: number;
}): BucketMarket {
  const { token, entry, timeframe: tf } = opts;
  const edges = [...opts.edges].sort((a, b) => a - b);
  // bucket boundaries: (-∞, e0), [e0, e1), … , [eN, +∞)
  const bounds: { lo: number | null; hi: number | null }[] = [];
  bounds.push({ lo: null, hi: edges[0] ?? null });
  for (let i = 0; i < edges.length - 1; i++) bounds.push({ lo: edges[i]!, hi: edges[i + 1]! });
  if (edges.length > 0) bounds.push({ lo: edges[edges.length - 1]!, hi: null });

  const raw = bounds.map((b) => {
    // Represent "lands in [lo,hi)" by the side that points at the bucket's centre,
    // with the TP at the near edge — a faithful one-touch proxy for the bucket.
    const centre = b.lo == null ? b.hi! * 0.99 : b.hi == null ? b.lo * 1.01 : (b.lo + b.hi) / 2;
    const direction: Direction = centre >= entry ? "ABOVE" : "BELOW";
    const strike = b.lo == null ? b.hi! : b.hi == null ? b.lo : (direction === "ABOVE" ? b.lo : b.hi);
    const koDistPct = FAR_MOVE_PCT[tf] / 100;
    const knockoutPrice = direction === "ABOVE" ? entry * (1 - koDistPct) : entry * (1 + koDistPct);
    const m = priceMarket({ token, direction, entry, strike, knockoutPrice, timeframe: tf });
    return { b, m, direction };
  });

  const sum = raw.reduce((s, r) => s + r.m.prob, 0) || 1;
  const buckets: OutcomeBucket[] = raw.map(({ b, m }) => ({
    label: bucketLabel(b.lo, b.hi),
    lo: b.lo,
    hi: b.hi,
    prob: m.prob / sum, // normalized so the outcome distribution sums to 1
    market: m,
  }));
  return { token, entry, timeframe: tf, buckets };
}

function bucketLabel(lo: number | null, hi: number | null): string {
  const f = (n: number) => (n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(2));
  if (lo == null) return `< ${f(hi!)}`;
  if (hi == null) return `≥ ${f(lo)}`;
  return `${f(lo)} – ${f(hi)}`;
}

// ── the bridge to the trade builder ───────────────────────────────────────────

/** The flash.openPosition params that OPEN a YES position for this market at a
 *  given stake — a capped-loss perp with the bundled take-profit = the strike.
 *  (Shape matches OpenPositionRequest; the caller adds owner + session fields.) */
export function openParamsFor(m: PricedMarket, stakeUsd: number) {
  return {
    inputTokenSymbol: "USDC",
    outputTokenSymbol: m.token,
    inputAmountUi: stakeUsd.toFixed(2),
    leverage: Number(m.construction.leverage.toFixed(4)),
    tradeType: m.construction.side,
    orderType: "MARKET" as const,
    // bundled TP = the YES win boundary; the knockout is the native liquidation.
    takeProfit: m.construction.takeProfitPrice.toFixed(4),
  };
}

/** Human one-liner for a market question (plain words, no trading vocabulary). */
export function questionFor(m: Market): string {
  const tf = timeframe(m.timeframe).label;
  const f = (n: number) => (n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(2));
  const dir = m.direction === "ABOVE" ? "above" : "below";
  return `${m.token} ${dir} ${f(m.strike)} in ${tf}?`;
}
