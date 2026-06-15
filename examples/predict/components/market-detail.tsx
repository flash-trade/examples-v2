// ─────────────────────────────────────────────────────────────────────────────
// components/market-detail.tsx — tap a card → this overlay. The full prediction
// surface for one token+timeframe:
//   • Above / Below direction toggle (each side is a real, separate bet — odds
//     don't sum to 100¢; the gap is the honest house edge, like a book's vig).
//   • The STRIKE LADDER: a row per strike, each a YES bet at its own odds.
//   • MULTI-OUTCOME BUCKETS: "where does it land?", normalized to ~100%.
//   • The BUY TICKET: stake → shares · to-win · max-loss (= stake), locked math.
// Every number is from lib/markets.ts. Real on-chain execution wires in phase 5
// (needs the wallet/enable/session orchestrator) — here the ticket is a preview.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useMemo, useState } from "react";
import {
  bucketMarket,
  cents,
  profitUsd,
  strikeLadder,
  toWinUsd,
  type Direction,
  type PricedMarket,
} from "@/lib/markets";
import { timeframe, type TimeframeId } from "@/lib/payoff";
import { fmtPrice } from "@/lib/copy";
import { TokenIcon } from "./token-icon";

const MIN_STAKE = 11; // the $11-after-fees floor (RECOMMENDED_MIN_COLLATERAL_USD)

const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
const fmtStrike = (n: number) => (n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(n >= 1 ? 2 : 4));

/** Five bucket edges around the live price (±0.5% / ±1.5%) → six outcomes. */
function defaultEdges(price: number): number[] {
  return [0.985, 0.995, 1.005, 1.015].map((m) => price * m);
}

export function MarketDetail({
  token,
  price,
  timeframe: tf,
  onClose,
  onConfirm,
}: {
  token: string;
  price: number;
  timeframe: TimeframeId;
  onClose: () => void;
  onConfirm?: (m: PricedMarket, stakeUsd: number) => void;
}) {
  const [dir, setDir] = useState<Direction>("ABOVE");
  const ladder = useMemo(() => strikeLadder({ token, entry: price, direction: dir, timeframe: tf }), [token, price, dir, tf]);
  const buckets = useMemo(() => bucketMarket({ token, entry: price, timeframe: tf, edges: defaultEdges(price) }), [token, price, tf]);

  const [picked, setPicked] = useState<PricedMarket | null>(null);
  const active = picked && picked.direction === dir ? picked : ladder[Math.floor(ladder.length / 2)] ?? null;
  const [stake, setStake] = useState("25");

  const stakeUsd = Math.max(0, Number(stake.replace(/[^0-9.]/g, "")) || 0);
  const tooSmall = stakeUsd > 0 && stakeUsd < MIN_STAKE;
  const yesCents = active ? cents(active.prob) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="glass relative z-10 flex max-h-[92dvh] w-full max-w-[520px] flex-col gap-4 overflow-y-auto rounded-t-[22px] p-5 sm:rounded-[22px]">
        {/* header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <TokenIcon symbol={token} size={34} />
            <div className="leading-tight">
              <p className="font-display text-[16px] font-bold text-ink">{token}</p>
              <p className="font-mono text-[11px] tabular-nums text-dim">{fmtPrice(price)} · {timeframe(tf).label}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full bg-white/5 px-3 py-1.5 font-mono text-[11px] text-dim hover:text-ink">Close</button>
        </div>

        {/* direction toggle — each side is its own real bet */}
        <div className="flex rounded-full bg-white/5 p-0.5 text-[13px] font-bold">
          <button onClick={() => { setDir("ABOVE"); setPicked(null); }} className={`flex-1 rounded-full py-2 transition-colors ${dir === "ABOVE" ? "bg-up/15 text-up" : "text-faint"}`}>▲ Above</button>
          <button onClick={() => { setDir("BELOW"); setPicked(null); }} className={`flex-1 rounded-full py-2 transition-colors ${dir === "BELOW" ? "bg-down/15 text-down" : "text-faint"}`}>Below ▼</button>
        </div>

        {/* the strike ladder — pick your odds by picking a strike */}
        <div className="flex flex-col gap-1.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">{dir === "ABOVE" ? "climbs above" : "drops below"} — pick a strike</p>
          {ladder.map((m) => {
            const on = active === m;
            const c = cents(m.prob);
            return (
              <button
                key={m.strike}
                onClick={() => setPicked(m)}
                className={`flex items-center justify-between rounded-[12px] border px-3.5 py-2.5 text-left transition-colors ${on ? "border-up/40 bg-up/[0.06]" : "border-edge hover:border-edge2"}`}
              >
                <span className="font-mono text-[13px] tabular-nums text-ink">{fmtStrike(m.strike)}</span>
                <span className="flex items-center gap-3">
                  <span className="font-mono text-[11px] tabular-nums text-dim">win {fmtUsd(toWinUsd(1, m.prob))}/$1</span>
                  <span className={`font-mono text-[14px] font-bold tabular-nums ${dir === "ABOVE" ? "text-up" : "text-down"}`}>{c}¢</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* multi-outcome buckets — where does it land? */}
        <div className="flex flex-col gap-1.5">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">where does it land?</p>
          {buckets.buckets.map((b) => (
            <div key={b.label} className="flex items-center gap-3 rounded-[12px] border border-edge px-3.5 py-2">
              <span className="w-28 shrink-0 font-mono text-[12px] tabular-nums text-ink">{b.label}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                <div className="h-full rounded-full bg-ink/40" style={{ width: `${Math.round(b.prob * 100)}%` }} />
              </div>
              <span className="w-10 shrink-0 text-right font-mono text-[12px] font-semibold tabular-nums text-dim">{Math.round(b.prob * 100)}%</span>
            </div>
          ))}
        </div>

        {/* the buy ticket */}
        {active && (
          <div className="film flex flex-col gap-3 rounded-[16px] p-4">
            <div className="flex items-center justify-between">
              <p className="text-[13px] text-ink">
                {token} {dir === "ABOVE" ? "above" : "below"} <span className="font-mono tabular-nums">{fmtStrike(active.strike)}</span>
              </p>
              <span className={`font-mono text-[15px] font-bold tabular-nums ${dir === "ABOVE" ? "text-up" : "text-down"}`}>{yesCents}¢</span>
            </div>

            <label className="glass-strong flex items-center justify-between rounded-[12px] px-3.5 py-2.5">
              <span className="text-[12px] text-dim">Stake</span>
              <span className="flex items-baseline gap-1">
                <span className="font-mono text-sm text-faint">$</span>
                <input value={stake} onChange={(e) => setStake(e.target.value)} inputMode="decimal" className="w-20 bg-transparent text-right font-mono text-[16px] tabular-nums text-ink outline-none" />
              </span>
            </label>

            {/* the honest numbers — locked from the same math the trade uses */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <Stat label="to win" value={fmtUsd(toWinUsd(stakeUsd, active.prob))} tone="up" />
              <Stat label="profit" value={`+${fmtUsd(profitUsd(stakeUsd, active.prob))}`} tone="up" />
              <Stat label="max loss" value={`−${fmtUsd(stakeUsd)}`} tone="down" />
            </div>

            <button
              onClick={() => onConfirm?.(active, stakeUsd)}
              disabled={!onConfirm || stakeUsd <= 0 || tooSmall}
              className="cta-glow-up rounded-[12px] bg-up py-3 text-[14px] font-bold text-up-deep transition-transform active:scale-[0.99] disabled:opacity-50"
            >
              {tooSmall ? `Stake at least $${MIN_STAKE}` : onConfirm ? `Back ${dir === "ABOVE" ? "Above" : "Below"} · ${yesCents}¢` : "Preview — trading wires in next"}
            </button>
            <p className="text-center font-mono text-[10px] leading-relaxed text-faint">
              Odds are formula-set on a real capped-loss position. You can never lose more than your stake.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "up" | "down" }) {
  return (
    <div className="rounded-[10px] bg-white/[0.03] px-2 py-2">
      <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint">{label}</p>
      <p className={`mt-0.5 font-mono text-[14px] font-bold tabular-nums ${tone === "up" ? "text-up" : "text-down"}`}>{value}</p>
    </div>
  );
}
