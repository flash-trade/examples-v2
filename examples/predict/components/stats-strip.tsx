// ─────────────────────────────────────────────────────────────────────────────
// components/stats-strip.tsx — your record: rounds, win rate, net PnL, streak.
// THE HARD PART: numbers from settled rounds only — live PnL never leaks in
// here (it belongs to the active round card). Tabular mono keeps it still.
// GOTCHAS.md → (no API gotchas here) (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { fmtPnlUsd } from "@/lib/format";
import type { RoundStats } from "@/lib/rounds";

export function StatsStrip({ stats }: { stats: RoundStats }) {
  if (stats.played === 0) return null;
  const pnlClass = stats.totalPnlUsd > 0 ? "text-up" : stats.totalPnlUsd < 0 ? "text-down" : "text-dim";
  const streakLabel =
    stats.streak > 1 ? `${stats.streak}× win streak` : stats.streak < -1 ? `${-stats.streak}× loss streak` : null;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11px] text-dim">
      <span>
        {stats.wins}W <span className="text-faint">·</span> {stats.losses}L
      </span>
      <span>{stats.winRatePct.toFixed(0)}% win rate</span>
      <span className={pnlClass}>{fmtPnlUsd(stats.totalPnlUsd)} all-time</span>
      {streakLabel && (
        <span className={`rounded-full border px-2 py-0.5 ${stats.streak > 0 ? "border-up/30 text-up" : "border-down/30 text-down"}`}>
          {streakLabel}
        </span>
      )}
    </div>
  );
}
