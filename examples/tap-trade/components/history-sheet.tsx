// ─────────────────────────────────────────────────────────────────────────────
// components/history-sheet.tsx — the session's transaction history, newest
// first. TEACHABLE PATTERN: the latency log (lib/hooks.ts → useLatencyLog)
// already captures every confirmed action {action, chain, ms, signature, at} —
// a history view is a RENDER of that log, not a second data source. For
// durable cross-session history, page Helius getSignaturesForAddress instead.
// GOTCHAS.md → (render-only; no API gotchas) (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import Sheet from "@/components/sheet";
import { explorerTx } from "@/lib/flash";
import { fmtMs, fmtPnlUsd, fmtUsd, shortKey } from "@/lib/format";
import type { LatencyEntry } from "@/lib/hooks";

function ago(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

export default function HistorySheet({
  open,
  onClose,
  entries,
}: {
  open: boolean;
  onClose: () => void;
  entries: LatencyEntry[];
}) {
  return (
    <Sheet open={open} onClose={onClose} label="transaction history">
      <p className="font-display text-[15px] font-semibold text-ink">History</p>
      <p className="mt-1 text-xs leading-relaxed text-dim">
        Every confirmed action this session — newest first, with the real confirm time and the
        on-chain signature.
      </p>

      {entries.length === 0 ? (
        <p className="mt-5 font-mono text-[11px] text-faint">
          nothing yet — your first action lands here with its signature
        </p>
      ) : (
        <ol className="mt-4 grid gap-0 divide-y divide-edge">
          {entries.map((e) => (
            <li key={e.id} className="row-in grid grid-cols-[1fr_auto] items-baseline gap-x-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-mono text-xs font-semibold text-ink">
                  {e.trade ? `${e.trade.market} · ` : ""}{e.action}
                </p>
                {e.trade && (e.trade.entryUi !== null || e.trade.collateralUi !== null) && (
                  <p className="mt-0.5 font-mono text-[10px] tabular-nums text-dim">
                    {e.trade.entryUi !== null ? `entry ${fmtUsd(e.trade.entryUi)}` : ""}
                    {e.trade.entryUi !== null && e.trade.collateralUi !== null ? " · " : ""}
                    {e.trade.collateralUi !== null ? `collateral ${fmtUsd(e.trade.collateralUi)}` : ""}
                  </p>
                )}
                <p className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-faint">
                  <span
                    className={`rounded-[2px] border px-1 py-px uppercase tracking-[0.1em] ${
                      e.chain === "er" ? "border-long/40 text-long" : "border-edge2 text-dim"
                    }`}
                  >
                    {e.chain === "er" ? "rollup" : "base"}
                  </span>
                  {ago(e.at)}
                </p>
              </div>
              <div className="text-right">
                {e.trade?.pnlUi !== null && e.trade?.pnlUi !== undefined && (
                  <p className={`font-mono text-sm font-semibold tabular-nums ${e.trade.pnlUi >= 0 ? "text-long" : "text-short"}`}>
                    {fmtPnlUsd(e.trade.pnlUi)}
                  </p>
                )}
                <p className="font-mono text-xs tabular-nums text-dim">{fmtMs(e.ms)}</p>
                <a
                  href={explorerTx(e.signature)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[10px] text-faint underline-offset-2 hover:text-ink hover:underline"
                >
                  {shortKey(e.signature)}
                </a>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Sheet>
  );
}
