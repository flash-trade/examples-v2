// ─────────────────────────────────────────────────────────────────────────────
// components/top-bar.tsx — the terminal chrome: one flat hairline-bordered bar.
// Left: bolt mark · pair · rolling price (tap → pair sheet). Right: status
// segment (ms + live dot, tap → session log) · network tag · wallet segment
// (balance-first; key sm+). THE HARD PART: wallet-adapter's select() is async
// state — selecting an adapter then connecting must wait for the selection to
// land (the ref dance).
// GOTCHAS.md → (UI + wallet-adapter; no API gotchas) (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useRef, useState } from "react";
import Sheet from "@/components/sheet";
import RollingNumber from "@/components/rolling-number";
import { fmtMs, shortKey } from "@/lib/format";

// ── inline SVG icons (the only place the bolt exists — never the character) ──

export function Bolt({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden focusable="false">
      <path d="M36 8 L18 36 H30 L26 56 L46 26 H33 Z" fill="currentColor" />
    </svg>
  );
}

function Chevron({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" className={className} aria-hidden focusable="false">
      <path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CopyIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" className={className} aria-hidden focusable="false">
      <rect x="4.5" y="4.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9.5 4.5 V3.5 A1.5 1.5 0 0 0 8 2 H3.5 A1.5 1.5 0 0 0 2 3.5 V8 A1.5 1.5 0 0 0 3.5 9.5 H4.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

// ── the bar ───────────────────────────────────────────────────────────────────

export default function TopBar({
  priceText,
  market,
  live,
  liveLabel,
  lastErMs,
  walletUsdc,
  inBasketUsd,
  marginInUseUsd,
  onOpenLatency,
  onOpenWallet,
  onOpenMarket,
  onOpenFunds,
  onOpenHistory,
}: {
  /** Pre-formatted price ("$64.42") or null while loading. */
  priceText: string | null;
  /** Active trading pair symbol, e.g. "SOL". */
  market: string;
  live: boolean;
  liveLabel: string;
  /** Last ER confirm in ms (the latency chip), null before the first fill. */
  lastErMs: number | null;
  /** USDC in the connected wallet (base chain) — depositable. */
  walletUsdc: number | null;
  /** Net USDC deposited in the basket (V2 side); null until known. */
  inBasketUsd: number | null;
  /** Σ collateral backing open positions (positionMetrics). */
  marginInUseUsd: number;
  onOpenLatency: () => void;
  onOpenWallet: () => void;
  onOpenMarket: () => void;
  /** Opens the explicit Deposit | Withdraw sheet. */
  onOpenFunds: () => void;
  /** Opens the session transaction history. */
  onOpenHistory: () => void;
}) {
  const { publicKey, disconnect } = useWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const pk = publicKey?.toBase58() ?? null;

  const copy = async () => {
    if (!pk) return;
    try {
      await navigator.clipboard.writeText(pk);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard denied — the menu simply stays */
    }
  };

  return (
    /*
     * One flat bar: full-width, h-12, panel surface, single bottom hairline.
     * Segments divide with 1px left hairlines — no floating pills, no
     * translucency. The canvas y-axis labels start below it (clamped at 56px
     * in price-chart.tsx), so the bar owns its full width.
     */
    <header className="relative z-20 flex h-12 items-stretch border-b border-edge bg-panel">
      {/* left: bolt mark · pair · slot-reel price — one tappable segment */}
      <button
        onClick={onOpenMarket}
        aria-label={`${market}/USDC — select trading pair`}
        className="flex items-center gap-2.5 px-3 text-left transition-transform active:scale-[0.99]"
      >
        <Bolt className="h-3.5 w-3.5 text-accent" />
        <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.1em] text-dim">
          {market}/USDC
          <Chevron className="h-2.5 w-2.5 text-faint" />
        </span>
        <RollingNumber value={priceText} className="text-[13px] font-semibold leading-none text-ink" />
      </button>

      {/* right: status · network tag · wallet — hairline-divided segments */}
      <div className="ml-auto flex items-stretch">
        <button
          onClick={onOpenLatency}
          aria-label="connection status — open session latency log"
          title={
            lastErMs === null
              ? "your first fill measures the rollup confirm time"
              : "last confirm on the Ephemeral Rollup — tap for the session log"
          }
          className="flex items-center gap-1.5 border-l border-edge px-3 font-mono text-[11px] tabular-nums text-ink transition-transform active:scale-[0.99]"
        >
          {/* mobile pre-fill: dot only (chips don't fit 390px) */}
          {lastErMs === null ? (
            <span className="hidden text-faint sm:inline">— ms</span>
          ) : (
            fmtMs(lastErMs)
          )}
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              live ? "bg-long" : "soft-pulse bg-faint"
            }`}
          />
          <span className="hidden font-mono text-[9px] uppercase tracking-[0.12em] text-dim md:inline">{liveLabel}</span>
        </button>

        {pk ? (
          <div className="relative flex items-stretch">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              className="flex items-center gap-1.5 border-l border-edge px-3 font-mono text-xs text-ink transition-transform active:scale-[0.99]"
            >
              {/* NEVER unlabeled math: the segment renders ONLY the hook's own
                  value (inBasketUsd) under an explicit "V2" micro-label, and
                  only once the hook has returned. Derived figures (free to
                  trade, margin in use) live in the menu with full labels.
                  On mobile the balance IS the segment; the key shows from sm up
                  (and always while there's no balance to show). */}
              {inBasketUsd !== null && (
                <span className="flex items-baseline gap-1" title="USDC deposited in your V2 basket">
                  <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-faint">v2</span>
                  <span className="tabular-nums text-long">${inBasketUsd.toFixed(2)}</span>
                </span>
              )}
              <span className={inBasketUsd === null ? "" : "hidden sm:inline"}>{shortKey(pk)}</span>
              <Chevron className={`h-3 w-3 text-dim transition-transform ${menuOpen ? "rotate-180" : ""}`} />
            </button>
            {menuOpen && (
              <>
                <button
                  aria-label="close menu"
                  className="fixed inset-0 z-30 cursor-default"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 top-12 z-40 w-56 overflow-hidden rounded-[3px] border border-edge bg-panel2">
                  {/* account — network, what's deposited on V2, what's free to tap */}
                  <div className="grid gap-1.5 border-b border-edge px-3.5 py-3">
                    {([
                      ["network", "mainnet", "text-dim"],
                      ["wallet usdc", walletUsdc === null ? "—" : `$${walletUsdc.toFixed(2)}`, "text-ink"],
                      ["in basket (deposited)", inBasketUsd === null ? "—" : `$${inBasketUsd.toFixed(2)}`, "text-ink"],
                      ["margin in use", `$${marginInUseUsd.toFixed(2)}`, "text-dim"],
                      [
                        "free to trade",
                        inBasketUsd === null ? "—" : `$${Math.max(0, inBasketUsd - marginInUseUsd).toFixed(2)}`,
                        "text-long",
                      ],
                    ] as Array<[string, string, string]>).map(([label, v, cls]) => (
                      <div key={label} className="flex items-baseline justify-between gap-3">
                        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">{label}</span>
                        <span className={`font-mono text-xs tabular-nums ${cls}`}>{v}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenFunds();
                    }}
                    className="w-full px-3.5 py-2.5 text-left text-xs font-semibold text-long transition-colors hover:bg-panel active:scale-[0.99]"
                  >
                    deposit / withdraw
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      onOpenHistory();
                    }}
                    className="w-full border-t border-edge px-3.5 py-2.5 text-left text-xs text-ink transition-colors hover:bg-panel active:scale-[0.99]"
                  >
                    history
                  </button>
                  <button
                    onClick={() => void copy()}
                    className="flex w-full items-center gap-2 border-t border-edge px-3.5 py-2.5 text-left text-xs text-ink transition-colors hover:bg-panel active:scale-[0.99]"
                  >
                    <CopyIcon className="h-3.5 w-3.5 text-dim" />
                    {copied ? "copied" : "copy address"}
                  </button>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      void disconnect();
                    }}
                    className="w-full border-t border-edge px-3.5 py-2.5 text-left text-xs text-dim transition-colors hover:bg-panel hover:text-ink active:scale-[0.99]"
                  >
                    disconnect
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <span className="flex items-center border-l border-edge px-2.5">
            <button
              onClick={onOpenWallet}
              className="h-8 rounded-md bg-long px-3.5 text-xs font-bold text-bg transition-transform active:scale-[0.99]"
            >
              Connect Wallet
            </button>
          </span>
        )}
      </div>
    </header>
  );
}

// ── wallet picker sheet (Phantom · Solflare) ─────────────────────────────────

export function WalletSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { wallets, wallet, select, connect, connecting, connected } = useWallet();
  const [error, setError] = useState<string | null>(null);
  const wantConnect = useRef(false);
  // HYDRATION GUARD: readyState is "not detected" during SSR but "installed"
  // in any browser with the extension — and this sheet is mounted (hidden) at
  // first paint. Render the server-stable "install" label until after mount,
  // or React throws #418 on every load.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // select() is async state — finish the connect once the adapter is selected.
  useEffect(() => {
    if (wantConnect.current && wallet && !connected && !connecting) {
      wantConnect.current = false;
      connect().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    }
  }, [wallet, connected, connecting, connect]);

  useEffect(() => {
    if (connected && open) onClose();
  }, [connected, open, onClose]);

  return (
    <Sheet open={open} onClose={onClose} label="connect a wallet">
      <p className="font-display text-[15px] font-semibold text-ink">Connect a wallet</p>
      <p className="mt-1 text-xs leading-relaxed text-dim">
        Mainnet — real funds. Your wallet owns the basket; after Enable, taps auto-sign via a session key.
      </p>
      <div className="mt-4 grid gap-2">
        {/* HYDRATION GUARD: wallets array is empty during SSR (adapters register
            client-side); mounting before rendering prevents the SSR/client diff
            that causes React #418. Render nothing until after first paint. */}
        {mounted && wallets.map((w) => {
          const installed =
            w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable;
          return (
            <button
              key={w.adapter.name}
              onClick={() => {
                setError(null);
                if (!installed) {
                  window.open(w.adapter.url, "_blank", "noreferrer");
                  return;
                }
                if (wallet?.adapter.name === w.adapter.name) {
                  connect().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
                } else {
                  wantConnect.current = true;
                  select(w.adapter.name);
                }
              }}
              className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-[3px] border border-edge bg-panel px-3.5 py-3 text-left transition-colors hover:border-edge2 active:scale-[0.99]"
            >
              {/* adapter icons are data: URLs shipped by the adapter itself */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={w.adapter.icon} alt="" className="h-6 w-6 rounded-[3px]" />
              <span className="text-sm font-semibold text-ink">{w.adapter.name}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
                {connecting && wallet?.adapter.name === w.adapter.name
                  ? "connecting…"
                  : installed
                    ? "detected"
                    : "install"}
              </span>
            </button>
          );
        })}
      </div>
      {error && <p className="mt-3 break-all font-mono text-[11px] leading-relaxed text-short">{error}</p>}
    </Sheet>
  );
}
