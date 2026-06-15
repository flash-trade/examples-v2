// ─────────────────────────────────────────────────────────────────────────────
// lib/use-sheet-mount.ts — sheets exist in the DOM only while open (or for
// the 260ms exit slide). THE HARD PART: the always-mounted translate-offscreen
// pattern renders the sheet's full markup inline whenever CSS fails to load —
// seen in the wild as a token grid dumped at the page bottom. Unmounted
// markup cannot fail. GOTCHAS.md → (no API gotchas here) (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useEffect, useState } from "react";

export function useSheetMount(open: boolean, exitMs = 260): { mounted: boolean; closing: boolean } {
  // `open || kept` mounts in the SAME render open flips true — effects that
  // focus the sheet's contents (deps: [open]) find their refs populated.
  const [kept, setKept] = useState(open);
  useEffect(() => {
    if (open) {
      setKept(true);
      return;
    }
    if (!kept) return;
    const t = setTimeout(() => setKept(false), exitMs);
    return () => clearTimeout(t);
  }, [open, kept, exitMs]);
  return { mounted: open || kept, closing: !open && kept };
}
