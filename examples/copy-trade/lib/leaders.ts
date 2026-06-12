// ─────────────────────────────────────────────────────────────────────────────
// lib/leaders.ts — leader DISCOVERY off the fstats V2/ER leaderboard (via the
// same-origin /api/leaders route). This is the "who do I copy?" half: ranked
// traders with real win rate, PnL, and volume on the Ephemeral Rollup. The
// "mirror their trades" half lives in lib/copy-engine.ts (the live owner WS).
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useRef, useState } from "react";

/** One row of the fstats V2/ER PnL leaderboard. */
export interface LeaderRow {
  owner: string;
  rank: number;
  win_rate: number; // 0–100
  wins: number;
  losses: number;
  num_trades: number;
  net_pnl: number;
  gross_pnl: number;
  total_volume_usd: number;
}

export interface LeaderboardState {
  leaders: LeaderRow[];
  /** owner → number of positions open RIGHT NOW (so the UI can flag live leaders). */
  openByOwner: Record<string, number>;
  loading: boolean;
  error: string | null;
}

/** Poll the ranked leaderboard. Discovery data tolerates a slow cadence. */
export function useLeaderboard(pollMs = 20_000): LeaderboardState {
  const [state, setState] = useState<LeaderboardState>({
    leaders: [],
    openByOwner: {},
    loading: true,
    error: null,
  });
  const dead = useRef(false);

  useEffect(() => {
    dead.current = false;
    const load = async () => {
      try {
        const res = await fetch("/api/leaders");
        const j = (await res.json()) as Partial<LeaderboardState> & { error?: string };
        if (dead.current) return;
        if (!res.ok || j.error) throw new Error(j.error ?? `leaderboard ${res.status}`);
        setState({
          leaders: j.leaders ?? [],
          openByOwner: j.openByOwner ?? {},
          loading: false,
          error: null,
        });
      } catch (e) {
        if (dead.current) return;
        setState((s) => ({ ...s, loading: false, error: (e as Error).message }));
      }
    };
    void load();
    const t = setInterval(load, pollMs);
    return () => {
      dead.current = true;
      clearInterval(t);
    };
  }, [pollMs]);

  return state;
}

/** Validate a pasted leader pubkey (base58, 32–44 chars) before streaming it. */
export function isLikelyPubkey(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim());
}
