// ─────────────────────────────────────────────────────────────────────────────
// components/wallet-bar.tsx — wordmark, connect, balances, session controls.
// THE HARD PART: balances must be labeled by WHERE they live (wallet vs
// basket) — an unlabeled number reads as "my deposit" and that's a consent
// bug. Mainnet warning shows at the connect moment, not buried in a footer.
// GOTCHAS.md → "Your balance is the DEPOSIT LEDGER" (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { WalletName } from "@solana/wallet-adapter-base";
import { CONNECT_WARNING } from "@/lib/copy";
import { fmtUsd, shortKey } from "@/lib/format";

interface Props {
  inBasketUsd: number | null;
  walletUsdc: number | null;
  sessionActive: boolean;
  busy: boolean;
  onFunds: () => void;
  onEnable: () => void;
  onRevoke: () => void;
  onShowDisclosure: () => void;
}

export function WalletBar({ inBasketUsd, walletUsdc, sessionActive, busy, onFunds, onEnable, onRevoke, onShowDisclosure }: Props) {
  const { wallets, select, connect, disconnect, connected, connecting, publicKey, wallet } = useWallet();
  const [picking, setPicking] = useState(false);
  const wantConnect = useRef(false);

  // select() is async-ish in adapter-land: connect on the effect after the
  // wallet object lands, not in the same tick as select().
  useEffect(() => {
    if (wallet && wantConnect.current && !connected && !connecting) {
      wantConnect.current = false;
      connect().catch(() => {});
    }
  }, [wallet, connected, connecting, connect]);

  const pick = useCallback(
    (name: WalletName) => {
      setPicking(false);
      wantConnect.current = true;
      select(name);
    },
    [select],
  );

  return (
    <header className="relative z-10 flex flex-wrap items-center gap-3 py-4">
      <div className="flex items-baseline gap-1 font-display text-lg font-black tracking-tight">
        <span className="text-up">UP</span>
        <span className="text-down">DOWN</span>
      </div>
      <button
        type="button"
        onClick={onShowDisclosure}
        className="cursor-pointer rounded-full border border-warn/30 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-warn"
      >
        Real positions · mainnet
      </button>

      <div className="ml-auto flex items-center gap-2">
        {connected && publicKey ? (
          <>
            <button
              type="button"
              onClick={onFunds}
              className="press cursor-pointer rounded-full border border-edge bg-panel px-3.5 py-1.5 font-mono text-[11px] text-ink"
            >
              <span className="text-faint">basket </span>
              {inBasketUsd === null ? "…" : fmtUsd(inBasketUsd)}
              <span className="mx-1.5 text-edge2">|</span>
              <span className="text-faint">wallet </span>
              {walletUsdc === null ? "…" : fmtUsd(walletUsdc)}
            </button>
            {sessionActive ? (
              <button
                type="button"
                onClick={onRevoke}
                disabled={busy}
                title="Session key active — taps settle without popups. Click to revoke."
                className="press cursor-pointer rounded-full border border-up/30 bg-up/10 px-3 py-1.5 font-mono text-[11px] text-up disabled:opacity-40"
              >
                ● session
              </button>
            ) : (
              <button
                type="button"
                onClick={onEnable}
                disabled={busy}
                className="press cursor-pointer rounded-full bg-ink px-3.5 py-1.5 font-display text-[11px] font-bold text-bg disabled:opacity-40"
              >
                Enable one-tap
              </button>
            )}
            <button
              type="button"
              onClick={() => void disconnect().catch(() => {})}
              className="press cursor-pointer rounded-full border border-edge px-3 py-1.5 font-mono text-[11px] text-dim"
              title="Disconnect"
            >
              {shortKey(publicKey.toBase58())}
            </button>
          </>
        ) : (
          <div className="relative">
            <button
              type="button"
              onClick={() => setPicking((p) => !p)}
              disabled={connecting}
              className="press cursor-pointer rounded-full bg-ink px-4 py-2 font-display text-xs font-bold text-bg disabled:opacity-50"
            >
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
            {picking && (
              <div className="absolute right-0 top-full z-30 mt-2 w-64 rounded-2xl border border-edge bg-panel2 p-2 shadow-xl row-in">
                <p className="px-2 pb-2 pt-1 text-[11px] leading-snug text-warn">{CONNECT_WARNING}</p>
                {wallets.map((w) => (
                  <button
                    key={w.adapter.name}
                    type="button"
                    onClick={() => pick(w.adapter.name)}
                    className="press flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[13px] text-ink hover:bg-panel"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={w.adapter.icon} alt="" className="h-5 w-5 rounded" />
                    {w.adapter.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
