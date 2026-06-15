// ─────────────────────────────────────────────────────────────────────────────
// components/wallet-picker.tsx — connect ANY wallet, not a hardcoded one. Lists
// every wallet the browser exposes (Wallet Standard auto-detects Phantom,
// Solflare, Backpack, Glow, … — nothing here is pinned to a specific wallet) and
// lets the user pick. Selecting hands off to the adapter, which connects.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useMemo } from "react";
import { useWallet, type Wallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";

const rank = (w: Wallet): number =>
  w.readyState === WalletReadyState.Installed ? 2 : w.readyState === WalletReadyState.Loadable ? 1 : 0;

export function WalletPicker({ onClose }: { onClose: () => void }) {
  const { wallets, select } = useWallet();

  // Installed/loadable first; de-dup by name (explicit adapters + Standard
  // detection can surface the same wallet twice).
  const shown = useMemo(() => {
    const seen = new Set<string>();
    const ranked = [...wallets].sort((a, b) => rank(b) - rank(a));
    const deduped = ranked.filter((w) => {
      const n = w.adapter.name;
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
    const ready = deduped.filter(
      (w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable,
    );
    return ready.length > 0 ? ready : deduped;
  }, [wallets]);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="glass relative z-10 flex w-full max-w-[380px] flex-col gap-2 rounded-t-[22px] p-5 sm:rounded-[22px]">
        <div className="mb-1 flex items-center justify-between">
          <p className="font-display text-[15px] font-bold text-ink">Connect a wallet</p>
          <button onClick={onClose} className="rounded-full bg-white/5 px-3 py-1.5 font-mono text-[11px] text-dim hover:text-ink">
            Close
          </button>
        </div>

        {shown.length === 0 ? (
          <p className="py-6 text-center text-[13px] leading-relaxed text-dim">
            No Solana wallet detected. Install Phantom, Solflare, Backpack, or another wallet, then try again.
          </p>
        ) : (
          shown.map((w) => (
            <button
              key={w.adapter.name}
              onClick={() => {
                select(w.adapter.name);
                onClose();
              }}
              className="flex items-center gap-3 rounded-[12px] border border-edge px-3.5 py-3 text-left transition-colors hover:border-edge2"
            >
              {w.adapter.icon && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={w.adapter.icon} alt="" className="h-6 w-6 rounded" />
              )}
              <span className="flex-1 text-[14px] font-semibold text-ink">{w.adapter.name}</span>
              {w.readyState === WalletReadyState.Installed && (
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-up">detected</span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
