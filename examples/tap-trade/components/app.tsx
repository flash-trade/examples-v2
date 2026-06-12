// ─────────────────────────────────────────────────────────────────────────────
// components/app.tsx — the orchestrator: one viewport-locked screen — chart
// behind everything, floating chrome, the action-zone state machine, sheets.
// THE HARD PART: routing — trading txs sign with the SESSION key to the ER,
// setup runs once through lib/enable.ts on the base chain, TP/SL must be
// validated client-side against the LIVE mark or they die on-chain (6057).
// GOTCHAS.md → "Three error channels" · "Two chains, one flow" (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { ConnectionProvider, WalletProvider, useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { FlashV2Error, type TradeType } from "flash-v2";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ActionZone, { type Busy, type LastFill, type ZoneState } from "@/components/action-zone";
import EnableSheet from "@/components/enable-sheet";
import FundsSheet from "@/components/funds-sheet";
import HistorySheet from "@/components/history-sheet";
import LatencySheet from "@/components/latency-sheet";
import MarketDrawer from "@/components/market-drawer";
import PositionChip, { PositionSheet, type PendingTrade } from "@/components/position-chip";
import PriceChart from "@/components/price-chart";
import Sheet from "@/components/sheet";
import TopBar, { WalletSheet } from "@/components/top-bar";
import TradeTerminal from "@/components/trade-terminal";
import { DEFAULT_TEMPLATE, leverageOf, type TradeTemplate } from "@/components/trade-sheet";
import { enableOneClickTrading, type EnableState } from "@/lib/enable";
import { COLLATERAL, flash, MARKETS, PRICE_POLL_MS } from "@/lib/flash";
import { computePositionView, fmtUsd, num } from "@/lib/format";
import { positionsFor, useBalances, useBasketBalance, useLatencyLog, useMarketLimits, useMarkets, useOwner, usePrice, useUsdcMint } from "@/lib/hooks";
import { loadSession, type LoadedSession } from "@/lib/session";
import { makeSessionSigner, type ActiveSigner } from "@/lib/signer";
import { usePriceHistory } from "@/lib/use-price-history";

function errMsg(e: unknown): string {
  const raw = e instanceof FlashV2Error ? e.message : e instanceof Error ? e.message : String(e);
  // Surface a human sentence instead of raw JSON-RPC (error toasts must say what
  // happened AND that funds are safe).
  if (/Failed to fetch|502 Bad Gateway/i.test(raw)) {
    return "can't reach the RPC right now — nothing was submitted; funds untouched. Check your RPC URL and retry.";
  }
  if (/429|Too Many Requests/i.test(raw)) {
    return "the RPC is rate-limiting — use your own free Helius/Triton RPC (NEXT_PUBLIC_BASE_RPC in .env.local), then retry.";
  }
  return raw;
}


export default function App() {
  // Adapters are SSR-safe; autoConnect restores the last wallet silently.
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={flash.network.baseRpc}>
      <WalletProvider wallets={wallets} autoConnect>
        <AppInner />
      </WalletProvider>
    </ConnectionProvider>
  );
}

// ── live entry-fee preview: quote-mode openPosition (no owner), debounced ─────

function useFeePreview(sizeUsd: string, leverage: number, market: string): string | null {
  const [fee, setFee] = useState<string | null>(null);
  useEffect(() => {
    setFee(null);
    const size = Number(sizeUsd);
    if (!Number.isFinite(size) || size <= 0) return;
    if (!Number.isFinite(leverage) || leverage <= 0) return; // no phantom-lev fee
    let dead = false;
    const timer = setTimeout(() => {
      flash
        .openPosition({
          inputTokenSymbol: COLLATERAL,
          outputTokenSymbol: market,
          inputAmountUi: String(size),
          leverage,
          tradeType: "LONG",
          orderType: "MARKET",
          // no `owner` → preview-only quote, no transaction built
        })
        .then((q) => {
          if (!dead) setFee(q.entryFee);
        })
        .catch(() => {
          if (!dead) setFee(null); // badge shows "—" until a quote lands
        });
    }, 400);
    return () => {
      dead = true;
      clearTimeout(timer);
    };
  }, [sizeUsd, leverage, market]);
  return fee;
}

// ── the app ───────────────────────────────────────────────────────────────────

type SheetId = "wallet" | "enable" | "latency" | "position" | "market" | "funds" | "history" | null;

function AppInner() {
  // identity: the connected wallet owns the basket; the session key signs taps
  const walletCtx = useWallet();
  const anchorWallet = useAnchorWallet();
  const walletPk = walletCtx.publicKey?.toBase58() ?? null;
  const [session, setSession] = useState<LoadedSession | null>(null);
  useEffect(() => {
    setSession(walletPk ? loadSession(walletPk) : null);
  }, [walletPk]);

  const signer: ActiveSigner | null = useMemo(() => {
    if (!anchorWallet || !session) return null;
    if (session.authority !== anchorWallet.publicKey.toBase58()) return null;
    return makeSessionSigner(anchorWallet, session, flash.network);
  }, [anchorWallet, session]);

  // active market (pair selector) — must come before usePrice.
  // The list is LIVE from Flash's config; MARKETS is only the pre-load fallback.
  const [market, setMarket] = useState<string>(MARKETS[0] ?? "SOL");
  const liveMarkets = useMarkets();
  const markets = liveMarkets ?? MARKETS;
  useEffect(() => {
    // Config refresh removed the active market (or fallback diverged) → snap
    // to the first real one.
    if (liveMarkets && liveMarkets.length > 0 && !liveMarkets.includes(market)) {
      setMarket(liveMarkets[0]!);
    }
  }, [liveMarkets, market]);

  // live data
  const { snapshot, loaded, status, refresh } = useOwner(walletPk);
  const usdcMint = useUsdcMint();
  const balances = useBalances(walletPk, usdcMint);
  const { price } = usePrice(market, PRICE_POLL_MS);
  // resetKey=market wipes the buffer on switch — no cross-market deformed lines
  const history = usePriceHistory(price, market);
  const { entries, add: addLog } = useLatencyLog();
  // LIVE leverage bounds for the active market (custody config — never hardcoded)
  const limits = useMarketLimits(market);

  // trade state
  const [template, setTemplate] = useState<TradeTemplate>(DEFAULT_TEMPLATE);
  const [busy, setBusy] = useState<Busy>(null);
  const [pending, setPending] = useState<PendingTrade | null>(null);
  const [lastFill, setLastFill] = useState<LastFill | null>(null);
  const [lastClose, setLastClose] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetId>(null);
  // bumping this forces the trade terminal to expand in place (un-armed taps route here)
  const [terminalSignal, setTerminalSignal] = useState(0);

  // enable flow state
  const [enabling, setEnabling] = useState(false);
  const [enableState, setEnableState] = useState<EnableState | null>(null);

  const feeUsd = useFeePreview(template.sizeUsd, leverageOf(template), market);
  const positions = positionsFor(snapshot, market);
  const basketExists = Boolean(snapshot?.basketPubkey);

  // account balances — deposited = the on-chain deposit LEDGER (ER-first,
  // keyed by OWNER so it works pre-delegation) + margin in use ACROSS markets
  const { bal: basketBal, refresh: refreshBasket } = useBasketBalance(walletPk, snapshot?.basketPubkey ?? null, usdcMint);
  const marginInUseUsd = Object.values(snapshot?.positionMetrics ?? {}).reduce(
    (s, p) => s + (num(p.collateralUsdUi) ?? 0),
    0,
  );

  // Balances change only on an ON-CHAIN change, which lands as a fresh `basket`
  // frame (new basketData — metrics frames don't touch it). Refresh both then:
  // this covers trades / deposits / withdrawals with no per-action wiring, so the
  // top-bar numbers move the instant the change settles instead of on a poll tick.
  const basketData = snapshot?.basketData ?? null;
  useEffect(() => {
    if (!basketData) return;
    void balances.refresh();
    void refreshBasket();
  }, [basketData, balances.refresh, refreshBasket]);

  // wallet switch → drop ALL optimistic state from the previous identity,
  // including the anti-flap hold (a quick disconnect→reconnect inside its
  // grace window replayed the old position — live bug report).
  useEffect(() => {
    setPending(null);
    setError(null);
    setLastFill(null);
    setLastClose(null);
    setEnableState(null);
  }, [walletPk]);

  // Reconcile optimistic state against the stream: clear "pending" only when a
  // snapshot/metrics frame actually shows the change (or after a timeout).
  useEffect(() => {
    if (!pending) return;
    if (pending.kind === "open" && positions.some((p) => p.sideUi.toUpperCase() === pending.side)) {
      setPending(null);
    } else if (pending.kind === "close" && positions.length === 0) {
      setPending(null);
    }
  }, [pending, positions]);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), 45_000);
    return () => clearTimeout(t);
  }, [pending]);

  // ── tap handlers (session key signs → ER; popup-free) ──────────────────────
  const tapOpen = useCallback(
    async (side: TradeType) => {
      if (!signer || busy) return;
      setError(null);
      setBusy(side === "LONG" ? "long" : "short");
      setPending({ kind: "open", side, at: Date.now() });
      const lev = leverageOf(template);
      try {
        const quote = await flash.openPosition({
          inputTokenSymbol: COLLATERAL,
          outputTokenSymbol: market,
          inputAmountUi: template.sizeUsd || "11",
          leverage: lev,
          tradeType: side,
          orderType: "MARKET",
          owner: signer.owner,
          slippagePercentage: template.slippage || "0.5",
          ...signer.tradeFields,
        });
        if (!quote.transactionBase64) throw new Error("API returned a quote but no transaction");
        const { signature, confirmMs, sendMs } = await signer.sendTrade(quote.transactionBase64);
        addLog({
          action: `${side} ${lev}×`,
          chain: "er", ms: confirmMs, signature, ...(sendMs !== undefined ? { sendMs } : {}),
          trade: { market, side, entryUi: price?.priceUi ?? null, collateralUi: Number(template.sizeUsd) || null, pnlUi: null },
        });
        setLastFill({ side, at: Date.now() }); // confirm flash on the tapped button
      } catch (e) {
        setPending(null);
        setError(errMsg(e));
      } finally {
        setBusy(null);
      }
    },
    [signer, busy, template, market, price, addLog],
  );

  const closeSide = useCallback(
    async (side: TradeType, label: string) => {
      if (!signer) return;
      const close = await flash.closePosition({
        marketSymbol: market,
        side,
        inputUsdUi: "0", // 0 = FULL close (≥97% of size is silently full too)
        withdrawTokenSymbol: COLLATERAL,
        owner: signer.owner,
        slippagePercentage: template.slippage || "0.5",
        ...signer.tradeFields,
      });
      if (!close.transactionBase64) throw new Error("close-position returned no transaction");
      const closingPos = positions.find((p) => p.sideUi.toUpperCase() === side) ?? null;
      const { signature, confirmMs, sendMs } = await signer.sendTrade(close.transactionBase64);
      addLog({
        action: `${label} ${side}`,
        chain: "er", ms: confirmMs, signature, ...(sendMs !== undefined ? { sendMs } : {}),
        trade: closingPos
          ? {
              market: closingPos.marketSymbol,
              side,
              entryUi: num(closingPos.entryPriceUi),
              collateralUi: num(closingPos.collateralUsdUi),
              pnlUi: computePositionView(closingPos, price?.priceUi ?? null)?.pnlUsd ?? null,
            }
          : { market, side, entryUi: null, collateralUi: null, pnlUi: null },
      });
      setLastClose(Date.now()); // confirm flash on the CLOSE button
    },
    [signer, template.slippage, market, positions, price, addLog],
  );

  const tapFlatten = useCallback(async () => {
    if (!signer || busy || positions.length === 0) return;
    setError(null);
    setBusy("flatten");
    setPending({ kind: "close", at: Date.now() });
    try {
      for (const p of positions) {
        await closeSide(p.sideUi.toUpperCase() === "LONG" ? "LONG" : "SHORT", "CLOSE");
      }
    } catch (e) {
      setPending(null);
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }, [signer, busy, positions, closeSide]);

  const tapCloseOne = useCallback(
    async (side: TradeType) => {
      if (!signer || busy) return;
      setError(null);
      setBusy("close-one");
      setPending({ kind: "close", at: Date.now() });
      try {
        await closeSide(side, "CLOSE");
      } catch (e) {
        setPending(null);
        setError(errMsg(e));
      } finally {
        setBusy(null);
      }
    },
    [signer, busy, closeSide],
  );

  const tapReverse = useCallback(
    async (side: TradeType) => {
      if (!signer || busy) return;
      setError(null);
      setBusy("reverse");
      const newSide: TradeType = side === "LONG" ? "SHORT" : "LONG";
      setPending({ kind: "open", side: newSide, at: Date.now() });
      try {
        const posNow = positions.find((p) => p.sideUi.toUpperCase() === side) ?? null;
        const inherited = posNow ? computePositionView(posNow, price?.priceUi ?? null)?.leverage : undefined;
        const built = await flash.reversePosition({
          marketSymbol: market,
          side, // CURRENT side; the chain opens the opposite (with a 2% haircut)
          // template if the user set one, else the POSITION's real leverage
          leverage: leverageOf(template) || Math.round((inherited ?? 5) * 10) / 10,
          owner: signer.owner,
          slippagePercentage: template.slippage || "0.5",
          ...signer.tradeFields,
        });
        if (!built.transactionBase64) throw new Error("reverse-position returned no transaction");
        const { signature, confirmMs } = await signer.sendTrade(built.transactionBase64);
        addLog({
          action: `REVERSE → ${newSide}`,
          chain: "er", ms: confirmMs, signature,
          trade: { market, side: newSide, entryUi: price?.priceUi ?? null, collateralUi: null, pnlUi: null },
        });
        setLastFill({ side: newSide, at: Date.now() });
      } catch (e) {
        setPending(null);
        setError(errMsg(e));
      } finally {
        setBusy(null);
      }
    },
    [signer, busy, template, market, addLog],
  );

  // ── Enable One-Click Trading (lib/enable.ts) ────────────────────────────────
  const runEnable = useCallback(async () => {
    if (enabling) return;
    const pk = walletCtx.publicKey;
    const signTransaction = walletCtx.signTransaction;
    if (!pk || !anchorWallet || !signTransaction) {
      setSheet("wallet");
      return;
    }
    setEnabling(true);
    setSheet("enable");
    try {
      const res = await enableOneClickTrading({
        wallet: { publicKey: pk, signTransaction, signAllTransactions: walletCtx.signAllTransactions },
        anchorWallet,
        snapshot,
        usdcMint,
        balances: { sol: balances.sol, usdc: balances.usdc },
        onStep: setEnableState,
        onLog: addLog,
      });
      if (res.session) setSession(res.session);
      await refresh();
      void balances.refresh();
    } catch (e) {
      // enableOneClickTrading reports through onStep; this is the last net.
      setError(errMsg(e));
    } finally {
      setEnabling(false);
    }
  }, [enabling, walletCtx, anchorWallet, snapshot, usdcMint, balances, addLog, refresh]);


  // Positions reflect live ER state directly — no optimistic hold/suppression.

  // ── derived UI state ────────────────────────────────────────────────────────
  const connected = Boolean(walletPk);
  const markUi = price?.priceUi ?? null;
  const totalPnl = positions.length
    ? positions.reduce(
        (sum, p) => sum + (computePositionView(p, markUi)?.pnlUsd ?? 0),
        0,
      )
    : null;
  const firstSide: TradeType = positions[0]?.sideUi.toUpperCase() === "SHORT" ? "SHORT" : "LONG";

  const zone: ZoneState = !connected
    ? { kind: "connect" }
    : enabling
      ? { kind: "enabling", headline: enableState?.headline ?? "starting…" }
      : !loaded
        ? { kind: "loading" }
        : !(basketExists && signer)
          ? { kind: "enable" }
          : positions.length > 0
            ? { kind: "position", pnlUsd: totalPnl, side: firstSide }
            : pending?.kind === "open"
              // INSTANT feedback: the tap flips the zone to CLOSE immediately
              // (pnl "—" until the stream confirms; reconcile/timeout effects
              // already clear a fill that never lands — safe optimism).
              ? { kind: "position", pnlUsd: null, side: pending.side }
              : basketBal !== null && basketBal.inBasketUsd < 0.01
                ? { kind: "deposit" } // enabled + flat + nothing deposited — fund it
                : { kind: "pair" };

  // ── the open position, drawn ON the chart: entry line + PnL-colored band ──
  const chartPos = positions[0] ?? null;
  const chartEntry = chartPos ? (num(chartPos.entryPriceUi) ?? null) : null;
  const chartSign: 1 | -1 | 0 = chartPos
    ? (computePositionView(chartPos, markUi)?.pnlUsd ?? 0) >= 0
      ? 1
      : -1
    : 0;

  // Trade params are armed only after the user explicitly set BOTH in the
  // trade sheet — until then the SHORT/LONG pair routes taps to the sheet.
  // Leverage must also sit inside the LIVE per-market bounds (custody config).
  const levNum = Number(template.leverage) || 0;
  const paramsSet =
    (Number(template.sizeUsd) || 0) > 0 &&
    levNum > 0 &&
    (limits === null || (levNum >= limits.minLeverage && levNum <= limits.maxLeverage));

  // ── tap with the keyboard: ↑ = LONG, ↓ = SHORT (this IS a tap-trading app).
  // Guards: pair armed + visible, no sheet open, not typing in a field, no
  // key-repeat (holding ↑ must not machine-gun real orders).
  const keyCtx = useRef({ zoneKind: zone.kind, paramsSet, sheetOpen: sheet !== null });
  keyCtx.current = { zoneKind: zone.kind, paramsSet, sheetOpen: sheet !== null };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (e.repeat) return;
      const ctx = keyCtx.current;
      if (ctx.sheetOpen) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      // position open: ↓ closes it (↑ is inert — no accidental reverses)
      if (ctx.zoneKind === "position") {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          void tapFlatten();
        }
        return;
      }
      if (ctx.zoneKind !== "pair" || !ctx.paramsSet) return;
      e.preventDefault();
      void tapOpen(e.key === "ArrowUp" ? "LONG" : "SHORT");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tapOpen, tapFlatten]);

  const priceText = price
    ? `$${price.priceUi.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null;
  const live = walletPk ? status === "open" : price !== null;
  const liveLabel = walletPk
    ? ({ open: "live", polling: "polling", connecting: "connecting", reconnecting: "reconnecting", closed: "offline" } as const)[status]
    : price
      ? "live"
      : "connecting";
  const lastErMs = entries.find((e) => e.chain === "er")?.ms ?? null;

  return (
    <div className="relative grid min-h-[100dvh] grid-rows-[auto_1fr_auto] overflow-hidden">
      {/* Reviewer fix: while ANY sheet is open, the whole background becomes
          inert — otherwise keyboard focus can tab out of the dialog onto the
          visually-blocked SHORT/LONG/Enable buttons. display:contents keeps
          the grid layout; the sheets live OUTSIDE this boundary. */}
      <div inert={sheet !== null} className="contents">
      {/* the chart IS the screen — full-bleed behind all chrome */}
      <main className="absolute inset-0" aria-label={`live ${market} price chart`}>
        {/* key=market → full remount on switch: fresh lerp ref, no cross-scale sweep */}
        <PriceChart key={market} points={history} entryPrice={chartEntry} pnlSign={chartSign} />
      </main>

      <TopBar
        priceText={priceText}
        market={market}
        live={live}
        liveLabel={liveLabel}
        lastErMs={lastErMs}
        walletUsdc={balances.usdc}
        inBasketUsd={basketBal?.inBasketUsd ?? null}
        marginInUseUsd={marginInUseUsd}
        onOpenLatency={() => setSheet("latency")}
        onOpenWallet={() => setSheet("wallet")}
        onOpenMarket={() => setSheet("market")}
        onOpenFunds={() => setSheet("funds")}
        onOpenHistory={() => setSheet("history")}
      />

      <div aria-hidden />

      <ActionZone
        zone={zone}
        busy={busy}
        priceText={priceText}
        sizeUsd={template.sizeUsd}
        leverage={template.leverage}
        lastFill={lastFill}
        lastClose={lastClose}
        needsSetup={!paramsSet}
        onConfigure={() => setTerminalSignal((n) => n + 1)}
        onConnect={() => setSheet("wallet")}
        onEnable={() => void runEnable()}
        onShowEnable={() => setSheet("enable")}
        onDeposit={() => setSheet("funds")}
        onShort={() => void tapOpen("SHORT")}
        onLong={() => void tapOpen("LONG")}
        onCloseAll={() => void tapFlatten()}
        onReverse={() => void tapReverse(firstSide)}
      />

      {/* floating layers */}
      {/* the trade terminal: greets you expanded, grows/shrinks in place */}
      <TradeTerminal
        template={template}
        onTemplate={setTemplate}
        feeUsd={feeUsd}
        limits={limits}
        erUsd={basketBal?.inBasketUsd ?? null}
        market={market}
        openSignal={terminalSignal}
      />
      <PositionChip positions={positions} pending={pending} markUi={markUi} onOpen={() => setSheet("position")} />
      {error && (
        <button
          onClick={() => setError(null)}
          className="absolute inset-x-3 bottom-[108px] z-20 rounded-md border border-short/40 bg-panel px-4 py-3 text-left transition-transform active:scale-[0.99]"
        >
          <span className="break-all font-mono text-[11px] leading-relaxed text-short">{error}</span>
          <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.1em] text-faint">dismiss</span>
        </button>
      )}
      </div>

      {/* sheets */}
      <WalletSheet open={sheet === "wallet"} onClose={() => setSheet(null)} />
      <EnableSheet
        open={sheet === "enable"}
        onClose={() => setSheet(null)}
        state={enableState}
        enabling={enabling}
        address={walletPk}
        walletSol={balances.sol}
        onRetry={() => void runEnable()}
        onOpenFunds={() => setSheet("funds")}
      />
      {/* CONSENT RULE: the only place funds move — user amount, user approval */}
      <FundsSheet
        open={sheet === "funds"}
        onClose={() => setSheet(null)}
        walletCtx={
          walletCtx.publicKey && walletCtx.signTransaction
            ? {
                publicKey: walletCtx.publicKey,
                signTransaction: walletCtx.signTransaction,
                signAllTransactions: walletCtx.signAllTransactions,
              }
            : null
        }
        usdcMint={usdcMint}
        walletUsdc={balances.usdc}
        walletSol={balances.sol}
        inBasketUsd={basketBal?.inBasketUsd ?? null}
        rollupAssets={basketBal?.assets ?? null}
        onLog={addLog}
        onMoved={() => {
          void refresh();
          void balances.refresh();
        }}
      />
      <LatencySheet open={sheet === "latency"} onClose={() => setSheet(null)} entries={entries} />
      {/* TEACHABLE: history = a render of the latency log (one data source) */}
      <HistorySheet open={sheet === "history"} onClose={() => setSheet(null)} entries={entries} />
      <PositionSheet
        open={sheet === "position"}
        onClose={() => setSheet(null)}
        positions={positions}
        busy={busy !== null}
        markUi={markUi}
        onCloseOne={(side) => void tapCloseOne(side)}
        onReverse={(side) => void tapReverse(side)}
      />
      {/* Market selector — LEFT side drawer (owner spec) */}
      <MarketDrawer
        open={sheet === "market"}
        onClose={() => setSheet(null)}
        active={market}
        markets={markets}
        onSelect={(m) => {
          setMarket(m);
          setSheet(null);
        }}
      />
    </div>
  );
}
