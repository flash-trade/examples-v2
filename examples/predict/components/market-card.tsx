// ─────────────────────────────────────────────────────────────────────────────
// components/market-card.tsx — the single most important component (Polymarket's
// market card is the click): token + live price + a plain-words question + the
// YES/NO odds as a split bar. Cents ARE the odds. Semantic colour + ▲/▼ always
// (never colour-alone). The headline is a believable "climb above" call (~45¢),
// priced live by lib/markets.ts; tapping opens the full ladder + ticket.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useMemo } from "react";
import { cents, marketForTargetProb } from "@/lib/markets";
import { timeframe, type TimeframeId } from "@/lib/payoff";
import { fmtPrice } from "@/lib/copy";
import { TokenIcon } from "./token-icon";

function fmtStrike(n: number): string {
  return n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(n >= 1 ? 2 : 4);
}

export function MarketCard({
  token,
  price,
  timeframe: tf,
  onOpen,
}: {
  token: string;
  price: number;
  timeframe: TimeframeId;
  onOpen?: () => void;
}) {
  const m = useMemo(
    () => marketForTargetProb({ token, direction: "ABOVE", entry: price, timeframe: tf, targetProb: 0.45 }),
    [token, price, tf],
  );
  const yes = cents(m.prob);
  const no = 100 - yes;

  return (
    <button
      onClick={onOpen}
      className="glass group flex w-full flex-col gap-3 rounded-[16px] p-4 text-left transition-transform active:scale-[0.99]"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <TokenIcon symbol={token} size={32} />
          <div className="leading-tight">
            <p className="font-display text-[15px] font-bold text-ink">{token}</p>
            <p className="font-mono text-[11px] tabular-nums text-dim">{fmtPrice(price)}</p>
          </div>
        </div>
        <span className="rounded-full bg-white/5 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
          {timeframe(tf).label}
        </span>
      </div>

      <p className="text-[13px] leading-snug text-ink">
        Will {token} climb above <span className="font-mono tabular-nums">{fmtStrike(m.strike)}</span>?
      </p>

      {/* YES/NO odds — semantic colour + ▲/▼, never colour-alone */}
      <div>
        <div className="mb-1.5 flex items-center justify-between font-mono text-[11px] tabular-nums">
          <span className="font-semibold text-up">▲ YES {yes}¢</span>
          <span className="font-semibold text-down">NO {no}¢ ▼</span>
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-full bg-down/25">
          <div className="h-full rounded-l-full bg-up" style={{ width: `${yes}%` }} />
        </div>
      </div>
    </button>
  );
}
