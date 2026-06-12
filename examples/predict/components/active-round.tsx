// ─────────────────────────────────────────────────────────────────────────────
// components/active-round.tsx — a running round: countdown, live PnL, exit.
// THE HARD PART: PnL is computed CLIENT-SIDE at mark price (computePosition-
// View) — the indexer's pnlWithFee is never rendered (GOTCHAS §20). The bar
// depletes on the shared clock; urgency arrives in the final fifth; expiry
// flips copy to "settling at close" — taps land on explained, disabled UI.
// GOTCHAS.md → "The indexer's PnL is NOT the product's PnL" (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useClock } from "@/lib/clock";
import { fmtCountdown, fmtPrice } from "@/lib/copy";
import { computePositionView, fmtPnlUsd, fmtUsd } from "@/lib/format";
import { usePrice } from "@/lib/hooks";
import { timeframe, type TimeframeId } from "@/lib/payoff";
import { positionFor, type Round } from "@/lib/rounds";
import { useStream } from "@/lib/stream";

interface Props {
  round: Round;
  onSettleNow: (round: Round) => void;
}

export function ActiveRound({ round, onSettleNow }: Props) {
  const now = useClock();
  const { price } = usePrice(round.market, 1000);
  const { snapshot } = useStream();

  const metrics = snapshot ? positionFor(snapshot, round.market, round.side) : undefined;
  const view = metrics ? computePositionView(metrics, price?.priceUi ?? null) : null;

  const settling = round.status === "settling";
  const timed = round.expiresAt !== null && round.timeframe !== null;
  const totalMs = timed ? timeframe(round.timeframe as TimeframeId).ms : 0;
  const remaining = timed ? Math.max(0, (round.expiresAt as number) - now) : 0;
  const frac = timed && totalMs > 0 ? remaining / totalMs : 0;
  const urgent = timed && frac > 0 && frac < 0.2;
  const expired = timed && remaining <= 0;

  const pnl = view?.pnlUsd ?? null;
  const pnlClass = pnl === null ? "text-dim" : pnl >= 0 ? "text-up" : "text-down";

  return (
    <div className="glass row-in">
      <div className="p-4">
        <div className="flex items-center gap-2.5">
          <span className={`font-display text-sm font-black ${round.side === "LONG" ? "text-up" : "text-down"}`}>
            {round.side === "LONG" ? "▲" : "▼"} {round.market}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-faint">
            {timed ? timeframe(round.timeframe as TimeframeId).label : "manual"} · {fmtUsd(round.stakeUsd)} stake
          </span>
          <span className={`ml-auto font-mono text-lg ${pnlClass} ${settling ? "soft-pulse" : ""}`}>
            {pnl === null ? "—" : fmtPnlUsd(pnl)}
          </span>
        </div>

        {timed && (
          <div className="mt-3">
            <div className="flex items-baseline justify-between font-mono text-[11px]">
              <span className={urgent ? "cd-urgent text-down" : "text-dim"}>
                {settling ? "settling…" : expired ? "settling at close" : fmtCountdown(remaining)}
              </span>
              <span className="text-faint">
                in at {fmtPrice(round.quote.entryPrice)} · ends early at {fmtPrice(round.quote.liqPrice)}
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-edge">
              <div
                className={`cd-bar h-full ${urgent || expired ? "bg-down" : "bg-up"}`}
                style={{ transform: `scaleX(${expired ? 0 : frac})` }}
              />
            </div>
          </div>
        )}

        <button
          type="button"
          disabled={settling || !metrics}
          onClick={() => onSettleNow(round)}
          className="press mt-3 w-full cursor-pointer rounded-full border border-edge2 py-2.5 font-display text-[12px] font-bold text-ink disabled:cursor-not-allowed disabled:opacity-45"
        >
          {settling ? "Settling…" : !metrics ? "Syncing…" : expired ? "Settle round" : "Settle now — take it early"}
        </button>
      </div>
    </div>
  );
}
