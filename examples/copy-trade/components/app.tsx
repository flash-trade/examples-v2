// ─────────────────────────────────────────────────────────────────────────────
// components/app.tsx — the copy-trade orchestrator, Liquid Glass.
// Flow: connect wallet → Enable One-Click Trading (account + session key) →
// pick a leader off the ranked board (or paste one) → their live book streams
// in → mirror their opens/closes onto YOUR account (manual one-tap by default,
// capped auto opt-in). The follower signs every mirror with their own session
// key; the app never holds keys and never moves funds outside an explicit trade.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { ConnectionProvider, WalletProvider, useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { type PositionMetrics } from "flash-v2";
import { useCallback, useEffect, useMemo, useState } from "react";
import { flash, explorerTx } from "@/lib/flash";
import { computePositionView, fmtUsd, shortKey } from "@/lib/format";
import { useBalances, useBasketBalance, useOwner, useUsdcMint } from "@/lib/hooks";
import { loadSession, type LoadedSession } from "@/lib/session";
import { makeSessionSigner } from "@/lib/signer";
import { enableOneClickTrading, type EnableState } from "@/lib/enable";
import { useLeaderboard, isLikelyPubkey, type LeaderRow } from "@/lib/leaders";
import { useCopyEngine, type CopyConfig } from "@/lib/copy-engine";

// ── providers ────────────────────────────────────────────────────────────────
export default function App() {
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={flash.network.baseRpc}>
      <WalletProvider wallets={wallets} autoConnect>
        <AppInner />
      </WalletProvider>
    </ConnectionProvider>
  );
}

// ── live prices (for honest mark-price PnL on both books) ──────────────────────
function usePrices(pollMs = 2000): Record<string, number> {
  const [prices, setPrices] = useState<Record<string, number>>({});
  useEffect(() => {
    let dead = false;
    const tick = async () => {
      try {
        const all = await flash.prices();
        if (dead) return;
        const out: Record<string, number> = {};
        for (const [sym, p] of Object.entries(all)) out[sym] = Number(p.priceUi);
        setPrices(out);
      } catch { /* keep last */ }
    };
    void tick();
    const t = setInterval(tick, pollMs);
    return () => { dead = true; clearInterval(t); };
  }, [pollMs]);
  return prices;
}

function AppInner() {
  const { publicKey, connected } = useWallet();
  const walletCtx = useWallet();
  const anchorWallet = useAnchorWallet();
  const owner = publicKey?.toBase58() ?? null;

  const usdcMint = useUsdcMint();
  const { snapshot, loaded } = useOwner(owner);
  const balances = useBalances(owner, usdcMint);
  const { bal: basketBal, refresh: refreshBasket } = useBasketBalance(owner, snapshot?.basketPubkey ?? null, usdcMint);
  const prices = usePrices();

  const basketExists = Boolean(snapshot?.basketPubkey);
  const inBasketUsd = basketBal?.inBasketUsd ?? 0;
  // follower collateral the engine sizes against: deposited (free) + already at work
  const marginInUse = Object.values(snapshot?.positionMetrics ?? {}).reduce((s, p) => s + (Number(p.collateralUsdUi) || 0), 0);
  const followerCollateralUsd = inBasketUsd + marginInUse;

  // session signer (popup-free mirror signing) — present once Enabled
  const [session, setSession] = useState<LoadedSession | null>(null);
  useEffect(() => { setSession(owner ? loadSession(owner) : null); }, [owner]);
  const signer = useMemo(() => {
    if (!walletCtx.publicKey || !walletCtx.signTransaction || !walletCtx.signAllTransactions || !session) return null;
    const sw = { publicKey: walletCtx.publicKey, signTransaction: walletCtx.signTransaction, signAllTransactions: walletCtx.signAllTransactions };
    return makeSessionSigner(sw, session, flash.network);
  }, [walletCtx.publicKey, walletCtx.signTransaction, walletCtx.signAllTransactions, session]);

  // ── leader selection ────────────────────────────────────────────────────────
  const board = useLeaderboard();
  const [leader, setLeader] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const leaderRow = useMemo(() => board.leaders.find((l) => l.owner === leader) ?? null, [board.leaders, leader]);

  // ── copy config ──────────────────────────────────────────────────────────────
  const [cfg, setCfg] = useState<CopyConfig>({ mode: "manual", armed: false, budgetUsd: 50, maxPerTradeUsd: 15 });
  const setC = (p: Partial<CopyConfig>) => setCfg((c) => ({ ...c, ...p }));

  const engine = useCopyEngine({ leader, signer, followerCollateralUsd, config: cfg });

  // ── enable (account setup + session key) ─────────────────────────────────────
  const [enabling, setEnabling] = useState(false);
  const [enableState, setEnableState] = useState<EnableState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const runEnable = useCallback(async () => {
    if (enabling || !walletCtx.publicKey || !anchorWallet || !walletCtx.signTransaction) return;
    setEnabling(true); setErr(null);
    try {
      const res = await enableOneClickTrading({
        wallet: { publicKey: walletCtx.publicKey, signTransaction: walletCtx.signTransaction, signAllTransactions: walletCtx.signAllTransactions },
        anchorWallet, snapshot, usdcMint,
        balances: { sol: balances.sol, usdc: balances.usdc },
        onStep: setEnableState, onLog: () => {},
      });
      if (res.session) setSession(res.session);
      void balances.refresh(); void refreshBasket();
    } catch (e) { setErr((e as Error).message); }
    finally { setEnabling(false); }
  }, [enabling, walletCtx, anchorWallet, snapshot, usdcMint, balances, refreshBasket]);

  const followerPositions = Object.values(snapshot?.positionMetrics ?? {});
  const ready = basketExists && Boolean(signer);

  return (
    <main className="relative z-[1] mx-auto flex min-h-[100dvh] max-w-[1280px] flex-col gap-4 px-4 py-4 sm:px-6">
      <Header
        connected={connected}
        address={owner}
        inBasketUsd={basketExists ? inBasketUsd : null}
        onConnect={() => walletCtx.select?.(walletCtx.wallets[0]?.adapter.name ?? null)}
        streamStatus={leader ? engine.status : null}
      />

      {!leader ? (
        <Discover
          board={board}
          paste={paste}
          setPaste={setPaste}
          onFollow={(o) => { setLeader(o); setPaste(""); }}
          prices={prices}
        />
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[1.05fr_1fr]">
          <LeaderPanel
            leader={leader}
            row={leaderRow}
            positions={engine.leaderPositions}
            prices={prices}
            status={engine.status}
            onUnfollow={() => setLeader(null)}
          />
          <Console
            ready={ready}
            connected={connected}
            inBasketUsd={inBasketUsd}
            loaded={loaded}
            enabling={enabling}
            enableState={enableState}
            err={err}
            onEnable={runEnable}
            cfg={cfg}
            setC={setC}
            engine={engine}
            followerPositions={followerPositions}
            prices={prices}
          />
        </div>
      )}
      <p className="px-1 text-center text-[10px] leading-relaxed text-faint">
        Flash V2 mainnet · real funds. Copy trading carries the leader&apos;s risk — start small, watch the spread, keep your budget what you can lose.
      </p>
    </main>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Header
// ════════════════════════════════════════════════════════════════════════════
function Header({ connected, address, inBasketUsd, onConnect, streamStatus }: {
  connected: boolean; address: string | null; inBasketUsd: number | null; onConnect: () => void; streamStatus: string | null;
}) {
  return (
    <header className="glass spec flex items-center justify-between rounded-[20px] px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-accent/15 text-accent">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13l0-8Z" /></svg>
        </span>
        <div className="leading-none">
          <p className="font-display text-[15px] font-bold tracking-tight text-ink">Copy Trade</p>
          <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-faint">Flash V2 · ephemeral rollup</p>
        </div>
        {streamStatus && (
          <span className="ml-2 flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 font-mono text-[10px] text-dim">
            <span className={`h-1.5 w-1.5 rounded-full ${streamStatus === "live" ? "bg-long soft-pulse" : "bg-gold"}`} />
            {streamStatus}
          </span>
        )}
      </div>
      {connected ? (
        <div className="glass-2 spec flex items-center gap-3 rounded-full px-3.5 py-1.5">
          {inBasketUsd !== null && (
            <span className="font-mono text-xs tabular-nums text-long">{fmtUsd(inBasketUsd)}</span>
          )}
          <span className="font-mono text-[11px] text-dim">{address ? shortKey(address) : ""}</span>
        </div>
      ) : (
        <button onClick={onConnect} className="press mag glass-2 spec halo-long flex items-center gap-2 rounded-full py-2 pl-4 pr-2 text-[13px] font-semibold text-ink">
          Connect
          <span className="disc grid h-7 w-7 place-items-center rounded-full bg-long/20 text-long">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </span>
        </button>
      )}
    </header>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Discover — the leaderboard + paste-a-leader
// ════════════════════════════════════════════════════════════════════════════
function Discover({ board, paste, setPaste, onFollow, prices }: {
  board: ReturnType<typeof useLeaderboard>; paste: string; setPaste: (s: string) => void; onFollow: (o: string) => void; prices: Record<string, number>;
}) {
  void prices;
  return (
    <section className="glass-in flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-1 px-1 pt-2">
        <span className="w-max rounded-full bg-white/5 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-gold">leaderboard · live ER</span>
        <h1 className="font-display text-[28px] font-bold leading-tight tracking-tight text-ink sm:text-[34px]">Follow the proven.</h1>
        <p className="max-w-xl text-sm leading-relaxed text-dim">Real Flash V2 traders, ranked by net PnL and win rate on the rollup. Pick one — or paste any wallet — and mirror their moves onto your account.</p>
      </div>

      <div className="bezel">
        <label className="bezel-r glass spec flex items-center gap-2 px-4 py-2.5">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-faint" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.2-3.2" /></svg>
          <input
            value={paste}
            onChange={(e) => setPaste(e.target.value.trim())}
            placeholder="paste a leader wallet address to follow…"
            className="w-full bg-transparent font-mono text-[13px] text-ink outline-none placeholder:text-faint"
          />
          {isLikelyPubkey(paste) && (
            <button onClick={() => onFollow(paste)} className="press shrink-0 rounded-full bg-long px-4 py-1.5 text-[12px] font-bold text-bg">Follow</button>
          )}
        </label>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {board.loading && board.leaders.length === 0 && (
          Array.from({ length: 6 }).map((_, i) => <div key={i} className="glass h-[88px] rounded-[18px] soft-pulse" />)
        )}
        {board.error && board.leaders.length === 0 && (
          <div className="glass halo-short col-span-full rounded-[18px] px-4 py-3 text-sm text-short">Couldn&apos;t load the leaderboard: {board.error}</div>
        )}
        {board.leaders.slice(0, 12).map((l) => (
          <LeaderCard key={l.owner} l={l} live={(board.openByOwner[l.owner] ?? 0) > 0} openCount={board.openByOwner[l.owner] ?? 0} onFollow={() => onFollow(l.owner)} />
        ))}
      </div>
    </section>
  );
}

function LeaderCard({ l, live, openCount, onFollow }: { l: LeaderRow; live: boolean; openCount: number; onFollow: () => void }) {
  const win = l.win_rate;
  return (
    <button onClick={onFollow} className="lift press glass spec group rounded-[18px] p-3.5 text-left">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <span className={`grid h-9 w-9 place-items-center rounded-[11px] font-display text-sm font-bold ${l.rank <= 3 ? "bg-gold/15 text-gold" : "bg-white/5 text-dim"}`}>#{l.rank}</span>
          <div className="leading-tight">
            <p className="font-mono text-[13px] text-ink">{shortKey(l.owner)}</p>
            <p className="mt-0.5 font-mono text-[10px] text-faint">{l.num_trades} trades · {fmtUsd(l.total_volume_usd)} vol</p>
          </div>
        </div>
        {live && <span className="flex items-center gap-1 rounded-full bg-long/12 px-2 py-0.5 font-mono text-[9px] text-long"><span className="h-1.5 w-1.5 rounded-full bg-long soft-pulse" />{openCount} live</span>}
      </div>
      <div className="mt-3 flex items-end justify-between">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-faint">net pnl</p>
          <p className={`font-display text-[19px] font-bold tabular-nums ${l.net_pnl >= 0 ? "text-long" : "text-short"}`}>{l.net_pnl >= 0 ? "+" : ""}{fmtUsd(l.net_pnl)}</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-faint">win rate</p>
          <p className="font-display text-[19px] font-bold tabular-nums text-ink">{win.toFixed(0)}<span className="text-xs text-dim">%</span></p>
        </div>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full bg-gradient-to-r from-long/60 to-long" style={{ width: `${Math.min(100, win)}%` }} />
      </div>
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// LeaderPanel — the followed leader's live book
// ════════════════════════════════════════════════════════════════════════════
function LeaderPanel({ leader, row, positions, prices, status, onUnfollow }: {
  leader: string; row: LeaderRow | null; positions: PositionMetrics[]; prices: Record<string, number>; status: string; onUnfollow: () => void;
}) {
  return (
    <section className="glass-in glass spec flex flex-col gap-3 rounded-[22px] p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className={`grid h-9 w-9 place-items-center rounded-[11px] font-display text-sm font-bold ${row && row.rank <= 3 ? "bg-gold/15 text-gold" : "bg-white/5 text-dim"}`}>{row ? `#${row.rank}` : "•"}</span>
          <div className="leading-tight">
            <p className="font-mono text-[13px] text-ink">{shortKey(leader)}</p>
            <p className="mt-0.5 font-mono text-[10px] text-faint">{row ? `${row.win_rate.toFixed(0)}% win · ${row.num_trades} trades` : "following"}</p>
          </div>
        </div>
        <button onClick={onUnfollow} className="press rounded-full bg-white/5 px-3 py-1.5 font-mono text-[11px] text-dim hover:text-ink">unfollow</button>
      </div>

      <div className="flex items-center gap-2 px-0.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">leader&apos;s book</span>
        <span className="h-px flex-1 bg-white/8" />
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-dim"><span className={`h-1.5 w-1.5 rounded-full ${status === "live" ? "bg-long soft-pulse" : "bg-gold"}`} />{positions.length} open</span>
      </div>

      <div className="flex flex-col gap-2">
        {positions.length === 0 && (
          <div className="glass-flat rounded-[14px] px-4 py-6 text-center text-sm text-faint">{status === "live" ? "leader is flat — waiting for their next move…" : "connecting to the leader stream…"}</div>
        )}
        {positions.map((p) => <PositionRow key={`${p.marketSymbol}-${p.sideUi}`} p={p} mark={prices[p.marketSymbol] ?? null} />)}
      </div>
    </section>
  );
}

function PositionRow({ p, mark }: { p: PositionMetrics; mark: number | null }) {
  const view = computePositionView(p, mark);
  const long = p.sideUi.toUpperCase() === "LONG";
  return (
    <div className="glass-flat row-in flex items-center justify-between rounded-[14px] px-3.5 py-2.5">
      <div className="flex items-center gap-2.5">
        <span className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold ${long ? "bg-long/14 text-long" : "bg-short/14 text-short"}`}>{long ? "LONG" : "SHORT"}</span>
        <div className="leading-tight">
          <p className="font-display text-[13px] font-semibold text-ink">{p.marketSymbol}</p>
          <p className="font-mono text-[10px] text-faint">{fmtUsd(p.sizeUsdUi)} · {Number(p.leverageUi || 0).toFixed(1)}× · entry {Number(p.entryPriceUi).toLocaleString()}</p>
        </div>
      </div>
      <div className="text-right">
        <p className={`font-mono text-[13px] font-semibold tabular-nums ${(view?.pnlUsd ?? 0) >= 0 ? "text-long" : "text-short"}`}>{view ? `${view.pnlUsd >= 0 ? "+" : ""}${fmtUsd(view.pnlUsd)}` : "—"}</p>
        <p className="font-mono text-[10px] text-faint">{view ? `${view.pnlPct >= 0 ? "+" : ""}${view.pnlPct.toFixed(1)}%` : ""}</p>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Console — your status, controls, pending mirrors, fills, your book
// ════════════════════════════════════════════════════════════════════════════
function Console({ ready, connected, inBasketUsd, loaded, enabling, enableState, err, onEnable, cfg, setC, engine, followerPositions, prices }: {
  ready: boolean; connected: boolean; inBasketUsd: number; loaded: boolean;
  enabling: boolean; enableState: EnableState | null; err: string | null; onEnable: () => void;
  cfg: CopyConfig; setC: (p: Partial<CopyConfig>) => void; engine: ReturnType<typeof useCopyEngine>;
  followerPositions: PositionMetrics[]; prices: Record<string, number>;
}) {
  // gate: connect → enable → fund → copy
  if (!connected) return <GateCard title="Connect to copy" body="Connect a wallet to mirror this leader onto your own Flash V2 account." />;
  if (!loaded) return <GateCard title="Reading your account…" body="Checking whether your basket is set up." pulse />;
  if (!ready) return (
    <GateCard
      title="Enable One-Click Trading"
      body="One approval sets up your basket + a session key so every mirror auto-signs — no popups, no custody. The only transfer is ~0.01 SOL of recoverable session rent."
      action={{ label: enabling ? (enableState?.headline ?? "setting up…") : "Enable", onClick: onEnable, busy: enabling }}
      error={err}
    />
  );
  if (inBasketUsd < 1) return (
    <GateCard title="Deposit to size your copies" body="Your account is set up and empty. Deposit USDC — the engine sizes each mirror by your collateral ÷ the leader's, so it needs a balance to copy against." />
  );

  return (
    <section className="glass-in flex flex-col gap-3">
      <Controls cfg={cfg} setC={setC} spent={engine.spentUsd} inBasketUsd={inBasketUsd} />
      <Pending engine={engine} />
      <Fills engine={engine} />
      <YourBook positions={followerPositions} prices={prices} />
    </section>
  );
}

function GateCard({ title, body, action, error, pulse }: { title: string; body: string; action?: { label: string; onClick: () => void; busy?: boolean }; error?: string | null; pulse?: boolean }) {
  return (
    <section className="glass-in glass spec flex flex-col gap-3 rounded-[22px] p-5">
      <p className={`font-display text-[16px] font-bold text-ink ${pulse ? "soft-pulse" : ""}`}>{title}</p>
      <p className="text-sm leading-relaxed text-dim">{body}</p>
      {error && <p className="rounded-[10px] bg-short/8 px-3 py-2 text-xs text-short">{error}</p>}
      {action && (
        <button onClick={action.onClick} disabled={action.busy} className="press mag cta-mint mt-1 flex items-center justify-between rounded-full py-2.5 pl-5 pr-2 text-[14px] font-bold disabled:opacity-70">
          {action.label}
          <span className="disc grid h-8 w-8 place-items-center rounded-full bg-black/15"><svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
        </button>
      )}
    </section>
  );
}

function Controls({ cfg, setC, spent, inBasketUsd }: { cfg: CopyConfig; setC: (p: Partial<CopyConfig>) => void; spent: number; inBasketUsd: number }) {
  const auto = cfg.mode === "auto";
  return (
    <div className="glass spec rounded-[20px] p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-display text-[15px] font-bold text-ink">Copy controls</p>
          <p className="mt-0.5 font-mono text-[10px] text-faint">balance {fmtUsd(inBasketUsd)} · spent {fmtUsd(spent)} / {fmtUsd(cfg.budgetUsd)}</p>
        </div>
        {/* mode toggle */}
        <div className="flex rounded-full bg-white/5 p-0.5 text-[11px] font-semibold">
          <button onClick={() => setC({ mode: "manual", armed: false })} className={`rounded-full px-3 py-1.5 transition-colors ${!auto ? "bg-white/10 text-ink" : "text-faint"}`}>manual</button>
          <button onClick={() => setC({ mode: "auto" })} className={`rounded-full px-3 py-1.5 transition-colors ${auto ? "bg-white/10 text-ink" : "text-faint"}`}>auto</button>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <NumField label="budget (USD)" value={cfg.budgetUsd} onChange={(v) => setC({ budgetUsd: v })} />
        <NumField label="max / trade (USD)" value={cfg.maxPerTradeUsd} onChange={(v) => setC({ maxPerTradeUsd: v })} />
      </div>

      {auto && (
        <button
          onClick={() => setC({ armed: !cfg.armed })}
          className={`press mt-3 flex w-full items-center justify-center gap-2 rounded-full py-2.5 text-[13px] font-bold ${cfg.armed ? "glass-2 halo-short text-short shimmer" : "glass-2 halo-long text-long"}`}
        >
          {cfg.armed
            ? <><span className="h-2 w-2 rounded-full bg-short" /> ARMED — auto-copying · tap to kill</>
            : <><span className="h-2 w-2 rounded-full bg-long" /> Arm auto-copy</>}
        </button>
      )}
      {auto && cfg.armed && (
        <p className="mt-2 text-center font-mono text-[10px] leading-relaxed text-faint">mirrors execute automatically within your caps while this tab stays open. Keep the budget what you can lose.</p>
      )}
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="glass-flat flex items-center justify-between rounded-[12px] px-3 py-2">
      <span className="text-[11px] text-dim">{label}</span>
      <input
        value={String(value)}
        onChange={(e) => onChange(Number(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
        inputMode="decimal"
        className="w-16 bg-transparent text-right font-mono text-sm tabular-nums text-ink outline-none"
      />
    </label>
  );
}

function Pending({ engine }: { engine: ReturnType<typeof useCopyEngine> }) {
  if (engine.pending.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {engine.pending.map(({ event, sized }) => {
        const opening = event.kind === "OPEN" || event.kind === "GROW";
        const long = event.side === "LONG";
        return (
          <div key={event.id} className={`glass spec row-in rounded-[16px] p-3.5 ${long ? "halo-long" : "halo-short"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-white/8 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-dim">{event.kind}</span>
                <span className={`font-display text-[14px] font-bold ${long ? "text-long" : "text-short"}`}>{event.side} {event.market}</span>
              </div>
              <span className="font-mono text-[11px] text-faint">leader Δ{fmtUsd(event.deltaUsd)}</span>
            </div>
            <p className="mt-1.5 font-mono text-[11px] text-dim">
              {opening
                ? `mirror ${fmtUsd(sized.collateralUsd ?? 0)} × ${event.leverage.toFixed(1)}× = ${fmtUsd(sized.sizeUsd)}`
                : event.kind === "CLOSE" ? "close your matching position" : `trim ${fmtUsd(sized.sizeUsd)}`}
              <span className="text-faint"> · ratio {sized.ratio.toFixed(2)}</span>
            </p>
            <div className="mt-2.5 flex gap-2">
              <button onClick={() => engine.confirm(event.id)} className="press flex-1 rounded-full bg-long py-2 text-[12px] font-bold text-bg">Mirror</button>
              <button onClick={() => engine.dismiss(event.id)} className="press rounded-full bg-white/6 px-4 py-2 text-[12px] font-semibold text-dim">Skip</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Fills({ engine }: { engine: ReturnType<typeof useCopyEngine> }) {
  if (engine.fills.length === 0) return null;
  return (
    <div className="glass spec rounded-[18px] p-3.5">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-faint">mirror log</p>
      <div className="flex max-h-[230px] flex-col gap-1.5 overflow-y-auto">
        {engine.fills.map((f) => (
          <div key={f.id} className="row-in flex items-center justify-between gap-2 py-0.5">
            <div className="flex min-w-0 items-center gap-2">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${f.status === "done" ? "bg-long" : f.status === "error" ? "bg-short" : f.status === "skipped" ? "bg-faint" : "bg-gold soft-pulse"}`} />
              <span className="truncate font-mono text-[11px] text-dim">
                <span className="text-ink">{f.event.kind} {f.event.side} {f.event.market}</span>
                {f.status === "skipped" && <span className="text-faint"> — {f.note}</span>}
                {f.status === "error" && <span className="text-short"> — {f.note}</span>}
              </span>
            </div>
            {f.signature
              ? <a href={explorerTx(f.signature)} target="_blank" rel="noreferrer" className="shrink-0 font-mono text-[10px] tabular-nums text-dim underline-offset-2 hover:text-ink hover:underline">{f.confirmMs}ms · {shortKey(f.signature)}</a>
              : <span className="shrink-0 font-mono text-[10px] text-faint">{f.status}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function YourBook({ positions, prices }: { positions: PositionMetrics[]; prices: Record<string, number> }) {
  return (
    <div className="glass spec rounded-[18px] p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">your mirror</span>
        <span className="h-px flex-1 bg-white/8" />
        <span className="font-mono text-[10px] text-dim">{positions.length} open</span>
      </div>
      {positions.length === 0
        ? <p className="px-1 py-3 text-center text-xs text-faint">no mirrored positions yet</p>
        : <div className="flex flex-col gap-2">{positions.map((p) => <PositionRow key={`${p.marketSymbol}-${p.sideUi}`} p={p} mark={prices[p.marketSymbol] ?? null} />)}</div>}
    </div>
  );
}
