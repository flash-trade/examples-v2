// ─────────────────────────────────────────────────────────────────────────────
// components/markets-app.tsx — the prediction-market app shell at /markets.
// Reuses the SAME proven wiring as the Updown orchestrator (providers → owner
// stream → session → signer → enable) so a connected + enabled user places REAL
// bets through MarketDetail. Browsing stays wallet-free; the wallet is asked for
// only at "back this". Deposits live on the main app for now (phase 5b: bring
// the funds sheet here + a portfolio of open bets).
//
// ⚠️ Real-funds path — built + compiles, but NOT yet through the mandatory
// adversarial review (subagents rate-limited). Don't trade real funds until it is.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ConnectionProvider, WalletProvider, useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { enableOneClickTrading, type EnableWalletCtx } from "@/lib/enable";
import { flash } from "@/lib/flash";
import { shortKey } from "@/lib/format";
import { useBalances, useBasketBalance, useUsdcMint } from "@/lib/hooks";
import { loadSession, type LoadedSession } from "@/lib/session";
import { makeSessionSigner } from "@/lib/signer";
import { StreamProvider, useStream } from "@/lib/stream";
import { Discover } from "./discover";
import { Portfolio } from "./portfolio";

export function MarketsApp() {
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={flash.network.baseRpc}>
      <WalletProvider wallets={wallets} autoConnect>
        <Shell />
      </WalletProvider>
    </ConnectionProvider>
  );
}

function Shell() {
  const { publicKey } = useWallet();
  const owner = publicKey ? publicKey.toBase58() : null;
  return (
    <StreamProvider owner={owner}>
      <Inner owner={owner} />
    </StreamProvider>
  );
}

function Inner({ owner }: { owner: string | null }) {
  const walletCtx = useWallet();
  const anchorWallet = useAnchorWallet();
  const { snapshot } = useStream();
  const usdcMint = useUsdcMint();
  const balances = useBalances(owner, usdcMint);
  const basket = useBasketBalance(owner, snapshot?.basketPubkey ?? null, usdcMint);
  const inBasketUsd = basket.bal?.inBasketUsd ?? null;
  const positions = useMemo(() => Object.values(snapshot?.positionMetrics ?? {}), [snapshot]);

  const [session, setSession] = useState<LoadedSession | null>(null);
  useEffect(() => {
    setSession(owner ? loadSession(owner) : null);
  }, [owner]);
  const signer = useMemo(
    () => (session && anchorWallet ? makeSessionSigner(anchorWallet, session, flash.network) : null),
    [session, anchorWallet],
  );

  const basketExists = Boolean(snapshot?.basketPubkey);
  const canBet = basketExists && Boolean(signer) && (inBasketUsd ?? 0) >= 1;

  const [enabling, setEnabling] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const connect = useCallback(() => {
    walletCtx.select?.(walletCtx.wallets[0]?.adapter.name ?? null);
  }, [walletCtx]);

  const enable = useCallback(async () => {
    if (!walletCtx.publicKey || !walletCtx.signTransaction || !anchorWallet) {
      connect();
      return;
    }
    setEnabling(true);
    setNote(null);
    try {
      const ctx: EnableWalletCtx = {
        publicKey: walletCtx.publicKey,
        signTransaction: walletCtx.signTransaction,
        signAllTransactions: walletCtx.signAllTransactions,
      };
      const result = await enableOneClickTrading({
        wallet: ctx,
        anchorWallet,
        snapshot,
        usdcMint,
        balances: { sol: balances.sol, usdc: balances.usdc },
        onStep: () => {},
        onLog: () => {},
      });
      if (result.session) setSession(result.session);
      if (!result.ok) {
        setNote(result.needsUsdc ? "Account ready — deposit USDC on the main app, then bet." : "Couldn't finish enabling — check your wallet.");
      } else if (result.needsUsdc) {
        setNote("Deposit USDC on the main app to start betting.");
      }
      void balances.refresh();
      void basket.refresh();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setEnabling(false);
    }
  }, [walletCtx, anchorWallet, snapshot, usdcMint, balances, basket, connect]);

  const onNeedWallet = useCallback(() => {
    if (!owner) connect();
    else void enable();
  }, [owner, connect, enable]);

  return (
    <main className="relative z-[1] min-h-[100dvh]">
      <header className="mx-auto flex w-full max-w-[1100px] items-center justify-between px-4 py-4 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-up/15 font-display text-[14px] font-bold text-up">P</span>
          <span className="font-display text-[15px] font-bold text-ink">predict</span>
        </div>
        {owner ? (
          <div className="flex items-center gap-2">
            {canBet ? (
              <span className="rounded-full bg-white/5 px-3 py-1.5 font-mono text-[11px] tabular-nums text-up">${(inBasketUsd ?? 0).toFixed(2)}</span>
            ) : (
              <button
                onClick={() => void enable()}
                disabled={enabling}
                className="cta-glow-up rounded-full bg-up px-3.5 py-1.5 text-[12px] font-bold text-up-deep disabled:opacity-50"
              >
                {enabling ? "enabling…" : "Enable one-tap"}
              </button>
            )}
            <span className="font-mono text-[11px] text-dim">{shortKey(owner)}</span>
          </div>
        ) : (
          <button onClick={connect} className="cta-glow-up rounded-full bg-up px-4 py-2 text-[13px] font-bold text-up-deep">
            Connect
          </button>
        )}
      </header>
      {note && <p className="mx-auto max-w-[1100px] px-4 text-center font-mono text-[11px] text-warn sm:px-6">{note}</p>}
      {owner && <Portfolio positions={positions} />}
      <Discover signer={signer} canBet={canBet} onNeedWallet={onNeedWallet} onPlaced={() => void basket.refresh()} />
    </main>
  );
}
