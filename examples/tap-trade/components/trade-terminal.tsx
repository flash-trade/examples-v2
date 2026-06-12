// ─────────────────────────────────────────────────────────────────────────────
// components/trade-terminal.tsx — the trade setup that GREETS you: an in-place
// expanding panel anchored where the FEE/SIZE/LEV strip lives (left-middle).
// It opens EXPANDED on load (the first thing a trader needs is the amount),
// grows/shrinks from its own spot — never a drawer — and walks two beats:
//   AMOUNT (your ER balance top-right of the field; click = MAX; Enter →)
//   LEVERAGE (slider + chips + degen + input, with live fee + amount summary;
//   Enter → collapses to the compact strip, pair armed).
// "High-end glass" per the owner: subtle translucency + hairline + inner
// highlight — a user-directed exception to the no-glass rule, kept restrained.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useRef, useState } from "react";
import LeverageControl from "@/components/leverage-control";
import type { TradeTemplate } from "@/components/trade-sheet";
import { fmtUsd } from "@/lib/format";
import type { MarketLimits } from "@/lib/hooks";

type Step = "size" | "lev";

export default function TradeTerminal({
  template,
  onTemplate,
  feeUsd,
  limits,
  erUsd,
  market,
  openSignal,
}: {
  template: TradeTemplate;
  onTemplate: (t: TradeTemplate) => void;
  /** Live entry-fee preview for the current size/leverage (null until known). */
  feeUsd: string | null;
  /** LIVE per-market leverage bounds. */
  limits: MarketLimits | null;
  /** ER balance (free to trade, USDC) — the MAX affordance on the amount field. */
  erUsd: number | null;
  market: string;
  /** Bump to force-expand in place (un-armed pair taps route here). */
  openSignal?: number;
}) {
  const [expanded, setExpanded] = useState(true); // greets you open, by design
  const [step, setStep] = useState<Step>("size");
  const sizeRef = useRef<HTMLInputElement | null>(null);

  const sizeNum = Number(template.sizeUsd) || 0;
  const levNum = Number(template.leverage) || 0;

  useEffect(() => {
    if (openSignal && openSignal > 0) {
      setExpanded(true);
      setStep(sizeNum > 0 ? "lev" : "size");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);
  const set = (patch: Partial<TradeTemplate>) => onTemplate({ ...template, ...patch });

  // autofocus the amount whenever the size step shows
  useEffect(() => {
    if (expanded && step === "size") sizeRef.current?.focus();
  }, [expanded, step]);

  const onSizeType = (raw: string) =>
    set({ sizeUsd: raw.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1") });

  const advance = () => {
    if (sizeNum > 0) setStep("lev");
  };
  const finish = () => {
    if (levNum > 0) setExpanded(false);
  };

  const rows: Array<[string, string]> = [
    ["fee", feeUsd === null ? "—" : fmtUsd(feeUsd)],
    ["size", sizeNum > 0 ? `$${template.sizeUsd}` : "—"],
    ["lev", levNum > 0 ? `${template.leverage}×` : "—"],
  ];

  return (
    <div
      className={`absolute left-3 top-1/2 z-20 -translate-y-1/2 overflow-hidden rounded-[4px] border transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        expanded
          ? "w-[19rem] border-edge2 bg-panel/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-[2px]"
          : "w-auto border-edge bg-panel"
      }`}
    >
      {!expanded ? (
        /* compact strip — tap to grow back out of the same spot */
        <button
          onClick={() => {
            setExpanded(true);
            // amount already chosen → land straight on leverage (tap the $
            // summary there to edit the amount) — no forced re-walk.
            setStep(sizeNum > 0 ? "lev" : "size");
          }}
          aria-label="open trade setup"
          className="grid divide-y divide-edge text-left transition-transform active:scale-[0.99]"
        >
          {rows.map(([label, value]) => (
            <span key={label} className="grid justify-items-start gap-0.5 px-3 py-2">
              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-faint">{label}</span>
              <span className="font-mono text-xs font-semibold tabular-nums text-ink">{value}</span>
            </span>
          ))}
        </button>
      ) : (
        <div className="p-3.5">
          {/* header: step title · collapse */}
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              {step === "size" ? `trade ${market}` : "set leverage"}
            </span>
            <span className="h-px flex-1 bg-edge" aria-hidden />
            <button
              onClick={() => setExpanded(false)}
              aria-label="collapse trade setup"
              className="grid h-5 w-5 place-items-center rounded-[3px] border border-edge text-dim transition-colors hover:border-edge2 hover:text-ink"
            >
              <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden>
                <path d="M2 5 H8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {step === "size" ? (
            <div className="mt-3">
              {/* the ER balance lives top-right of the field; tap = full amount */}
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">amount</span>
                <button
                  onClick={() => erUsd !== null && erUsd > 0 && set({ sizeUsd: String(Math.floor(erUsd * 100) / 100) })}
                  disabled={erUsd === null || erUsd <= 0}
                  title="tap to trade your full balance"
                  className="font-mono text-[10px] tabular-nums text-dim transition-colors hover:text-long disabled:opacity-40"
                >
                  v2 ${erUsd === null ? "—" : erUsd.toFixed(2)}
                </button>
              </div>
              <label className="flex items-center gap-2 rounded-[3px] border border-edge bg-bg/60 px-3 py-2.5 transition-colors focus-within:border-long/50">
                <span className="font-mono text-sm text-faint">$</span>
                <input
                  ref={sizeRef}
                  value={template.sizeUsd}
                  onChange={(e) => onSizeType(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && advance()}
                  placeholder="0"
                  inputMode="decimal"
                  aria-label="trade amount in USDC"
                  className="w-full bg-transparent font-mono text-lg tabular-nums text-ink outline-none placeholder:text-faint"
                />
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">usdc</span>
              </label>
              <button
                onClick={advance}
                disabled={sizeNum <= 0}
                className="mt-2.5 h-9 w-full rounded-[3px] bg-long text-xs font-bold text-bg transition-transform active:scale-[0.99] disabled:opacity-30"
              >
                Next — leverage
              </button>
            </div>
          ) : (
            <div className="mt-3">
              {/* what you're about to trade, with the live fee */}
              <div className="mb-3 flex items-baseline justify-between rounded-[3px] border border-edge bg-bg/60 px-3 py-2">
                <button
                  onClick={() => setStep("size")}
                  title="edit amount"
                  className="font-mono text-sm tabular-nums text-ink underline-offset-4 hover:underline"
                >
                  ${template.sizeUsd || "0"}
                </button>
                <span className="font-mono text-[10px] tabular-nums text-dim">
                  fee {feeUsd === null ? "—" : fmtUsd(feeUsd)}
                </span>
              </div>
              <LeverageControl
                value={template.leverage}
                onChange={(leverage) => set({ leverage })}
                limits={limits}
                onCommit={finish}
              />
              <button
                onClick={finish}
                disabled={levNum <= 0}
                className="mt-3 h-9 w-full rounded-[3px] bg-long text-xs font-bold text-bg transition-transform active:scale-[0.99] disabled:opacity-30"
              >
                Done — arm the taps
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
