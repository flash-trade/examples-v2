// ─────────────────────────────────────────────────────────────────────────────
// components/markets-app.tsx — THE app shell, at the root route /. Standalone:
// providers → owner stream → session → signer → enable → bet → settle, plus its
// OWN deposit/withdraw (FundsSheet) and an ANY-wallet picker (no wallet is
// hardcoded). Browsing is wallet-free; the wallet is asked for only at "back
// this". (The old Updown app + the cross-app shared-position hazard are gone.)
//
// ⚠️ Real-funds path on Solana mainnet. The disclosure stays until the F7 guard +
// scoring residuals are signed off (SPEC-PREDICT-V2 → v2.1 REVIEW OUTCOME).
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ConnectionProvider, WalletProvider, useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { enableOneClickTrading, type EnableState, type EnableWalletCtx } from "@/lib/enable";
import { depositUsdc, executeWithdrawalStep, withdrawUsdc, type FundsStep } from "@/lib/funds";
import { flash } from "@/lib/flash";
import { calmError } from "@/lib/copy";
import { shortKey } from "@/lib/format";
import { useBalances, useBasketBalance, useUsdcMint } from "@/lib/hooks";
import { loadSession, type LoadedSession } from "@/lib/session";
import { makeSessionSigner } from "@/lib/signer";
import { StreamProvider, useStream } from "@/lib/stream";
import { useMarketRounds } from "@/lib/use-market-rounds";
import { Bets } from "./bets";
import { Discover } from "./discover";
import { FundsSheet } from "./funds-sheet";
import { WalletPicker } from "./wallet-picker";

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

  const [session, setSession] = useState<LoadedSession | null>(null);
  useEffect(() => {
    setSession(owner ? loadSession(owner) : null);
  }, [owner]);
  const signer = useMemo(
    () => (session && anchorWallet ? makeSessionSigner(anchorWallet, session, flash.network) : null),
    [session, anchorWallet],
  );

  // Settlement engine: records each bet, auto-closes it at its deadline, and
  // resolves win/lose. The "by <timeframe>" promise is only honest with this.
  const { rounds, now, addRound, settleNow } = useMarketRounds(owner, snapshot, signer);

  // "canBet" = wallet connected + one-tap enabled. Whether THIS stake is funded
  // (≥ MIN_STAKE and ≤ available) is gated per-bet in the ticket against
  // `availableUsd`, so an enabled-but-underfunded user gets an "add funds"
  // message on the ticket rather than a dead-end "enable" CTA.
  const basketExists = Boolean(snapshot?.basketPubkey);
  const canBet = basketExists && Boolean(signer);

  const [enabling, setEnabling] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Open the wallet picker — the user chooses ANY installed wallet (no wallet is
  // hardcoded; selection happens in WalletPicker via Wallet Standard).
  const connect = useCallback(() => setPickerOpen(true), []);
  const disconnect = useCallback(() => { void walletCtx.disconnect(); }, [walletCtx]);

  // ── funds: deposit/withdraw USDC ↔ basket (ported so /markets is standalone).
  // Withdraw is two-phase by design (request → execute, ~30–90s).
  const [fundsOpen, setFundsOpen] = useState(false);
  const [fundsStep, setFundsStep] = useState<FundsStep | null>(null);
  const [executePending, setExecutePending] = useState(false);
  const [fundsBusy, setFundsBusy] = useState(false);

  const fundsWallet = useMemo<EnableWalletCtx | null>(() => {
    if (!walletCtx.publicKey || !walletCtx.signTransaction) return null;
    return {
      publicKey: walletCtx.publicKey,
      signTransaction: walletCtx.signTransaction,
      signAllTransactions: walletCtx.signAllTransactions,
    };
  }, [walletCtx.publicKey, walletCtx.signTransaction, walletCtx.signAllTransactions]);

  const doDeposit = useCallback(async (amount: string) => {
    if (!fundsWallet || !usdcMint) return;
    setFundsBusy(true);
    try {
      const r = await depositUsdc({ wallet: fundsWallet, usdcMint, amount, onStep: setFundsStep, onLog: () => {} });
      if (!r.ok && r.error) setNote(r.error);
      await Promise.all([balances.refresh(), basket.refresh()]);
    } finally {
      setFundsBusy(false);
    }
  }, [fundsWallet, usdcMint, balances, basket]);

  const doWithdraw = useCallback(async (amount: string) => {
    if (!fundsWallet || !usdcMint) return;
    setFundsBusy(true);
    try {
      const r = await withdrawUsdc({ wallet: fundsWallet, usdcMint, amount, onStep: setFundsStep, onLog: () => {} });
      setExecutePending(Boolean(r.executePending));
      if (!r.ok && r.error) setNote(r.error);
      await Promise.all([balances.refresh(), basket.refresh()]);
    } finally {
      setFundsBusy(false);
    }
  }, [fundsWallet, usdcMint, balances, basket]);

  const doExecuteWithdraw = useCallback(async () => {
    if (!fundsWallet || !usdcMint) return;
    setFundsBusy(true);
    try {
      const r = await executeWithdrawalStep({ wallet: fundsWallet, usdcMint, onStep: setFundsStep, onLog: () => {} });
      setExecutePending(Boolean(r.executePending));
      if (!r.ok && r.error) setNote(r.error);
      await Promise.all([balances.refresh(), basket.refresh()]);
    } finally {
      setFundsBusy(false);
    }
  }, [fundsWallet, usdcMint, balances, basket]);

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
      // Capture the live step state so a failure can name the REAL step error
      // (already human-phrased upstream) instead of a generic "check your wallet".
      // A container defeats closure-assignment narrowing.
      const step: { last: EnableState | null } = { last: null };
      const result = await enableOneClickTrading({
        wallet: ctx,
        anchorWallet,
        snapshot,
        usdcMint,
        balances: { sol: balances.sol, usdc: balances.usdc },
        onStep: (s) => { step.last = s; },
        onLog: () => {},
      });
      if (result.session) setSession(result.session);
      if (!result.ok) {
        setNote(
          result.needsUsdc
            ? "Account ready — tap your balance above to deposit USDC, then bet."
            : step.last?.error ?? "Couldn't finish enabling — check your wallet and try again.",
        );
      } else if (result.needsUsdc) {
        setNote("Tap your balance above to deposit USDC and start betting.");
      }
      void balances.refresh();
      void basket.refresh();
    } catch (e) {
      setNote(calmError(e));
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
              <button
                onClick={() => setFundsOpen(true)}
                title="Deposit / withdraw USDC"
                className="rounded-full bg-white/5 px-3 py-1.5 font-mono text-[11px] tabular-nums text-up transition-colors hover:bg-white/10"
              >
                ${(inBasketUsd ?? 0).toFixed(2)} <span className="text-faint">＋</span>
              </button>
            ) : (
              <button
                onClick={() => void enable()}
                disabled={enabling}
                className="cta-glow-up rounded-full bg-up px-3.5 py-1.5 text-[12px] font-bold text-up-deep disabled:opacity-50"
              >
                {enabling ? "enabling…" : "Enable one-tap"}
              </button>
            )}
            <button
              onClick={disconnect}
              title="Disconnect / switch wallet"
              className="font-mono text-[11px] text-dim transition-colors hover:text-down"
            >
              {shortKey(owner)}
            </button>
          </div>
        ) : (
          <button onClick={connect} className="cta-glow-up rounded-full bg-up px-4 py-2 text-[13px] font-bold text-up-deep">
            Connect
          </button>
        )}
      </header>
      {note && <p className="mx-auto max-w-[1100px] px-4 text-center font-mono text-[11px] text-warn sm:px-6">{note}</p>}
      {owner && <Bets rounds={rounds} snapshot={snapshot} now={now} onSettleNow={settleNow} />}
      <Discover
        signer={signer}
        canBet={canBet}
        availableUsd={inBasketUsd}
        onNeedWallet={onNeedWallet}
        onPlaced={(round) => {
          addRound(round);
          void basket.refresh();
        }}
      />
      {pickerOpen && <WalletPicker onClose={() => setPickerOpen(false)} />}
      <FundsSheet
        open={fundsOpen}
        busy={fundsBusy}
        walletUsdc={balances.usdc}
        inBasketUsd={inBasketUsd}
        step={fundsStep}
        executePending={executePending}
        onDeposit={doDeposit}
        onWithdraw={doWithdraw}
        onExecuteWithdraw={doExecuteWithdraw}
        onClose={() => { setFundsOpen(false); setFundsStep(null); }}
      />
    </main>
  );
}
