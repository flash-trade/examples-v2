// ─────────────────────────────────────────────────────────────────────────────
// components/latency-sheet.tsx — the old HUD, compacted into a sheet: last ER
// confirm big, ER vs L1 bars, session log. THE HARD PART: honesty — every
// number is a REAL submit→confirmed confirmMs from flash-v2; the L1 bar is a
// static, clearly-labeled ~400ms typical baseline, never a measurement.
// GOTCHAS.md → "Two chains, one flow" (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import Sheet from "@/components/sheet";
import { explorerTx, SOLANA_L1_TYPICAL_MS } from "@/lib/flash";
import { fmtMs, median, shortKey } from "@/lib/format";
import type { LatencyEntry } from "@/lib/hooks";

export default function LatencySheet({
  open,
  onClose,
  entries,
}: {
  open: boolean;
  onClose: () => void;
  entries: LatencyEntry[];
}) {
  const erEntries = entries.filter((e) => e.chain === "er");
  const last = erEntries[0] ?? null;
  const med = median(erEntries.map((e) => e.ms));
  const scale = Math.max(SOLANA_L1_TYPICAL_MS, last?.ms ?? 0);
  const erPct = last ? Math.max((last.ms / scale) * 100, 1.5) : 0;
  const l1Pct = (SOLANA_L1_TYPICAL_MS / scale) * 100;
  const log = entries.slice(0, 12);

  return (
    <Sheet open={open} onClose={onClose} label="session latency">
      <div className="grid grid-cols-[1fr_auto] items-baseline">
        <p className="font-display text-[15px] font-semibold text-ink">Latency</p>
        <p className="font-mono text-[11px] tabular-nums text-dim">
          {med !== null ? `median ${fmtMs(med)} · ${erEntries.length} ER tx${erEntries.length === 1 ? "" : "s"}` : "median —"}
        </p>
      </div>

      {/* headline: the last real ER confirm */}
      <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {last ? (
          <>
            <span className="font-mono text-5xl font-bold tabular-nums tracking-tight text-ink">
              {last.ms}
              <span className="ml-1.5 text-xl text-dim">ms</span>
            </span>
            <span className="text-xs text-dim">submit → confirmed, from this machine</span>
            {last.sendMs !== undefined && (
              <span className="w-full font-mono text-[11px] tabular-nums text-dim">
                ≈ {Math.min(last.ms, last.sendMs * 2)} ms your network (2 trips ×{last.sendMs}) ·{" "}
                <span className="text-long">rollup execution ≈ {Math.max(0, last.ms - last.sendMs * 2)} ms</span>
              </span>
            )}
          </>
        ) : (
          <>
            <span className="font-mono text-5xl font-bold tracking-tight text-faint">—</span>
            <span className="text-xs text-faint">tap SHORT or LONG to measure a real confirm</span>
          </>
        )}
      </div>

      {/* ER vs L1 bars */}
      <div className="mt-5 grid gap-2.5">
        <div className="grid grid-cols-[7rem_1fr_4rem] items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-dim">ephemeral rollup</span>
          <div className="h-1.5 overflow-hidden bg-panel2">
            {last && (
              <div key={last.id} className="bar-grow h-full bg-long" style={{ width: `${erPct}%` }} />
            )}
          </div>
          <span className="text-right font-mono text-xs tabular-nums text-long">
            {last ? fmtMs(last.ms) : "—"}
          </span>
        </div>
        <div className="grid grid-cols-[7rem_1fr_4rem] items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">solana L1 typical</span>
          <div className="h-1.5 overflow-hidden bg-panel2">
            <div className="h-full bg-edge2" style={{ width: `${l1Pct}%` }} />
          </div>
          <span className="text-right font-mono text-xs tabular-nums text-faint">~{SOLANA_L1_TYPICAL_MS} ms</span>
        </div>
        <p className="font-mono text-[10px] leading-relaxed text-faint">
          ER bar includes YOUR network distance twice; the rollup itself executes in the leftover ms. L1 bar = static ~400 ms network-confirm typical (it EXCLUDES your distance — measured the same way it would read far higher).
        </p>
      </div>

      {/* session log */}
      {log.length > 0 ? (
        <ul className="mt-5 divide-y divide-edge border-t border-edge">
          {log.map((e) => (
            <li key={e.id} className="row-in grid grid-cols-[3.5rem_1fr_auto_3.5rem_5.5rem] items-center gap-2 py-2 font-mono text-[11px] tabular-nums">
              <span className="text-faint">
                {new Date(e.at).toLocaleTimeString("en-US", { hour12: false })}
              </span>
              <span className="truncate text-dim">{e.action}</span>
              <span
                className={`rounded-[2px] px-1.5 py-px text-[9px] uppercase tracking-[0.14em] ${
                  e.chain === "er" ? "bg-long/10 text-long" : "bg-panel2 text-faint"
                }`}
              >
                {e.chain === "er" ? "ER" : "L1"}
              </span>
              <span className={`text-right ${e.chain === "er" ? "text-long" : "text-dim"}`}>
                {fmtMs(e.ms)}
              </span>
              <a
                href={explorerTx(e.signature)}
                target="_blank"
                rel="noreferrer"
                className="text-right text-faint underline-offset-2 hover:text-ink hover:underline"
              >
                {shortKey(e.signature)}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 border-t border-edge pt-4 font-mono text-[11px] text-faint">
          every confirm lands here — the first fill starts the log
        </p>
      )}
    </Sheet>
  );
}
