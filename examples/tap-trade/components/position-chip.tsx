// ─────────────────────────────────────────────────────────────────────────────
// components/position-chip.tsx — live position state, floating over the chart:
// a compact chip (side · size · entry · liq) + a detail sheet with close /
// reverse. Optimism with honesty: a tap shows "opening…" instantly; the chip
// becomes real only when an owner-stream frame proves it.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import type { PositionMetrics, TradeType } from "flash-v2";
import Sheet from "@/components/sheet";
import { computePositionView, fmtLeverage, fmtPct, fmtPnlUsd, fmtUsd } from "@/lib/format";

export type PendingTrade =
  | { kind: "open"; side: TradeType; at: number }
  | { kind: "close"; at: number };

function sideTone(sideUi: string): { text: string; dot: string } {
  const long = sideUi.toUpperCase() === "LONG";
  return long ? { text: "text-long", dot: "bg-long" } : { text: "text-short", dot: "bg-short" };
}

/** The floating chip under the top bar. Renders nothing when flat + idle. */
export default function PositionChip({
  positions,
  pending,
  markUi,
  onOpen,
}: {
  positions: PositionMetrics[];
  pending: PendingTrade | null;
  /** Live mark price — Flash-parity PnL is computed client-side against it. */
  markUi: number | null;
  onOpen: () => void;
}) {
  const first = positions[0] ?? null;

  // Optimistic ghost — the tap claims the position; the stream makes it real.
  if (!first) {
    if (pending?.kind !== "open") return null;
    const tone = sideTone(pending.side);
    return (
      <div className="pointer-events-none absolute inset-x-0 top-16 z-20 grid justify-center">
        <span className="row-in flex items-center gap-2 rounded-[3px] border border-edge bg-panel px-3 py-1.5 opacity-70">
          <span className={`soft-pulse inline-block h-1.5 w-1.5 rounded-full ${tone.dot}`} />
          <span className={`font-mono text-[11px] font-bold uppercase tracking-[0.1em] ${tone.text}`}>
            {pending.side}
          </span>
          <span className="soft-pulse font-mono text-[11px] text-dim">opening…</span>
        </span>
      </div>
    );
  }

  const tone = sideTone(first.sideUi);
  const closing = pending?.kind === "close";
  return (
    <div className="absolute inset-x-0 top-16 z-20 grid justify-center">
      <button
        key={`${first.marketSymbol}-${first.sideUi}`} // reverse → remount → row-in replays
        onClick={onOpen}
        className={`row-in flex items-center gap-2.5 rounded-[3px] border border-edge bg-panel px-3 py-1.5 transition-all active:scale-[0.99] ${
          closing ? "opacity-50" : ""
        }`}
      >
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${tone.dot}`} />
        <span className={`font-mono text-[11px] font-bold uppercase tracking-[0.1em] ${tone.text}`}>
          {first.sideUi} {(() => { const v = computePositionView(first, markUi); return v ? fmtLeverage(v.leverage) : "—×"; })()}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-dim">
          {fmtUsd(first.sizeUsdUi)} · entry {fmtUsd(first.entryPriceUi)}
        </span>
        {(() => { const v = computePositionView(first, markUi); return v ? (
          <span className={`font-mono text-[11px] font-bold tabular-nums ${v.pnlUsd >= 0 ? "text-long" : "text-short"}`}>
            {fmtPnlUsd(v.pnlUsd)}
          </span>
        ) : null; })()}
        {positions.length > 1 && (
          <span className="font-mono text-[10px] text-faint">+{positions.length - 1}</span>
        )}
      </button>
    </div>
  );
}

/** Full detail rows + close/reverse, in a sheet — Flash-parity numbers:
 *  mark-priced PnL incl. fees, leverage = size/collateral, liq ≈ maintenance
 *  estimate. Same labels as Flash's own positions table. */
export function PositionSheet({
  open,
  onClose,
  positions,
  busy,
  markUi,
  onCloseOne,
  onReverse,
}: {
  open: boolean;
  onClose: () => void;
  positions: PositionMetrics[];
  busy: boolean;
  /** Live mark price for the active market. */
  markUi: number | null;
  onCloseOne: (side: TradeType) => void;
  onReverse: (side: TradeType) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} label="position details">
      <p className="font-display text-[15px] font-semibold text-ink">Position</p>
      {positions.length === 0 ? (
        <p className="mt-3 font-mono text-xs text-faint">flat — no open position</p>
      ) : (
        <div className="mt-3 grid gap-5">
          {positions.map((p) => {
            const v = computePositionView(p, markUi);
            const pnl = v?.pnlUsd ?? 0;
            const tone = sideTone(p.sideUi);
            const side: TradeType = p.sideUi.toUpperCase() === "LONG" ? "LONG" : "SHORT";
            return (
              <div key={`${p.marketSymbol}-${p.sideUi}`}>
                <div className="flex items-baseline justify-between">
                  <span className="flex items-center gap-2">
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                    <span className="text-sm font-bold text-ink">{p.marketSymbol}</span>
                    <span className={`font-mono text-[11px] font-bold uppercase tracking-[0.1em] ${tone.text}`}>
                      {p.sideUi} {v ? fmtLeverage(v.leverage) : "—×"}
                    </span>
                  </span>
                  <span className={`font-mono text-lg font-bold tabular-nums ${pnl >= 0 ? "text-long" : "text-short"}`}>
                    {v ? fmtPnlUsd(v.pnlUsd) : "—"}
                    {v && <span className="ml-1.5 text-xs font-semibold">{fmtPct(v.pnlPct)}</span>}
                  </span>
                </div>
                <dl className="mt-3 grid gap-1.5">
                  {(
                    [
                      ["size", fmtUsd(p.sizeUsdUi)],
                      ["collateral", fmtUsd(p.collateralUsdUi)],
                      ["entry price", fmtUsd(p.entryPriceUi)],
                      ["mark price", markUi === null ? "—" : fmtUsd(markUi)],
                      ["liq. price", v?.liqUi == null ? "—" : `≈ ${fmtUsd(v.liqUi)}`],
                    ] as const
                  ).map(([k, val]) => (
                    <div key={k} className="grid grid-cols-[1fr_auto] items-baseline">
                      <dt className="text-xs text-faint">{k}</dt>
                      <dd className="font-mono text-sm tabular-nums text-ink">{val}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 font-mono text-[10px] text-faint">pnl incl. fees · marked at the live price</p>
                <div className="mt-3.5 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => onCloseOne(side)}
                    disabled={busy}
                    className="rounded-[3px] border border-edge2 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.1em] text-ink transition-colors hover:bg-panel active:scale-[0.99] disabled:pointer-events-none disabled:opacity-35"
                  >
                    close
                  </button>
                  <button
                    onClick={() => onReverse(side)}
                    disabled={busy}
                    className="rounded-[3px] border border-edge py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.1em] text-dim transition-colors hover:text-ink active:scale-[0.99] disabled:pointer-events-none disabled:opacity-35"
                  >
                    reverse
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}
