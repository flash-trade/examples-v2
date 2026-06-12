// ─────────────────────────────────────────────────────────────────────────────
// components/history.tsx — settled rounds, newest first, each with receipt.
// THE HARD PART: nothing clever — terse rows, tabular numbers, capped at 50.
// "closed-elsewhere" rows stay honest about what we don't know.
// GOTCHAS.md → (no API gotchas here) (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { explorerTxUrl } from "@/lib/copy";
import { fmtPnlUsd, fmtUsd } from "@/lib/format";
import type { Round } from "@/lib/rounds";

export function History({ rounds }: { rounds: Round[] }) {
  const done = rounds
    .filter((r) => r.status === "settled" || r.status === "closed-elsewhere")
    .sort((a, b) => (b.result?.settledAt ?? b.placedAt) - (a.result?.settledAt ?? a.placedAt))
    .slice(0, 50);

  if (done.length === 0) return null;

  return (
    <section aria-label="Round history">
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-[0.25em] text-faint">History</h3>
      <ul className="space-y-1">
        {done.map((r) => {
          const pnl = r.result?.pnlUsd ?? null;
          return (
            <li key={r.id} className="flex items-center gap-2.5 rounded-xl border border-edge bg-panel px-3 py-2 font-mono text-[12px]">
              <span className={r.side === "LONG" ? "text-up" : "text-down"}>{r.side === "LONG" ? "▲" : "▼"}</span>
              <span className="text-ink">{r.market}</span>
              <span className="text-faint">{r.timeframe ?? "manual"} · {fmtUsd(r.stakeUsd)}</span>
              <span className={`ml-auto ${pnl === null ? "text-faint" : pnl >= 0 ? "text-up" : "text-down"}`}>
                {r.status === "closed-elsewhere" ? "settled elsewhere" : pnl !== null ? fmtPnlUsd(pnl) : "—"}
              </span>
              {r.result?.signature && (
                <a href={explorerTxUrl(r.result.signature)} target="_blank" rel="noreferrer" className="text-faint underline decoration-edge2 underline-offset-2 hover:text-dim">
                  ↗
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
