// ─────────────────────────────────────────────────────────────────────────────
// components/market-drawer.tsx — the market selector as a LEFT side drawer
// (owner spec), Flash-style rows: token icon · PAIR/USDC · active tick.
// Icons are Flash Trade's REAL token art, VENDORED LOCALLY in
// public/token-icons (65 files extracted from their client bundle) — no
// third-party fetch at runtime; their CDN is only a fallback for symbols
// newer than this snapshot, then a letter badge.
// Slide-in uses transform only; backdrop + Escape close; content stays
// mounted so the list never re-fetches.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useState } from "react";

// Flash Trade's REAL token art — extracted from their client bundle:
// https://dxjms0h859jb3.cloudfront.net/token-icons/{symbol}.{ext}
// (live-verified: sol.png 847B image/png, crudeoil.png image/png). The ext
// map below mirrors their bundle exactly; unknown symbols try png → svg →
// letter badge, so new Flash listings degrade gracefully.
const FLASH_ICON_HOST = "https://dxjms0h859jb3.cloudfront.net/token-icons";
const FLASH_ICON_EXT: Record<string, string> = {
  "2z": "png",
  "aapl": "png",
  "ada": "png",
  "amd": "png",
  "amzn": "png",
  "asts": "svg",
  "aud": "png",
  "bnb": "png",
  "btc": "svg",
  "chip": "svg",
  "coin": "svg",
  "copper": "svg",
  "crcl": "svg",
  "crudeoil": "png",
  "eth": "svg",
  "eur": "png",
  "flp.x": "png",
  "gbp": "png",
  "hype": "png",
  "intc": "svg",
  "iwm": "png",
  "jitosol": "png",
  "jup": "png",
  "kmno": "png",
  "lit": "png",
  "lly": "svg",
  "mega": "svg",
  "mon": "png",
  "mstr": "svg",
  "mu": "svg",
  "natgas": "svg",
  "near": "png",
  "nvda": "png",
  "ondo": "svg",
  "ore": "png",
  "pump": "png",
  "pyth": "png",
  "qcom": "svg",
  "samo": "png",
  "sflp.x": "png",
  "sndk": "svg",
  "sol": "svg",
  "spr": "png",
  "spy": "png",
  "spyr": "png",
  "sui": "png",
  "tao": "svg",
  "ton": "svg",
  "trump": "png",
  "trx": "svg",
  "tsla": "png",
  "tsm": "svg",
  "txn": "svg",
  "usdcnh": "png",
  "usdjpy": "png",
  "vvv": "png",
  "wif": "png",
  "wsol": "png",
  "xag": "png",
  "xau": "png",
  "xaut": "png",
  "xpd": "svg",
  "xpt": "svg",
  "xrp": "png",
  "zec": "png",
};

function iconCandidates(symbol: string): string[] {
  const s = symbol.toLowerCase();
  const known = FLASH_ICON_EXT[s];
  const c = [
    // LOCAL first — vendored in public/token-icons (developers own the assets)
    ...(known ? [`/token-icons/${s}.${known}`] : [`/token-icons/${s}.png`]),
    // CDN fallback covers listings newer than the vendored snapshot
    ...(known ? [`${FLASH_ICON_HOST}/${s}.${known}`] : []),
    `${FLASH_ICON_HOST}/${s}.png`,
    `${FLASH_ICON_HOST}/${s}.svg`,
  ];
  return [...new Set(c)];
}

function MarketIcon({ symbol }: { symbol: string }) {
  const [idx, setIdx] = useState(0);
  const candidates = iconCandidates(symbol);
  if (idx >= candidates.length) {
    return (
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-edge2 bg-panel2 font-mono text-[9px] font-bold text-dim">
        {symbol.slice(0, 3)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={candidates[idx]}
      alt=""
      className="h-6 w-6 shrink-0 rounded-full"
      onError={() => setIdx((i) => i + 1)}
    />
  );
}

export default function MarketDrawer({
  open,
  onClose,
  active,
  markets,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  active: string;
  /** LIVE list from Flash's config — new listings appear automatically. */
  markets: string[];
  onSelect: (market: string) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open} inert={!open}>
      <div
        className={`backdrop-fade absolute inset-0 bg-black/60 ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="select market"
        className={`absolute inset-y-0 left-0 w-72 border-r border-edge bg-sheet transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-12 items-center justify-between border-b border-edge px-4">
          <span className="font-display text-[14px] font-semibold text-ink">Markets</span>
          <button
            onClick={onClose}
            aria-label="close market selector"
            className="grid h-6 w-6 place-items-center rounded-[3px] border border-edge text-dim transition-colors hover:border-edge2 hover:text-ink"
          >
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden>
              <path d="M2 2 L8 8 M8 2 L2 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="max-h-[calc(100dvh-3rem)] overflow-y-auto p-2">
          {markets.map((m) => (
            <button
              key={m}
              onClick={() => onSelect(m)}
              aria-pressed={m === active}
              className={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-[3px] border px-3 py-2.5 text-left transition-colors active:scale-[0.99] ${
                m === active
                  ? "border-long/50 bg-long/10 text-long"
                  : "border-transparent text-ink hover:border-edge hover:bg-panel"
              }`}
            >
              <MarketIcon symbol={m} />
              <span className="font-mono text-sm font-semibold tracking-[0.02em]">{m}/USDC</span>
              {m === active && (
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-long">active</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
