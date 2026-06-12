// ─────────────────────────────────────────────────────────────────────────────
// components/settle-card.tsx — the trust crucible: a settled round's result.
// THE HARD PART: the stake must never look stolen — a settling round shows
// custody ("being settled now"), the result lands with its receipt link, and
// acknowledgment gates the next round. Win is celebratory; loss is calm and
// exact ("your full stake, nothing more").
// GOTCHAS.md → "err arrives inside HTTP 200" (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { explorerTxUrl } from "@/lib/copy";
import { fmtPnlUsd, fmtUsd } from "@/lib/format";
import type { Round } from "@/lib/rounds";

interface Props {
  round: Round;
  onAck: (round: Round) => void;
}

export function SettleCard({ round, onAck }: Props) {
  const r = round.result;
  const elsewhere = round.status === "closed-elsewhere";
  const won = r?.won ?? false;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-bg/85 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Round result">
      <div className="glass settle-pop w-full max-w-sm">
        <div className="p-7 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-faint">
            {round.market} {round.side === "LONG" ? "▲ up" : "▼ down"} · {fmtUsd(round.stakeUsd)} stake
          </p>

          {elsewhere ? (
            <>
              <h2 className="mt-3 font-display text-2xl font-black text-dim">SETTLED ELSEWHERE</h2>
              <p className="mt-2 text-[13px] leading-relaxed text-dim">
                This position was closed outside Updown — another device, the Flash app, or a knockout. Your balance reflects the on-chain outcome.
              </p>
            </>
          ) : (
            <>
              <h2 className={`mt-3 font-display text-3xl font-black ${won ? "text-up" : "text-down"}`}>
                {won ? "CALLED IT" : "NOT THIS TIME"}
              </h2>
              <p className={`mt-1 font-mono text-2xl ${won ? "text-up" : "text-down"}`}>{r ? fmtPnlUsd(r.pnlUsd) : ""}</p>
              <p className="mt-2 text-[13px] leading-relaxed text-dim">
                {won
                  ? "Settled to your basket. Withdraw any time."
                  : `That's your full stake — nothing more. The cap is the feature.`}
              </p>
            </>
          )}

          {r?.signature && (
            <a
              href={explorerTxUrl(r.signature)}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block font-mono text-[11px] text-dim underline decoration-edge2 underline-offset-4 hover:text-ink"
            >
              receipt ↗
            </a>
          )}

          <button
            type="button"
            onClick={() => onAck(round)}
            className="press mt-5 w-full cursor-pointer rounded-full bg-ink py-3.5 font-display text-sm font-bold text-bg"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
