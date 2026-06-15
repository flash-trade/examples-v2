// ─────────────────────────────────────────────────────────────────────────────
// components/discover.tsx — the market browser: category tabs + search +
// timeframe + a grid of MarketCards. Browsing needs NO wallet (markets are
// public: /v2/tokens + /v2/prices). Tapping a card hands (token, price, tf) up
// to open the detail + ticket (phase 4).
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useMemo, useState } from "react";
import { TIMEFRAMES, type TimeframeId } from "@/lib/payoff";
import { usePredictMarkets } from "@/lib/use-markets";
import { useAllMarketLimits } from "@/lib/hooks";
import type { ActiveSigner } from "@/lib/signer";
import { MarketCard } from "./market-card";
import { MarketDetail } from "./market-detail";

export function Discover({
  signer,
  canBet,
  onNeedWallet,
  onPlaced,
  onOpen,
}: {
  signer: ActiveSigner | null;
  canBet: boolean;
  onNeedWallet?: () => void;
  onPlaced?: () => void;
  onOpen?: (token: string, price: number, tf: TimeframeId) => void;
}) {
  const { rows, categories, loading, error } = usePredictMarkets();
  const limitsBySymbol = useAllMarketLimits(useMemo(() => rows.map((r) => r.token), [rows]));
  const [cat, setCat] = useState("All");
  const [tf, setTf] = useState<TimeframeId>("1h");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ token: string; price: number; tf: TimeframeId } | null>(null);

  const shown = useMemo(
    () =>
      rows.filter(
        (r) =>
          (cat === "All" || r.category === cat) &&
          (query === "" || r.token.toLowerCase().includes(query.toLowerCase())),
      ),
    [rows, cat, query],
  );
  const pills = categories.length > 0 ? ["All", ...categories] : [];

  return (
    <section className="mx-auto flex w-full max-w-[1100px] flex-col gap-5 px-4 py-6 sm:px-6">
      <header className="flex flex-col gap-1.5">
        <span className="w-max rounded-full bg-up/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-up">
          live · on-chain
        </span>
        <h1 className="font-display text-[28px] font-bold leading-tight tracking-tight text-ink sm:text-[34px]">
          What happens next?
        </h1>
        <p className="text-sm text-dim">Pick a side. Cents are the odds. Your stake is the most you can lose.</p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <label className="glass flex flex-1 items-center gap-2 rounded-full px-4 py-2.5">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-faint" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.2-3.2" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a market"
            className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-faint"
          />
        </label>
        <div className="flex gap-1 rounded-full bg-white/5 p-0.5">
          {TIMEFRAMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTf(t.id)}
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors ${tf === t.id ? "bg-white/10 text-ink" : "text-faint hover:text-dim"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {pills.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {pills.map((p) => (
            <button
              key={p}
              onClick={() => setCat(p)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${cat === p ? "glass text-ink" : "text-faint hover:text-dim"}`}
            >
              {p}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {loading && rows.length === 0 &&
          Array.from({ length: 6 }).map((_, i) => <div key={i} className="glass h-[152px] rounded-[16px] opacity-60" />)}
        {error && rows.length === 0 && (
          <div className="glass col-span-full rounded-[16px] px-4 py-3 text-sm text-down">Couldn&apos;t load markets: {error}</div>
        )}
        {!loading && !error && shown.length === 0 && (
          <div className="glass col-span-full rounded-[16px] px-4 py-6 text-center text-sm text-faint">No markets match.</div>
        )}
        {shown.map((r) => (
          <MarketCard
            key={r.token}
            token={r.token}
            price={r.price}
            timeframe={tf}
            limits={limitsBySymbol.get(r.token) ?? null}
            onOpen={() => {
              setSelected({ token: r.token, price: r.price, tf });
              onOpen?.(r.token, r.price, tf);
            }}
          />
        ))}
      </div>

      <p className="px-1 text-center text-[10px] leading-relaxed text-faint">
        Mainnet · real funds. Odds are set by a formula on a real leveraged position — not a shared-pot market with
        discovered prices. You can never lose more than your stake.
      </p>

      {selected && (
        <MarketDetail
          token={selected.token}
          price={selected.price}
          timeframe={selected.tf}
          signer={signer}
          canBet={canBet}
          onClose={() => setSelected(null)}
          onNeedWallet={onNeedWallet}
          onPlaced={onPlaced}
        />
      )}
    </section>
  );
}
