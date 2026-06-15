// ─────────────────────────────────────────────────────────────────────────────
// components/wallet-menu.tsx — the connected wallet segment + dropdown, matching
// the other apps (tap-trade's top-bar wallet menu): balance · deposit/withdraw ·
// copy address · disconnect. Predict glass styling.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useState } from "react";
import { shortKey } from "@/lib/format";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 12 12" className={`h-3 w-3 text-dim transition-transform ${open ? "rotate-180" : ""}`} aria-hidden focusable="false">
      <path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function WalletMenu({
  owner,
  walletUsdc,
  inBasketUsd,
  onOpenFunds,
}: {
  owner: string;
  walletUsdc: number | null;
  inBasketUsd: number | null;
  onOpenFunds: () => void;
}) {
  const { disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(owner);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard denied — the menu stays */
    }
  };
  const usd = (n: number | null) => (n === null ? "—" : `$${n.toFixed(2)}`);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Account"
        className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 font-mono text-[11px] text-ink transition-colors hover:bg-white/10"
      >
        {inBasketUsd !== null && <span className="tabular-nums text-up" title="USDC in your trading account">${inBasketUsd.toFixed(2)}</span>}
        <span className={inBasketUsd === null ? "" : "hidden text-dim sm:inline"}>{shortKey(owner)}</span>
        <Chevron open={open} />
      </button>

      {open && (
        <>
          <button aria-label="close menu" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
          <div className="glass absolute right-0 top-10 z-50 w-56 overflow-hidden rounded-[14px]">
            <div className="grid gap-1.5 border-b border-edge px-3.5 py-3">
              {(
                [
                  ["network", "mainnet", "text-dim"],
                  ["wallet usdc", usd(walletUsdc), "text-ink"],
                  ["in account", usd(inBasketUsd), "text-up"],
                ] as Array<[string, string, string]>
              ).map(([label, v, cls]) => (
                <div key={label} className="flex items-baseline justify-between gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">{label}</span>
                  <span className={`font-mono text-[11px] tabular-nums ${cls}`}>{v}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => { setOpen(false); onOpenFunds(); }}
              className="w-full px-3.5 py-2.5 text-left text-[12px] font-semibold text-up transition-colors hover:bg-white/5 active:scale-[0.99]"
            >
              deposit / withdraw
            </button>
            <button
              onClick={() => void copy()}
              className="w-full border-t border-edge px-3.5 py-2.5 text-left text-[12px] text-ink transition-colors hover:bg-white/5 active:scale-[0.99]"
            >
              {copied ? "copied" : "copy address"}
            </button>
            <button
              onClick={() => { setOpen(false); void disconnect(); }}
              className="w-full border-t border-edge px-3.5 py-2.5 text-left text-[12px] text-dim transition-colors hover:bg-white/5 hover:text-ink active:scale-[0.99]"
            >
              disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}
