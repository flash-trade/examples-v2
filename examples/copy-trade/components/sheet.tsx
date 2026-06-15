// ─────────────────────────────────────────────────────────────────────────────
// components/sheet.tsx — the one bottom sheet: hairline notch, slide-up
// transform, backdrop tap-to-close, Escape, max-h-[80dvh]. THE HARD PART:
// content stays MOUNTED while hidden (translate-y-full + pointer-events-none)
// so live state inside (fee previews, step rows) never resets mid-flow.
// GOTCHAS.md → (pure UI; no API gotchas) (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect } from "react";

export default function Sheet({
  open,
  onClose,
  label,
  locked = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the dialog. */
  label: string;
  /** True while mid-signing — the sheet must not be escapable then. */
  locked?: boolean;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open || locked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, locked, onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}
      aria-hidden={!open}
      inert={!open}
    >
      <div
        className={`backdrop-fade absolute inset-0 bg-black/60 ${open ? "opacity-100" : "opacity-0"}`}
        onClick={locked ? undefined : onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`sheet-up absolute inset-x-0 bottom-0 mx-auto w-full max-w-xl rounded-t-xl border-x border-t border-edge bg-sheet ${
          open ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="grid place-items-center pb-1.5 pt-2.5">
          <span className="h-0.5 w-6 bg-edge2" />
        </div>
        <div className="max-h-[80dvh] overflow-y-auto px-4 pb-[max(24px,env(safe-area-inset-bottom))] pt-1">
          {children}
        </div>
      </div>
    </div>
  );
}
