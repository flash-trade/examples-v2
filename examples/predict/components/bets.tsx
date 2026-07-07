// ─────────────────────────────────────────────────────────────────────────────
// components/bets.tsx — "your bets". Each round is a real Flash V2 position plus
// the question + the clock. ACTIVE bets show live value (Flash-parity mark math,
// never the indexer pnl) + a countdown to the deadline + a manual settle; SETTLED
// bets show WON/LOST. The position is the truth — the round adds the framing. The
// settlement engine (useMarketRounds) auto-closes at the deadline; "settle" is the
// manual override. Marks come from one polled /prices.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useState } from "react";
import type { BasketSnapshot, PriceInfo } from "flash-v2";
import { computePositionView } from "@/lib/format";
import { flash } from "@/lib/flash";
import { positionFor, type Round } from "@/lib/rounds";
import { TokenIcon } from "./token-icon";

const fmtUsd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;
const fmtStrike = (n: number) => (n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(n >= 1 ? 2 : 4));

function countdown(ms: number): string {
  if (ms <= 0) return "settling…";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function Bets({
  rounds,
  snapshot,
  now,
  onSettleNow,
}: {
  rounds: Round[];
  snapshot: BasketSnapshot | null;
  now: number;
  onSettleNow: (r: Round) => void;
}) {
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

  const active = rounds.filter((r) => r.status === "active" || r.status === "settling");
  const settled = rounds.filter((r) => r.result).slice(0, 8);
  if (active.length === 0 && settled.length === 0) return null;

  return (
    <section className="mx-auto flex w-full max-w-[1100px] flex-col gap-2.5 px-4 py-2 sm:px-6">
      <div className="flex items-center gap-2 px-0.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">your bets</span>
        <span className="h-px flex-1 bg-edge" />
        <span className="font-mono text-[10px] tabular-nums text-dim">{active.length} live</span>
      </div>

      <div className="flex flex-col gap-2">
        {active.map((r) => {
          const long = r.side === "LONG";
          const pos = snapshot ? positionFor(snapshot, r.market, r.side) : undefined;
          const mark = prices[r.market]?.priceUi ?? null;
          const view = pos ? computePositionView(pos, mark) : null;
          const pnl = view?.pnlUsd ?? null;
          const remaining = r.expiresAt != null ? r.expiresAt - now : 0;
          return (
            <div key={r.id} className="glass flex items-center justify-between rounded-[14px] px-3.5 py-3">
              <div className="flex items-center gap-2.5">
                <TokenIcon symbol={r.market} size={30} />
                <div className="leading-tight">
                  <p className="text-[13px] text-ink">
                    {r.market}{" "}
                    <span className={`font-mono text-[11px] font-bold ${long ? "text-up" : "text-down"}`}>
                      {long ? "▲ above" : "below ▼"} {r.strike != null ? fmtStrike(r.strike) : ""}
                    </span>
                  </p>
                  <p className="font-mono text-[10px] tabular-nums text-faint">
                    {r.status === "settling" ? "settling…" : `⏱ ${countdown(remaining)} · stake ${fmtUsd(r.stakeUsd)}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {pnl !== null && (
                  <span className={`font-mono text-[13px] font-bold tabular-nums ${pnl >= 0 ? "text-up" : "text-down"}`}>
                    {pnl >= 0 ? "+" : ""}
                    {fmtUsd(pnl)}
                  </span>
                )}
                <button
                  onClick={() => onSettleNow(r)}
                  disabled={r.status === "settling"}
                  className="rounded-full bg-white/5 px-3 py-1.5 font-mono text-[10px] text-dim hover:text-ink disabled:opacity-50"
                >
                  settle
                </button>
              </div>
            </div>
          );
        })}

        {settled.map((r) => {
          const won = r.result?.won ?? false;
          return (
            <div key={r.id} className="flex items-center justify-between rounded-[14px] border border-edge px-3.5 py-2.5 opacity-90">
              <div className="flex items-center gap-2.5">
                <TokenIcon symbol={r.market} size={26} />
                <p className="text-[12px] text-dim">
                  {r.market} {r.side === "LONG" ? "above" : "below"}{" "}
                  <span className="font-mono tabular-nums">{r.strike != null ? fmtStrike(r.strike) : ""}</span>
                </p>
              </div>
              <div className="flex items-center gap-2.5">
                <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${won ? "bg-up/15 text-up" : "bg-down/15 text-down"}`}>
                  {won ? "WON" : "LOST"}
                </span>
                <span className={`font-mono text-[12px] font-bold tabular-nums ${won ? "text-up" : "text-down"}`}>
                  {(r.result?.pnlUsd ?? 0) >= 0 ? "+" : ""}
                  {fmtUsd(r.result?.pnlUsd ?? 0)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
