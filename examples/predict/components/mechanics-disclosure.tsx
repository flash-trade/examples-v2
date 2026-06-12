// ─────────────────────────────────────────────────────────────────────────────
// components/mechanics-disclosure.tsx — the gate before the first round.
// THE HARD PART: this copy NEGATES the prediction-market mental model while
// honoring the verb "predict" — shown once, acknowledged explicitly, and
// reachable forever from the footer. Amber is reserved for exactly this.
// GOTCHAS.md → "Funds move on consent only" (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useState } from "react";
import { DISCLOSURE } from "@/lib/copy";

interface Props {
  open: boolean;
  /** First-run gating mode requires the checkbox; revisits don't. */
  gate: boolean;
  onAck: () => void;
}

export function MechanicsDisclosure({ open, gate, onAck }: Props) {
  const [checked, setChecked] = useState(false);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-bg/80 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-label={DISCLOSURE.title}>
      <div className="glass settle-pop m-3 w-full max-w-lg">
        <div className="p-6 sm:p-8">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-warn">Read me first</p>
          <h2 className="mb-4 font-display text-xl font-bold">{DISCLOSURE.title}</h2>
          <div className="space-y-3 text-[13.5px] leading-relaxed text-dim">
            {DISCLOSURE.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
          {gate ? (
            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-warn/25 bg-warn/5 p-3 text-[13px] text-ink">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--color-warn)]"
              />
              {DISCLOSURE.checkbox}
            </label>
          ) : null}
          <button
            type="button"
            disabled={gate && !checked}
            onClick={onAck}
            className="press mt-5 w-full cursor-pointer rounded-full bg-ink py-3.5 font-display text-sm font-bold text-bg disabled:cursor-not-allowed disabled:opacity-35"
          >
            {gate ? "I understand — show me the board" : "Close"}
          </button>
        </div>
      </div>
    </div>
  );
}
