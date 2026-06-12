// ─────────────────────────────────────────────────────────────────────────────
// components/price-chart.tsx — the live pulse: where the price has been and
// where it is right now. THE HARD PART: zero extra polling — it feeds off the
// app's existing 1s price tick (usePriceHistory seeds with Pyth minute closes
// and appends live ticks). Fixed height, tabular digits, entry-line overlay
// when you have a round riding this market. Trend tints teal/coral.
// GOTCHAS.md → "Latency: never bill the rollup for the user's geography"
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useMemo } from "react";
import type { PriceInfo } from "flash-v2";
import { fmtPrice } from "@/lib/copy";
import { usePriceHistory } from "@/lib/use-price-history";
import type { Side } from "@/lib/rounds";

interface Props {
  symbol: string;
  price: PriceInfo | null;
  /** An active round on this market — draws your entry on the chart. */
  entry?: { price: number; side: Side } | null;
}

const W = 100;
const H = 36;

export function PriceChart({ symbol, price, entry }: Props) {
  const history = usePriceHistory(price, symbol);

  const view = useMemo(() => {
    if (history.length < 2) return null;
    const lo = Math.min(...history);
    const hi = Math.max(...history);
    const pad = (hi - lo) * 0.12 || hi * 0.0005 || 1;
    const min = lo - pad;
    const max = hi + pad;
    const xOf = (i: number) => (i / (history.length - 1)) * W;
    const yOf = (p: number) => H - ((p - min) / (max - min)) * H;

    const pts = history.map((p, i) => `${xOf(i).toFixed(2)},${yOf(p).toFixed(2)}`);
    const first = history[0] as number;
    const last = history[history.length - 1] as number;
    const changePct = first > 0 ? ((last - first) / first) * 100 : 0;
    const lastX = xOf(history.length - 1);
    const lastY = yOf(last);
    const entryY = entry && entry.price >= min && entry.price <= max ? yOf(entry.price) : null;

    return {
      line: pts.join(" "),
      area: `0,${H} ${pts.join(" ")} ${W},${H}`,
      up: changePct >= 0,
      changePct,
      lo,
      hi,
      lastX,
      lastY,
      entryY,
    };
  }, [history, entry]);

  const tone = view?.up ? "var(--color-up)" : "var(--color-down)";

  return (
    <div className="glass p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-sm font-bold">{symbol}</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">live</span>
        </div>
        {view && (
          <span className={`font-mono text-[11px] ${view.up ? "text-up" : "text-down"}`}>
            {view.up ? "▲" : "▼"} {Math.abs(view.changePct).toFixed(2)}%
          </span>
        )}
      </div>

      {/* the number — on its own film so it never fights the frost */}
      <div className="film mt-2 inline-flex items-baseline gap-2 px-3 py-1.5">
        <span className={`font-mono text-2xl font-medium tracking-tight ${view ? (view.up ? "text-up" : "text-down") : "text-ink"}`}>
          {price ? fmtPrice(price.priceUi) : "—"}
        </span>
      </div>

      <div className="relative mt-3 h-28 sm:h-32" role="img" aria-label={`${symbol} recent price movement`}>
        {view ? (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
              <defs>
                <linearGradient id={`fade-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={tone} stopOpacity="0.22" />
                  <stop offset="100%" stopColor={tone} stopOpacity="0" />
                </linearGradient>
              </defs>
              <polygon points={view.area} fill={`url(#fade-${symbol})`} />
              <polyline points={view.line} fill="none" stroke={tone} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
              {view.entryY !== null && (
                <line x1="0" y1={view.entryY} x2={W} y2={view.entryY} stroke="rgb(255 255 255 / 0.45)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
              )}
              <circle cx={view.lastX} cy={view.lastY} r="1.6" fill={tone} className="soft-pulse" />
            </svg>
            {view.entryY !== null && (
              <span
                className="absolute right-1 -translate-y-1/2 rounded-full bg-bg/60 px-1.5 font-mono text-[9px] text-dim"
                style={{ top: `${(view.entryY / H) * 100}%` }}
              >
                your entry
              </span>
            )}
            <span className="absolute left-1 top-0 font-mono text-[9px] text-faint">{fmtPrice(view.hi, "compact")}</span>
            <span className="absolute bottom-0 left-1 font-mono text-[9px] text-faint">{fmtPrice(view.lo, "compact")}</span>
          </>
        ) : (
          <div className="flex h-full items-center justify-center font-mono text-[11px] text-faint soft-pulse">
            drawing the last hour…
          </div>
        )}
      </div>
    </div>
  );
}
