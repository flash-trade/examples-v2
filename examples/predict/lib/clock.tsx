// ─────────────────────────────────────────────────────────────────────────────
// lib/clock.tsx — one shared 1s clock for every countdown and the settlement
// watcher. THE HARD PART: N components with their own setInterval = N
// re-render storms and a reconcile effect with an unstable dependency. One
// provider ticks; everyone reads the same timestamp.
// GOTCHAS.md → (no API gotchas here) (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const ClockContext = createContext<number>(0);

export function ClockProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return <ClockContext.Provider value={now}>{children}</ClockContext.Provider>;
}

/** Shared wall-clock, ticking once per second. */
export function useClock(): number {
  return useContext(ClockContext);
}
