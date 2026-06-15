// ─────────────────────────────────────────────────────────────────────────────
// components/market-card.tsx — the single most important component (Polymarket's
// market card is the click): token + live price + a plain-words question + the
// YES/NO odds as a split bar. Cents ARE the odds. Semantic colour + ▲/▼ always
// (never colour-alone). The headline is a believable "climb above" call, priced
// LIVE through this market's real trade spread + leverage caps by the engine —
// so each card's odds FLOAT (no two read alike). Until the live limits load the
// card shows a skeleton; it NEVER quotes spread-blind odds. Tapping opens the
// full ladder + ticket.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useMemo } from "react";
import { cents, headlineMarket } from "@/lib/markets";
import type { MarketLimits } from "@/lib/hooks";
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
  limits,
  onOpen,
}: {
  token: string;
  price: number;
  timeframe: TimeframeId;
  /** live spread + caps for this market; null until loaded (→ skeleton). */
  limits: MarketLimits | null;
  onOpen?: () => void;
}) {
  const m = useMemo(
    () =>
      limits
        ? headlineMarket({
            token,
            oracle: price,
            spread: limits.spreadLongPct,
            maxLeverage: limits.maxLeverage,
            minLeverage: limits.minLeverage,
            timeframe: tf,
          })
        : null,
    [token, price, tf, limits],
  );

  return (
    <button
      onClick={onOpen}
      className="glass group flex w-full flex-col gap-3 rounded-[16px] p-4 text-left transition-transform hover:-translate-y-px active:scale-[0.99]"
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

      {m ? (
        <>
          <p className="text-[13px] leading-snug text-ink">
            Will {token} climb above <span className="font-mono tabular-nums">{fmtStrike(m.strike)}</span>?
          </p>

          {/* YES/NO odds — semantic colour + ▲/▼, never colour-alone */}
          <Odds yes={cents(m.prob)} />
        </>
      ) : (
        // skeleton — limits still loading; never render fake (spread-blind) odds
        <div className="flex flex-col gap-3" aria-hidden>
          <div className="h-3.5 w-3/4 animate-pulse rounded bg-white/5" />
          <div className="flex flex-col gap-1.5">
            <div className="h-3 w-full animate-pulse rounded bg-white/5" />
            <div className="h-1.5 w-full rounded-full bg-white/5" />
          </div>
        </div>
      )}
    </button>
  );
}

function Odds({ yes }: { yes: number }) {
  const no = 100 - yes;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between font-mono text-[11px] tabular-nums">
        <span className="font-semibold text-up">▲ YES {yes}¢</span>
        <span className="font-semibold text-down">NO {no}¢ ▼</span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-down/25">
        <div className="h-full rounded-l-full bg-up" style={{ width: `${yes}%` }} />
      </div>
    </div>
  );
}
