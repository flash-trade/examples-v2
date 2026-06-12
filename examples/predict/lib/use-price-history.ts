// ─────────────────────────────────────────────────────────────────────────────
// lib/use-price-history.ts — client-side ring buffer of price ticks feeding
// the canvas chart. THE HARD PART: pushing on every POLL (not every CHANGE) —
// usePrice emits a fresh PriceInfo object per tick, so depending on object
// identity makes a flat price still drift the line rightward.
// GOTCHAS.md → (client-side only; no API gotchas) (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import type { PriceInfo } from "flash-v2";
import { useEffect, useState } from "react";
import { flash } from "./flash";

/**
 * Seed the chart with REAL history on market switch — Pyth's public
 * Benchmarks API (TradingView shim) serves minute closes for every feed the
 * app trades, keyed by the SAME `pythTicker` Flash's token config carries.
 * One fetch per switch; the live 1s poll keeps appending after the seed, so
 * the line has shape immediately instead of a flat creep.
 */
async function fetchSeed(market: string, points: number): Promise<number[] | null> {
  try {
    const tokens = await flash.tokens();
    const ticker = tokens.find((t) => t.symbol.toUpperCase() === market.toUpperCase())?.pythTicker;
    if (!ticker) return null;
    const to = Math.floor(Date.now() / 1000);
    const from = to - points * 60;
    const url =
      `https://benchmarks.pyth.network/v1/shims/tradingview/history` +
      `?symbol=${encodeURIComponent(ticker)}&resolution=1&from=${from}&to=${to}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = (await res.json()) as { s?: string; c?: number[] };
    if (j.s !== "ok" || !Array.isArray(j.c) || j.c.length < 2) return null;
    return j.c.filter((v) => Number.isFinite(v));
  } catch {
    return null;
  }
}

/** How many ticks the chart keeps (~4 min at the 1s poll). */
export const PRICE_HISTORY_CAP = 240;

/**
 * Append `price.priceUi` once per poll tick (object identity = one tick),
 * keep the last `cap` points. Returns the same array reference between ticks
 * so consumers can use it as a stable dependency.
 * `resetKey` (the market symbol) WIPES the buffer on change — mixing two
 * markets' prices in one buffer draws a deformed cross-scale line.
 */
export function usePriceHistory(price: PriceInfo | null, resetKey = "", cap = PRICE_HISTORY_CAP): number[] {
  const [points, setPoints] = useState<number[]>([]);

  useEffect(() => {
    setPoints([]); // new market, fresh chart…
    if (!resetKey) return;
    let dead = false;
    // …then seed it with real Pyth minute-closes (last ~60 min) so the line
    // is born with shape. Live ticks append after; if the seed loses the race
    // to the first live points, keep the live ones (never clobber freshness).
    void fetchSeed(resetKey, 60).then((seed) => {
      if (dead || !seed) return;
      setPoints((prev) => (prev.length > 5 ? prev : [...seed.slice(-cap + 1), ...prev]));
    });
    return () => { dead = true; };
  }, [resetKey, cap]);

  useEffect(() => {
    if (!price || !Number.isFinite(price.priceUi)) return;
    setPoints((prev) => {
      const next = prev.length >= cap ? prev.slice(prev.length - cap + 1) : prev.slice();
      next.push(price.priceUi);
      return next;
    });
  }, [price, cap]);

  return points;
}
