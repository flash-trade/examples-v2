// ─────────────────────────────────────────────────────────────────────────────
// lib/use-markets.ts — live market rows for the Discover grid.
// One bulk /tokens (static per session) + a polled /prices; each tradeable
// token becomes a row {symbol, category, live price} the card prices into a
// YES/NO question via lib/markets.ts. Category taxonomy mirrors the picker's
// (Pyth-ticker prefix) and is HIDDEN unless most tokens classify — a partial
// taxonomy is a silently-wrong filter.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useState } from "react";
import type { TokenInfo } from "flash-v2";
import { flash } from "./flash";

const CATEGORY_LABELS: Record<string, string> = {
  Crypto: "Crypto", Equity: "Stocks", FX: "FX", Metal: "Metals",
  Commodity: "Commodities", Commodities: "Commodities", Energy: "Commodities", Rates: "Rates",
};

function categoryOf(pythTicker?: string | null): string | null {
  if (!pythTicker) return null;
  return CATEGORY_LABELS[pythTicker.split(".")[0] ?? ""] ?? null;
}

export interface PredictMarketRow {
  token: string;
  category: string | null;
  /** live mark price (priceUi). */
  price: number;
}

// token list is static per session — cache the promise.
let tokensOnce: Promise<TokenInfo[]> | null = null;
const cachedTokens = () => (tokensOnce ??= flash.tokens().catch((e) => ((tokensOnce = null), Promise.reject(e))));

export function usePredictMarkets(pollMs = 5000): {
  rows: PredictMarketRow[];
  categories: string[];
  loading: boolean;
  error: string | null;
} {
  const [rows, setRows] = useState<PredictMarketRow[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const [tokens, prices] = await Promise.all([cachedTokens(), flash.prices()]);
        if (!alive) return;
        const tradeable = tokens.filter((t) => !t.isStable);
        const built = tradeable
          .map((t) => ({ token: t.symbol, category: categoryOf(t.pythTicker), price: prices[t.symbol]?.priceUi ?? 0 }))
          .filter((r) => r.price > 0);
        setRows(built);
        const classified = built.filter((r) => r.category).length;
        const cats = Array.from(new Set(built.map((r) => r.category).filter(Boolean) as string[])).sort();
        // hide the category filter unless ≥60% classify (a partial taxonomy lies).
        setCategories(built.length > 0 && classified / built.length >= 0.6 ? cats : []);
        setError(null);
        setLoading(false);
      } catch (e) {
        if (alive) {
          setError((e as Error).message);
          setLoading(false);
        }
      }
      if (alive) timer = setTimeout(() => void tick(), pollMs);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [pollMs]);

  return { rows, categories, loading, error };
}
