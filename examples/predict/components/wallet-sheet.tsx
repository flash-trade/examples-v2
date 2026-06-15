// ─────────────────────────────────────────────────────────────────────────────
// components/wallet-sheet.tsx — connect ANY wallet, the SAME flow the other apps
// use (tap-trade's WalletSheet). THE HARD PART: wallet-adapter's select() is
// async state — selecting an adapter then connecting must wait for the selection
// to land (the "ref dance"): a `wantConnect` ref + an effect that fires connect()
// once `wallet` is the chosen adapter. Not-installed wallets open their install
// page; a hydration guard keeps readyState SSR-stable (React #418). Predict glass.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { WalletReadyState } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useRef, useState } from "react";
import { useSheetMount } from "@/lib/use-sheet-mount";

export function WalletSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { wallets, wallet, select, connect, connecting, connected } = useWallet();
  const { mounted, closing } = useSheetMount(open);
  const [error, setError] = useState<string | null>(null);
  const wantConnect = useRef(false);

  // HYDRATION GUARD: wallets/readyState are empty/"not detected" during SSR but
  // populate client-side. Render the list only after mount so the server/client
  // markup matches (React #418 otherwise).
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  // select() is async state — finish the connect once the adapter is selected.
  useEffect(() => {
    if (wantConnect.current && wallet && !connected && !connecting) {
      wantConnect.current = false;
      connect().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    }
  }, [wallet, connected, connecting, connect]);

  // Close on a successful connect.
  useEffect(() => {
    if (connected && open) onClose();
  }, [connected, open, onClose]);

  if (!mounted) return null;
  return (
    <div className="fixed inset-0 z-[60]">
      <div className={`absolute inset-0 bg-bg/70 ${closing ? "backdrop-out" : "backdrop-in"}`} onClick={onClose} />
      <div
        className={`absolute inset-x-0 bottom-0 mx-auto max-w-[420px] ${closing ? "sheet-out" : "sheet-in"}`}
        role="dialog"
        aria-modal="true"
        aria-label="connect a wallet"
      >
        <div className="glass m-2 rounded-[20px]">
          <div className="p-5">
            <div className="flex items-center justify-between">
              <p className="font-display text-[15px] font-bold text-ink">Connect a wallet</p>
              <button onClick={onClose} className="rounded-full bg-white/5 px-3 py-1.5 font-mono text-[11px] text-dim hover:text-ink">
                Close
              </button>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-dim">
              Mainnet — real funds. Your wallet owns the account; after Enable, taps auto-sign via a session key.
            </p>

            <div className="mt-4 grid gap-2">
              {hydrated &&
                wallets.map((w) => {
                  const installed =
                    w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable;
                  const isThis = wallet?.adapter.name === w.adapter.name;
                  return (
                    <button
                      key={w.adapter.name}
                      onClick={() => {
                        setError(null);
                        if (!installed) {
                          window.open(w.adapter.url, "_blank", "noreferrer");
                          return;
                        }
                        if (isThis) {
                          connect().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
                        } else {
                          wantConnect.current = true;
                          select(w.adapter.name);
                        }
                      }}
                      className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-[12px] border border-edge bg-white/[0.02] px-3.5 py-3 text-left transition-colors hover:border-edge2 active:scale-[0.99]"
                    >
                      {/* adapter icons are data: URLs shipped by the adapter itself */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={w.adapter.icon} alt="" className="h-6 w-6 rounded-[6px]" />
                      <span className="text-[14px] font-semibold text-ink">{w.adapter.name}</span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
                        {connecting && isThis ? "connecting…" : installed ? "detected" : "install"}
                      </span>
                    </button>
                  );
                })}
              {hydrated && wallets.length === 0 && (
                <p className="py-6 text-center text-[13px] leading-relaxed text-dim">
                  No Solana wallet detected. Install Phantom, Solflare, or Backpack, then try again.
                </p>
              )}
            </div>

            {error && <p className="mt-3 break-all font-mono text-[11px] leading-relaxed text-down">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
