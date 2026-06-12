// ─────────────────────────────────────────────────────────────────────────────
// lib/rounds.ts — rounds are a CACHE; chain positions are the truth.
// THE HARD PART: reconciliation. Positions carry NO timestamp, so the join
// key is (marketSymbol, sideUi) — valid because one position per market+side
// exists at a time. Settlement triggers on OBSERVED state (snapshot + clock),
// never a bare setTimeout; "settling" status + an in-flight set guard against
// double-close. GOTCHAS.md → "The 97% full-close threshold" (we always send
// "0" = explicit FULL close) (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────

import type { BasketSnapshot, PositionMetrics } from "flash-v2";
import type { TimeframeId } from "./payoff";
import type { LockedQuote } from "./payoff";

export const SCHEMA_VERSION = 1;

/** New rounds are invisible to reconciliation for this long — the position
 *  needs a beat to appear in the owner stream after the ER confirm. */
export const PROPAGATION_GRACE_MS = 5_000;

export type Side = "LONG" | "SHORT";

export type RoundStatus =
  | "active" // position open, clock running (or adopted: no clock)
  | "settling" // close dispatched, awaiting confirm
  | "settled" // we closed it; result recorded
  | "closed-elsewhere"; // position vanished without our close (other device / liquidated)

export interface RoundResult {
  pnlUsd: number;
  won: boolean;
  settledAt: number;
  /** ER tx signature of the close — the round's receipt. */
  signature?: string;
}

export interface Round {
  id: string;
  market: string; // marketSymbol, e.g. "SOL"
  side: Side;
  stakeUsd: number;
  leverage: number;
  timeframe: TimeframeId | null; // null = adopted position, settle-now only
  placedAt: number;
  expiresAt: number | null; // null = adopted, no clock
  quote: LockedQuote;
  status: RoundStatus;
  result?: RoundResult;
  /** The user saw and dismissed the result card (ack gates new rounds). */
  acked?: boolean;
}

interface StoredRounds {
  v: number;
  rounds: Round[];
}

const roundsKey = (owner: string) => `predict-rounds-${owner}`;

export function loadRounds(owner: string): Round[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(roundsKey(owner));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredRounds;
    if (parsed.v !== SCHEMA_VERSION || !Array.isArray(parsed.rounds)) {
      window.localStorage.removeItem(roundsKey(owner));
      return [];
    }
    return parsed.rounds;
  } catch {
    return [];
  }
}

export function saveRounds(owner: string, rounds: Round[]): void {
  if (typeof window === "undefined") return;
  const stored: StoredRounds = { v: SCHEMA_VERSION, rounds };
  window.localStorage.setItem(roundsKey(owner), JSON.stringify(stored));
}

export function newRoundId(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** A live position with no matching round — opened elsewhere (or a lost
 *  cache). Surfaced for adoption: settle-now only, no invented clock. */
export interface Orphan {
  market: string;
  side: Side;
  metrics: PositionMetrics;
}

export interface ReconcileResult {
  /** Expired, position still on chain → dispatch full close. */
  toSettle: Round[];
  /** Round says active, chain says gone → mark closed-elsewhere. */
  closedElsewhere: Round[];
  /** Chain position with no round → offer adoption. */
  orphans: Orphan[];
}

const sideOf = (p: PositionMetrics): Side => (p.sideUi.toUpperCase() === "LONG" ? "LONG" : "SHORT");

/** The round↔chain join: one position per market+side exists at a time. */
export function positionFor(snapshot: BasketSnapshot, market: string, side: Side): PositionMetrics | undefined {
  return Object.values(snapshot.positionMetrics).find(
    (p) => p.marketSymbol === market && sideOf(p) === side && Number(p.sizeUsdUi) > 0,
  );
}

/** Pure classification — no I/O, no status writes. Rounds inside the
 *  propagation grace window are left untouched in BOTH directions. */
export function reconcile(rounds: Round[], snapshot: BasketSnapshot | null, nowMs: number): ReconcileResult {
  const result: ReconcileResult = { toSettle: [], closedElsewhere: [], orphans: [] };
  if (!snapshot) return result;

  const active = rounds.filter((r) => r.status === "active");

  for (const round of active) {
    if (nowMs - round.placedAt < PROPAGATION_GRACE_MS) continue;
    const pos = positionFor(snapshot, round.market, round.side);
    if (!pos) {
      result.closedElsewhere.push(round);
    } else if (round.expiresAt !== null && nowMs >= round.expiresAt) {
      result.toSettle.push(round);
    }
  }

  const claimed = new Set(
    rounds
      .filter((r) => r.status === "active" || r.status === "settling")
      .map((r) => `${r.market}|${r.side}`),
  );
  for (const p of Object.values(snapshot.positionMetrics)) {
    if (Number(p.sizeUsdUi) <= 0) continue;
    const key = `${p.marketSymbol}|${sideOf(p)}`;
    if (!claimed.has(key)) result.orphans.push({ market: p.marketSymbol, side: sideOf(p), metrics: p });
  }

  return result;
}

/** Status transitions, applied immutably. */
export function withStatus(rounds: Round[], id: string, status: RoundStatus): Round[] {
  return rounds.map((r) => (r.id === id ? { ...r, status } : r));
}

export function withResult(rounds: Round[], id: string, result: RoundResult): Round[] {
  return rounds.map((r) => (r.id === id ? { ...r, status: "settled" as const, result } : r));
}

export function withAck(rounds: Round[], id: string): Round[] {
  return rounds.map((r) => (r.id === id ? { ...r, acked: true } : r));
}

/** Results waiting to be seen — drives the SettleCard queue, oldest first. */
export function pendingAcks(rounds: Round[]): Round[] {
  return rounds
    .filter((r) => (r.status === "settled" || r.status === "closed-elsewhere") && !r.acked)
    .sort((a, b) => (a.result?.settledAt ?? a.placedAt) - (b.result?.settledAt ?? b.placedAt));
}

/** Adopt an orphan as a clockless round so it can be watched and settled. */
export function adoptOrphan(orphan: Orphan, nowMs: number): Round {
  const collateral = Number(orphan.metrics.collateralUsdUi) || 0;
  const size = Number(orphan.metrics.sizeUsdUi) || 0;
  const entry = Number(orphan.metrics.entryPriceUi) || 0;
  const leverage = collateral > 0 ? size / collateral : 1;
  return {
    id: newRoundId(),
    market: orphan.market,
    side: orphan.side,
    stakeUsd: collateral,
    leverage,
    timeframe: null,
    placedAt: nowMs,
    expiresAt: null,
    quote: {
      entryPrice: entry,
      liqPrice: Number(orphan.metrics.liquidationPriceUi) || 0,
      entryFeeUsd: 0,
      marginFeePctHourly: 0,
      perPctUsd: size / 100,
      breakEvenPct: 0,
      sizeUsd: size,
    },
    status: "active",
  };
}

export interface RoundStats {
  played: number;
  wins: number;
  losses: number;
  winRatePct: number;
  totalPnlUsd: number;
  streak: number; // positive = current win streak, negative = loss streak
}

export function roundStats(rounds: Round[]): RoundStats {
  const settled = rounds
    .filter((r) => r.status === "settled" && r.result)
    .sort((a, b) => (a.result?.settledAt ?? 0) - (b.result?.settledAt ?? 0));
  const wins = settled.filter((r) => r.result?.won).length;
  const losses = settled.length - wins;
  let streak = 0;
  for (let i = settled.length - 1; i >= 0; i--) {
    const won = settled[i]?.result?.won ?? false;
    if (streak === 0) streak = won ? 1 : -1;
    else if (won && streak > 0) streak++;
    else if (!won && streak < 0) streak--;
    else break;
  }
  return {
    played: settled.length,
    wins,
    losses,
    winRatePct: settled.length ? (wins / settled.length) * 100 : 0,
    totalPnlUsd: settled.reduce((s, r) => s + (r.result?.pnlUsd ?? 0), 0),
    streak,
  };
}
