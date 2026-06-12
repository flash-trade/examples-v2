// ─────────────────────────────────────────────────────────────────────────────
// components/market-picker.tsx — pick what you're calling. A glass button
// (icon · symbol · live price) opens a searchable sheet: 45+ markets need
// search, not a scroll row. THE HARD PART: category pills are derived from
// Pyth ticker prefixes, which is best-effort taxonomy — if less than 70% of
// tokens classify cleanly, the pills hide themselves (council: never ship a
// silently-wrong filter). Prices in the grid come from ONE bulk prices()
// call on open. GOTCHAS.md → "Deposits take a MINT, trading takes SYMBOLS"
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PriceInfo, TokenInfo } from "flash-v2";
import { fmtPrice } from "@/lib/copy";
import { flash } from "@/lib/flash";
import { useSheetMount } from "@/lib/use-sheet-mount";
import { TokenIcon } from "./token-icon";

// Module-level caches: the token list is static per session, and the grid's
// price hints don't need to be fresher than a few seconds across re-opens.
let tokensOnce: Promise<TokenInfo[]> | null = null;
const cachedTokens = () => (tokensOnce ??= flash.tokens().catch((e) => ((tokensOnce = null), Promise.reject(e))));
let pricesAt = 0;
let pricesCache: Record<string, PriceInfo> = {};
const PRICES_TTL_MS = 10_000;
async function cachedPrices(): Promise<Record<string, PriceInfo>> {
  if (Date.now() - pricesAt < PRICES_TTL_MS) return pricesCache;
  pricesCache = await flash.prices();
  pricesAt = Date.now();
  return pricesCache;
}

interface Props {
  markets: string[] | null;
  market: string;
  price: PriceInfo | null;
  disabled?: boolean;
  onSelect: (symbol: string) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  Crypto: "Crypto",
  Equity: "Stocks",
  FX: "FX",
  Metal: "Metals",
  Commodity: "Commodities",
  Commodities: "Commodities",
  Energy: "Commodities",
  Rates: "Rates",
};

function categoryOf(pythTicker: string | null | undefined): string | null {
  if (!pythTicker) return null;
  const prefix = pythTicker.split(".")[0] ?? "";
  return CATEGORY_LABELS[prefix] ?? null;
}

export function MarketPicker({ markets, market, price, disabled, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const { mounted, closing } = useSheetMount(open);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [categories, setCategories] = useState<Map<string, string>>(new Map()); // symbol → category
  const [pills, setPills] = useState<string[]>([]);
  const [gridPrices, setGridPrices] = useState<Record<string, PriceInfo>>({});
  const searchRef = useRef<HTMLInputElement>(null);

  // Best-effort taxonomy from token metadata; hide pills unless ≥70% classify.
  useEffect(() => {
    let alive = true;
    cachedTokens()
      .then((tokens) => {
        if (!alive) return;
        const map = new Map<string, string>();
        let classified = 0;
        const tradeable = tokens.filter((t) => !t.isStable);
        for (const t of tradeable) {
          const cat = categoryOf(t.pythTicker);
          if (cat) {
            map.set(t.symbol, cat);
            classified++;
          }
        }
        setCategories(map);
        if (tradeable.length > 0 && classified / tradeable.length >= 0.7) {
          setPills(["All", ...Array.from(new Set(map.values())).sort()]);
        } else {
          setPills([]);
        }
      })
      .catch(() => setPills([]));
    return () => {
      alive = false;
    };
  }, []);

  // One bulk price snapshot when the sheet opens (grid hints, not live ticks).
  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    cachedPrices()
      .then(setGridPrices)
      .catch(() => {});
  }, [open]);

  const list = useMemo(() => {
    const all = markets ?? [];
    const q = query.trim().toUpperCase();
    return all.filter((s) => {
      if (q && !s.toUpperCase().includes(q)) return false;
      if (category !== "All" && pills.length > 0 && categories.get(s) !== category) return false;
      return true;
    });
  }, [markets, query, category, categories, pills.length]);

  const pick = (s: string) => {
    onSelect(s);
    setOpen(false);
    setQuery("");
    setCategory("All");
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="press glass-strong flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left disabled:opacity-60"
      >
        <TokenIcon symbol={market} size={26} />
        <span className="font-display text-base font-bold">{market}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">tap to change</span>
        <span className="ml-auto font-mono text-sm text-ink">{price ? fmtPrice(price.priceUi) : "…"}</span>
        <span className="text-faint">⌄</span>
      </button>

      {mounted && (
      <div className="fixed inset-0 z-40">
        <div
          className={`absolute inset-0 bg-bg/70 backdrop-blur-sm ${closing ? "backdrop-out" : "backdrop-in"}`}
          onClick={() => setOpen(false)}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Choose a market"
          className={`absolute inset-x-0 bottom-0 mx-auto flex max-h-[78dvh] w-full max-w-lg flex-col ${closing ? "sheet-out" : "sheet-in"}`}
        >
          <div className="glass m-2 flex min-h-0 flex-1 flex-col p-4">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search markets…"
              aria-label="Search markets"
              className="film w-full px-4 py-3 font-mono text-sm text-ink placeholder:text-faint focus:outline-none"
            />

            {pills.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {pills.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setCategory(p)}
                    className={`press cursor-pointer rounded-full border px-3 py-1 font-mono text-[10.5px] ${
                      category === p ? "border-ink/50 bg-ink/10 text-ink" : "border-edge text-dim"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-3 grid min-h-0 flex-1 grid-cols-3 content-start gap-1.5 overflow-y-auto pb-1 sm:grid-cols-4">
              {(markets === null ? [] : list).map((s) => {
                const p = gridPrices[s];
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => pick(s)}
                    className={`press flex cursor-pointer flex-col items-center gap-1 rounded-2xl border px-2 py-3 ${
                      s === market ? "border-up/50 bg-up/10" : "border-edge bg-panel/60 hover:border-edge2"
                    }`}
                  >
                    <TokenIcon symbol={s} size={26} />
                    <span className="font-display text-[12px] font-bold text-ink">{s}</span>
                    <span className="font-mono text-[9.5px] text-faint">{p ? fmtPrice(p.priceUi, "compact") : " "}</span>
                  </button>
                );
              })}
              {markets === null && <span className="col-span-full py-8 text-center font-mono text-[11px] text-faint soft-pulse">loading markets…</span>}
              {markets !== null && list.length === 0 && (
                <span className="col-span-full py-8 text-center font-mono text-[11px] text-faint">nothing matches “{query}”</span>
              )}
            </div>
          </div>
        </div>
      </div>
      )}
    </>
  );
}
