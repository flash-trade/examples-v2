// ─────────────────────────────────────────────────────────────────────────────
// lib/markets.ts — the PREDICTION-MARKET engine (v2.1, SPREAD-AWARE).
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
// ── THE CORRECTED MATH — measure EVERYTHING from the FILL, not the oracle ─────
//   A money-path audit (SPEC-PREDICT-V2 §v2.1) found the original engine modeled
//   cost as a 0.16% fee and IGNORED Flash's real 5–10% trade spread. A LONG fills
//   at oracle·(1+s), so a take-profit computed off the oracle lands INSIDE the
//   spread and fires as a ~100% LOSS. The fix: the fill is the origin.
//
//       fillEntry = oracle·(1 ± s)              // + for ABOVE/LONG, − for BELOW/SHORT
//       strike    = fillEntry·(1 ± t)           // the TP, set BEYOND the fill (the win)
//       knockout  = fillEntry·(1 ∓ 0.92/L)      // liquidation (the loss)
//       R         = L·(t − fee)   q = 1/(1 + R) // t is the move FROM THE FILL; q honest
//       to-win    = stake/q       max-loss = stake
//
//   L = leverage, t = favorable move to the strike, fee = round-trip fee rate.
//   Symmetric barriers give q≈0.52 for ANY leverage; ASYMMETRY spans the ladder
//   (far TP + near knockout = long shot). Because the strike sits a full spread
//   ABOVE the oracle, high-spread tokens (SOL ≈ 10%) are honestly long-shot-only.
//
// ── THE HARD CONSTRAINT — the knockout must clear the spread ──────────────────
//   At high L, koDist = 0.92/L can be SMALLER than s → the position opens already
//   past liquidation. So leverage is capped: L ≤ 0.92/(s·KO_MARGIN). On SOL
//   (s=0.10) that is ≈ 6×. High-spread markets are naturally low-leverage. This
//   invariant is enforced at the single chokepoint `priceMarket`, so NO market —
//   however constructed — can be quoted with a knockout inside the spread.
// ─────────────────────────────────────────────────────────────────────────────

import { EST_ROUNDTRIP_FEE_RATE, LIQ_FACTOR, timeframe, type TimeframeId } from "./payoff";
import type { TradeType } from "flash-v2";

/** YES = the price ends ABOVE the strike (LONG) or BELOW it (SHORT). */
export type Direction = "ABOVE" | "BELOW";

/** Drift-style probability band: never quote a 0¢ or 100¢ "certainty". */
export const PROB_FLOOR = 0.03;
export const PROB_CEIL = 0.97;

/** The knockout must sit at least this multiple of the spread beyond the fill,
 *  so a fresh position is never already past liquidation. */
export const KO_MARGIN = 1.5;

/** Nominal favorable move (%) per timeframe — the move-scale that sets leverage
 *  for a target. While leverage is below the cap, rungs differ by leverage (near
 *  vs far knockout); once leverage pins at the spread cap (high-spread tokens),
 *  rungs differ by STRIKE instead, so the ladder still spans. */
const FAR_MOVE_PCT: Record<TimeframeId, number> = { "5m": 1.2, "15m": 2.5, "1h": 5 };

/** Generous absolute ceiling on the strike move from the fill, per timeframe —
 *  bounds pathological far strikes only; large enough to never squash the default
 *  ladder. A deep long-shot that needs more move than this isn't offered (its q
 *  floats up to the deepest the timeframe honestly supports). */
const STRIKE_MOVE_CEIL: Record<TimeframeId, number> = { "5m": 0.15, "15m": 0.35, "1h": 0.75 };

/** The default odds ladder — the YES prices we offer per token+timeframe. */
const DEFAULT_TARGETS = [0.85, 0.7, 0.55, 0.4, 0.25] as const;

/** The probability a card's single headline question targets (then rounded). */
const HEADLINE_TARGET = 0.58;

export interface MarketConstruction {
  /** perp side expressing YES (ABOVE→LONG, BELOW→SHORT). */
  side: TradeType;
  /** target leverage — already clamped to the spread constraint + custody caps. */
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
  /** the live ORACLE price (what the card shows; the question is framed off it). */
  oracle: number;
  /** the SIGNED-FILL entry the odds are actually measured from (oracle·(1±s)). */
  entry: number;
  /** the trade spread this market was priced through (side-appropriate fraction). */
  spread: number;
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

// ── the spread-aware primitives ───────────────────────────────────────────────

/** The signed-fill entry price — the ORIGIN every barrier is measured from.
 *  A LONG buys at the ask (oracle·(1+s)); a SHORT sells at the bid (oracle·(1−s)). */
export function fillEntryFrom(oracle: number, spread: number, direction: Direction): number {
  const s = Math.max(0, spread);
  return direction === "ABOVE" ? oracle * (1 + s) : oracle * (1 - s);
}

/** The price a position REALIZES when its take-profit triggers at `strike`. The
 *  exit crosses the spread the OTHER way — a LONG sells at the bid (strike·(1−s)),
 *  a SHORT buys at the ask (strike·(1+s)) — so the spread is paid AGAIN on exit.
 *  This is why a take-profit must clear TWO spreads to actually win (verified live:
 *  a $90 SOL TP exits at $81 and nets ≈ $0). PnL is driven by entryFill→exitFill. */
export function exitFillFrom(strike: number, spread: number, direction: Direction): number {
  const s = Math.max(0, spread);
  return direction === "ABOVE" ? strike * (1 - s) : strike * (1 + s);
}

/** The highest leverage whose knockout (0.92/L from the fill) still clears the
 *  spread, intersected with the custody cap. Spread-free markets (FX) are capped
 *  only by custody. This is THE constraint that stops an already-liquidated open. */
export function maxLeverageForSpread(spread: number, custodyMaxLeverage: number): number {
  const s = Math.max(0, spread);
  const spreadCap = s > 0 ? LIQ_FACTOR / (s * KO_MARGIN) : Infinity;
  const custody = custodyMaxLeverage > 0 ? custodyMaxLeverage : Infinity;
  return Math.max(1, Math.min(custody, spreadCap));
}

// ── the core: oracle + spread + leverage + strike → odds, payout, both barriers ──

/** Price one market from live facts. THE CHOKEPOINT: leverage is clamped here so
 *  the knockout always clears the spread (CRIT-2), regardless of caller. The odds
 *  fall out of the construction. Pure — never throws, never returns NaN. */
export function priceMarket(opts: {
  token: string;
  direction: Direction;
  /** live oracle price (> 0; a non-positive oracle yields an unpriceable q=floor). */
  oracle: number;
  /** side-appropriate trade spread as a fraction (SOL≈0.10, BTC/ETH≈0.05, FX 0). */
  spread: number;
  /** desired leverage; clamped down so koDist ≥ spread·KO_MARGIN. */
  leverage: number;
  /** the strike / take-profit price the question asks about. */
  strike: number;
  timeframe: TimeframeId;
  feesRate?: number;
}): PricedMarket {
  const { token, direction, timeframe: tf } = opts;
  const oracle = opts.oracle;
  const spread = Math.max(0, opts.spread);
  const feesRate = opts.feesRate ?? EST_ROUNDTRIP_FEE_RATE;
  const side: TradeType = direction === "ABOVE" ? "LONG" : "SHORT";

  // Spread invariant enforced HERE: no quoted market can have a knockout inside
  // the spread, even if a caller passes an unclamped leverage.
  const lev = clampLeverage(opts.leverage, spread, Infinity);
  const entryFill = oracle > 0 ? fillEntryFrom(oracle, spread, direction) : 0;

  // The TP triggers at the strike but EXITS through the spread, so PnL is driven
  // by the entry-fill → exit-fill move — the spread is paid on BOTH legs. t is
  // that NET favorable move; koDist is the adverse move to liquidation.
  const exitFill = exitFillFrom(opts.strike, spread, direction);
  const t = entryFill > 0
    ? (direction === "ABOVE" ? exitFill / entryFill - 1 : 1 - exitFill / entryFill)
    : 0;
  const koDist = LIQ_FACTOR / lev;
  const knockoutPrice = direction === "ABOVE" ? entryFill * (1 - koDist) : entryFill * (1 + koDist);

  // R = L·t − fees/C = L·(t − fee) (fees scale with size). t ≤ fee ⇒ R floors at 0.
  const payoutMult = Math.max(0, lev * (t - feesRate));
  // A non-positive / non-finite oracle is UNPRICEABLE → floor (3¢ "no"), never the
  // 97¢ ceiling a zero entry would otherwise paint (a broken feed must not read as
  // a near-certain YES). Live cards also gate on loaded limits + a positive price.
  const prob = oracle > 0 ? clampProb(1 / (1 + payoutMult)) : PROB_FLOOR;

  return {
    token, direction, strike: opts.strike, oracle, entry: entryFill, spread, timeframe: tf, prob, payoutMult,
    construction: { side, leverage: lev, takeProfitPrice: opts.strike, knockoutPrice },
  };
}

/** Clamp a desired leverage into [floor, spread∧custody cap]. */
function clampLeverage(desired: number, spread: number, custodyMaxLeverage: number, floor = 1): number {
  const cap = maxLeverageForSpread(spread, custodyMaxLeverage);
  const lo = Math.max(1, floor);
  const d = Number.isFinite(desired) && desired > 0 ? desired : lo;
  return Math.max(lo, Math.min(cap, d));
}

/** Solve the construction for a TARGET probability — pick the leverage that lands
 *  the strike within the timeframe's believable move, clamp it to the spread +
 *  custody caps, then derive both price levels from the FILL. This is how each
 *  ladder rung is generated. On high-spread tokens a deep long-shot target may be
 *  unreachable within the leverage cap; q then floats to the deepest the token
 *  honestly allows (the strike is held at the believable-move boundary). */
export function marketForTargetProb(opts: {
  token: string;
  direction: Direction;
  oracle: number;
  spread: number;
  maxLeverage: number;
  minLeverage?: number;
  timeframe: TimeframeId;
  targetProb: number;
  feesRate?: number;
}): PricedMarket {
  const { token, direction, oracle, spread, timeframe: tf, targetProb } = opts;
  const feesRate = opts.feesRate ?? EST_ROUNDTRIP_FEE_RATE;
  const floor = Math.max(1.1, opts.minLeverage ?? 1.1);

  const q = clampProb(targetProb);
  const R = (1 - q) / q; // payout multiple needed for this YES price
  const nominal = FAR_MOVE_PCT[tf] / 100; // move-scale that sets leverage
  const span = Math.max(nominal - feesRate, 1e-4);
  // Target the leverage that hits R at the nominal move, clamped to [floor, cap].
  // When the cap bites (high-spread tokens), leverage pins and the strike extends.
  const leverage = clampLeverage(R / span, spread, opts.maxLeverage, floor);
  // Strike move follows from the (possibly pinned) leverage; bounded only by the
  // pathology ceiling. Pinned leverage ⇒ deeper rungs ⇒ farther strikes (the
  // ladder spans by STRIKE). If the ceiling bites, q floats up (honest).
  const t = Math.min(R / leverage + feesRate, STRIKE_MOVE_CEIL[tf]);

  const entryFill = oracle > 0 ? fillEntryFrom(oracle, spread, direction) : 0;
  const sClamp = Math.min(0.99, Math.max(0, spread));
  // Place the strike so that AFTER the exit spread the NET move is t:
  //   LONG  exit = strike·(1−s) = entryFill·(1+t) ⇒ strike = entryFill·(1+t)/(1−s)
  //   SHORT exit = strike·(1+s) = entryFill·(1−t) ⇒ strike = entryFill·(1−t)/(1+s)
  const strike = direction === "ABOVE"
    ? (entryFill * (1 + t)) / (1 - sClamp)
    : (entryFill * (1 - t)) / (1 + sClamp);
  // Re-price from the realized strike + clamped leverage so prob is exact.
  return priceMarket({ token, direction, oracle, spread, leverage, strike, timeframe: tf, feesRate });
}

/** A token+timeframe+direction → the odds ladder (a row of YES markets). Rungs
 *  that collapse to the same strike under the leverage cap (high-spread tokens)
 *  are de-duplicated, so the ladder never shows two identical bets. */
export function strikeLadder(opts: {
  token: string;
  oracle: number;
  spread: number;
  maxLeverage: number;
  minLeverage?: number;
  direction: Direction;
  timeframe: TimeframeId;
  targets?: readonly number[];
}): PricedMarket[] {
  const targets = opts.targets ?? DEFAULT_TARGETS;
  const out: PricedMarket[] = [];
  const seen = new Set<string>();
  for (const targetProb of targets) {
    const m = marketForTargetProb({
      token: opts.token, direction: opts.direction, oracle: opts.oracle, spread: opts.spread,
      maxLeverage: opts.maxLeverage, minLeverage: opts.minLeverage, timeframe: opts.timeframe, targetProb,
    });
    const key = m.strike.toPrecision(6);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

// ── the card headline ─────────────────────────────────────────────────────────

/** Round a target strike to a clean, human number CLOSE to it (≈2 significant
 *  figures) for a card headline — close enough that the re-priced odds stay near
 *  the target, clean enough to read as a real question ("Will SOL hit $100?").
 *  Coarse "next nice number up" rounding overshot a 58¢ target to a 30¢ long-shot. */
function roundStrikeNice(price: number): number {
  if (!(price > 0)) return 0;
  return Number(price.toPrecision(price >= 1 ? 2 : 3));
}

/** The single "climb above" headline a card shows. Targets a believable headline
 *  probability through the corrected (two-spread) solver, then rounds the strike
 *  to a human number and RE-PRICES so the cents stay honest for the rounded
 *  strike. Each token's own spread + caps make the cents FLOAT — no two alike. */
export function headlineMarket(opts: {
  token: string;
  oracle: number;
  spread: number;
  maxLeverage: number;
  minLeverage?: number;
  timeframe: TimeframeId;
  direction?: Direction;
}): PricedMarket {
  const direction = opts.direction ?? "ABOVE";
  const target = marketForTargetProb({
    token: opts.token, direction, oracle: opts.oracle, spread: opts.spread,
    maxLeverage: opts.maxLeverage, minLeverage: opts.minLeverage,
    timeframe: opts.timeframe, targetProb: HEADLINE_TARGET,
  });
  const strike = direction === "ABOVE" ? roundStrikeNice(target.strike) : target.strike;
  return priceMarket({
    token: opts.token, direction, oracle: opts.oracle, spread: opts.spread,
    leverage: target.construction.leverage, strike, timeframe: opts.timeframe,
  });
}

// NOTE: multi-outcome "buckets" were REMOVED (SPEC §v2.1 fix #7). A single
// capped-loss perp + one take-profit can only express a ONE-TOUCH "reaches X",
// never a bounded "lands between X and Y" (that needs a call-spread = two
// positions), and the honest one-touch relabel degenerated to 97¢ inside the
// spread. The strike ladder already gives honest reach-odds. The old bucketMarket
// / openParamsFor builders were deleted too — they were undefended exported paths
// that would render a guaranteed-loss strike as 97¢ if re-wired. A future
// call-spread rebuild is a flagged, user-approved scope item.

// ── the bridge to the trade builder ───────────────────────────────────────────

/** Slippage tolerance that clears the trade spread with headroom. A hardcoded
 *  "1" is far below a 5–10% spread and rejects every fill (SPEC §v2.1 fix #8). */
export function slippageForSpread(spread: number): string {
  const pct = Math.max(1, Math.ceil((Math.max(0, spread) * 1.5) * 100));
  return String(pct);
}

/** Human one-liner for a market question (plain words, no trading vocabulary).
 *  Framed off the ORACLE — the price a person sees — not the internal fill. */
export function questionFor(m: Market): string {
  const tf = timeframe(m.timeframe).label;
  const f = (n: number) => (n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(2));
  const dir = m.direction === "ABOVE" ? "above" : "below";
  return `${m.token} ${dir} ${f(m.strike)} in ${tf}?`;
}
