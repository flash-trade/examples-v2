// ─────────────────────────────────────────────────────────────────────────────
// components/enable-sheet.tsx — Enable One-Tap: consent screen + live steps.
// THE HARD PART: the consent rule. Enable is account setup ONLY — the single
// disclosed transfer is the 0.01 SOL rent top-up to the user's OWN session
// key, stated here at the moment of consent, returned on revoke.
// GOTCHAS.md → "Funds move on consent only" (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import type { EnableState } from "@/lib/enable";
import { ENABLE_EXPLAINER } from "@/lib/copy";
import { useSheetMount } from "@/lib/use-sheet-mount";

interface Props {
  open: boolean;
  busy: boolean;
  state: EnableState | null;
  onEnable: () => void;
  onClose: () => void;
}

const dot: Record<string, string> = {
  idle: "bg-edge2",
  active: "bg-warn soft-pulse",
  done: "bg-up",
  skipped: "bg-faint",
  error: "bg-down",
};

export function EnableSheet({ open, busy, state, onEnable, onClose }: Props) {
  const { mounted, closing } = useSheetMount(open);
  if (!mounted) return null;
  return (
    <div className="fixed inset-0 z-40">
      <div className={`absolute inset-0 bg-bg/70 ${closing ? "backdrop-out" : "backdrop-in"}`} onClick={busy ? undefined : onClose} />
      <div className={`absolute inset-x-0 bottom-0 mx-auto max-w-lg ${closing ? "sheet-out" : "sheet-in"}`} role="dialog" aria-modal="true" aria-label={ENABLE_EXPLAINER.title}>
        <div className="glass m-2">
          <div className="p-6">
            <h2 className="font-display text-lg font-bold">{ENABLE_EXPLAINER.title}</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-dim">{ENABLE_EXPLAINER.body}</p>

            <ul className="mt-4 space-y-2">
              {(state?.steps ?? ENABLE_EXPLAINER.steps.map((label, i) => ({ id: String(i), label, status: "idle" as const, note: undefined }))).map(
                (s) => (
                  <li key={s.id} className="flex items-center gap-2.5 text-[13px]">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${dot[s.status] ?? "bg-edge2"}`} />
                    <span className={s.status === "done" ? "text-ink" : "text-dim"}>{s.label}</span>
                    {s.note ? <span className="ml-auto font-mono text-[10px] text-faint">{s.note}</span> : null}
                  </li>
                ),
              )}
            </ul>

            {state?.fundingHint ? <p className="mt-3 text-[12px] text-warn">{state.fundingHint}</p> : null}
            {state?.error ? <p className="mt-3 text-[12px] text-down">{state.error}</p> : null}

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="press flex-1 cursor-pointer rounded-full border border-edge py-3 text-[13px] text-dim disabled:opacity-40"
              >
                Not now
              </button>
              <button
                type="button"
                onClick={onEnable}
                disabled={busy}
                className="press group flex flex-[2] cursor-pointer items-center justify-center gap-2 rounded-full bg-ink py-3 font-display text-[13px] font-bold text-bg disabled:opacity-50"
              >
                {busy ? (state?.headline ?? "Working…") : "Enable — one approval"}
                {!busy && (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-bg/10 transition-transform group-hover:translate-x-0.5">
                    →
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
