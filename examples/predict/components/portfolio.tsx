// ─────────────────────────────────────────────────────────────────────────────
// components/portfolio.tsx — "your open bets" (READ-ONLY, zero funds risk).
// Each open Flash V2 position IS a live bet: a LONG = an "Above" call, a SHORT =
// a "Below" call. Live value is the Flash-parity client mark-price math
// (computePositionView, GOTCHAS §20) — never the indexer's pnl field. Marks come
// from one polled bulk /v2/prices. No trade is ever placed here.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useState } from "react";
import type { PositionMetrics, PriceInfo } from "flash-v2";
import { computePositionView } from "@/lib/format";
import { flash } from "@/lib/flash";
import { fmtPrice } from "@/lib/copy";
import { TokenIcon } from "./token-icon";

const fmtUsd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;

export function Portfolio({ positions }: { positions: PositionMetrics[] }) {
  const [prices, setPrices] = useState<Record<string, PriceInfo>>({});

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const p = await flash.prices();
        if (alive) setPrices(p);
      } catch {
        /* keep last marks */
      }
      if (alive) timer = setTimeout(() => void tick(), 3000);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (positions.length === 0) return null;

  return (
    <section className="mx-auto flex w-full max-w-[1100px] flex-col gap-2.5 px-4 py-2 sm:px-6">
      <div className="flex items-center gap-2 px-0.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">your open bets</span>
        <span className="h-px flex-1 bg-edge" />
        <span className="font-mono text-[10px] tabular-nums text-dim">{positions.length}</span>
      </div>

      <div className="flex flex-col gap-2">
        {positions.map((p) => {
          const long = p.sideUi.toUpperCase() === "LONG";
          const mark = prices[p.marketSymbol]?.priceUi ?? null;
          const view = computePositionView(p, mark);
          const pnl = view?.pnlUsd ?? null;
          const pct = view?.pnlPct ?? null;
          const stake = Number(p.collateralUsdUi) || 0;
          const winning = (pnl ?? 0) >= 0;
          return (
            <div key={`${p.marketSymbol}-${p.sideUi}`} className="glass flex items-center justify-between rounded-[14px] px-3.5 py-3">
              <div className="flex items-center gap-2.5">
                <TokenIcon symbol={p.marketSymbol} size={30} />
                <div className="leading-tight">
                  <p className="text-[13px] text-ink">
                    {p.marketSymbol}{" "}
                    <span className={`font-mono text-[11px] font-bold ${long ? "text-up" : "text-down"}`}>{long ? "▲ Above" : "Below ▼"}</span>
                  </p>
                  <p className="font-mono text-[10px] tabular-nums text-faint">
                    stake {fmtUsd(stake)} · entry {fmtPrice(Number(p.entryPriceUi) || 0)}
                  </p>
                </div>
              </div>
              <div className="text-right leading-tight">
                <p className={`font-mono text-[14px] font-bold tabular-nums ${winning ? "text-up" : "text-down"}`}>
                  {pnl === null ? "—" : `${pnl >= 0 ? "+" : ""}${fmtUsd(pnl)}`}
                </p>
                <p className="font-mono text-[10px] tabular-nums text-faint">
                  {pct === null ? "" : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
