// ─────────────────────────────────────────────────────────────────────────────
// lib/hooks.ts — live data: price poll, owner stream, balances, latency log.
// THE HARD PART: the owner WS sends TWO frame types (basket vs metrics) that
// flash-v2 merges for us; the HUD numbers are REAL confirmMs values only —
// nothing here invents latency. GOTCHAS.md → "The WS sends two frame types"
// · "WS connection limits are real" (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { PublicKey } from "@solana/web3.js";
import {
  subscribeOwner,
  type BasketSnapshot,
  type PositionMetrics,
  type PriceInfo,
  type TokenInfo,
} from "flash-v2";
import { useCallback, useEffect, useRef, useState } from "react";
import { baseConnection, flash } from "./flash";
import { MAGIC_TRADE_PROGRAM } from "./session";

/** The magic-trade program on the ACTIVE network (ledger reads filter on it). */
const MAGIC_TRADE_PROGRAM_ID = MAGIC_TRADE_PROGRAM.toBase58();

// ── price ticker ─────────────────────────────────────────────────────────────

export function usePrice(symbol: string, intervalMs = 1000): {
  price: PriceInfo | null;
  drift: "up" | "down" | "flat";
} {
  const [price, setPrice] = useState<PriceInfo | null>(null);
  const [drift, setDrift] = useState<"up" | "down" | "flat">("flat");
  const last = useRef<number | null>(null);

  useEffect(() => {
    // Market switch: drop the previous symbol's price immediately so the
    // history buffer never receives a stale cross-market tick.
    setPrice(null);
    setDrift("flat");
    last.current = null;
    let dead = false;
    const tick = async () => {
      try {
        const p = await flash.price(symbol);
        if (dead) return;
        if (last.current !== null && p.priceUi !== last.current) {
          setDrift(p.priceUi > last.current ? "up" : "down");
        }
        last.current = p.priceUi;
        setPrice(p);
      } catch {
        /* keep last price; next tick retries */
      }
    };
    void tick();
    const timer = setInterval(tick, intervalMs);
    return () => { dead = true; clearInterval(timer); };
  }, [symbol, intervalMs]);

  return { price, drift };
}

/**
 * The tradeable market list, LIVE from Flash's own config (`GET /tokens` —
 * CDN-driven and hot-reloaded server-side): every non-stable token in the
 * active pool is a market. New listings appear here automatically.
 * Returns null until loaded (callers keep a static fallback meanwhile).
 */
export function useMarkets(): string[] | null {
  const [markets, setMarkets] = useState<string[] | null>(null);
  useEffect(() => {
    let dead = false;
    flash.tokens()
      .then((tokens) => {
        if (dead) return;
        const symbols = tokens.filter((t) => !t.isStable).map((t) => t.symbol);
        if (symbols.length > 0) setMarkets(symbols);
      })
      .catch(() => { /* fallback list keeps the selector usable */ });
    return () => { dead = true; };
  }, []);
  return markets;
}

/** Per-market leverage limits + trade spreads, LIVE from Flash's custody config. */
export interface MarketLimits {
  /** Lowest initial leverage the program accepts (UI floor, ≥1.1 for sanity). */
  minLeverage: number;
  /** Highest initial leverage the program accepts for this market. */
  maxLeverage: number;
  /** Exit spread the engine prices longs through (0.10 = 10%). THE number
   *  that makes a fresh fill read −10% "realizable now" — show it BEFORE
   *  the tap, and name it in the PnL breakdown. FX pairs are 0%. */
  spreadLongPct: number;
  spreadShortPct: number;
}

// custody.pricing values are fixed-point with 4 decimals (110000 = 11x —
// Flash's tiers carry a ×1.1 buffer over the advertised 10x/50x/100x/500x).
const LEVERAGE_SCALE = 10_000;

type CustodyPricing = { min: number; max: number; spreadL: number; spreadS: number };

// ── one parse path, shared by the single + bulk hooks (the spread is a
// fund-critical number — it must be derived in exactly ONE place so the grid and
// the detail can never disagree). Custody + tokens are each fetched ONCE and
// deduped via in-flight promises, so N simultaneous cards trigger one of each.
const limitsCache = new Map<string, MarketLimits>();
let custodyPricing: Map<string, CustodyPricing> | null = null;
let custodyInFlight: Promise<Map<string, CustodyPricing> | null> | null = null;
let tokensPromise: Promise<TokenInfo[]> | null = null;

async function loadCustodyPricing(): Promise<Map<string, CustodyPricing> | null> {
  if (custodyPricing && custodyPricing.size > 0) return custodyPricing;
  if (custodyInFlight) return custodyInFlight;
  custodyInFlight = (async () => {
    try {
      const res = await fetch(`${flash.network.apiBase}/raw/custodies`);
      // Don't parse a non-OK response (error page / 5xx) into a partial map that
      // then sticks for the session — bail so the next call retries (review H4).
      if (!res.ok) return custodyPricing;
      const json = (await res.json()) as
        | Array<{ account?: { mint?: string; pricing?: { minInitLeverage?: number; maxInitLeverage?: number; tradeSpreadMin?: number; tradeSpreadMax?: number } } }>
        | { custodies?: unknown };
      const arr = Array.isArray(json) ? json : [];
      const map = new Map<string, CustodyPricing>();
      for (const c of arr) {
        const a = c.account;
        // the custody token field is `mint` (verified against the live API)
        if (a?.mint && a.pricing?.maxInitLeverage) {
          map.set(a.mint, {
            min: (a.pricing.minInitLeverage ?? LEVERAGE_SCALE) / LEVERAGE_SCALE,
            max: a.pricing.maxInitLeverage / LEVERAGE_SCALE,
            // tradeSpreadMin = base spread, 1e6ths (100 = 0.01%): /1_000_000 -> fraction.
            // (empirically = the small-trade fill spread; grows to tradeSpreadMax with size)
            spreadL: (a.pricing.tradeSpreadMin ?? 0) / 1_000_000,
            spreadS: (a.pricing.tradeSpreadMin ?? 0) / 1_000_000,
          });
        }
      }
      // only cache a USEFUL result — an empty map must not wedge "loading…"
      if (map.size > 0) custodyPricing = map;
      return custodyPricing;
    } catch {
      return custodyPricing; // fallback stays null; next call retries
    } finally {
      custodyInFlight = null;
    }
  })();
  return custodyInFlight;
}

function loadTokens(): Promise<TokenInfo[]> {
  return (tokensPromise ??= flash.tokens().catch((e) => ((tokensPromise = null), Promise.reject(e))));
}

/** token config → custody (by mint) → leverage bounds + per-side spreads. The
 *  SINGLE place a symbol becomes MarketLimits. Returns null when the custody
 *  isn't found (callers keep a conservative fallback / loading state meanwhile). */
function buildLimits(symbol: string, pricing: Map<string, CustodyPricing>, tokens: TokenInfo[]): MarketLimits | null {
  const mint = tokens.find((t) => t.symbol.toUpperCase() === symbol.toUpperCase())?.mint;
  const p = mint ? pricing.get(mint) : undefined;
  if (!p) return null;
  return { minLeverage: Math.max(1.1, p.min), maxLeverage: p.max, spreadLongPct: p.spreadL, spreadShortPct: p.spreadS };
}

/**
 * Live leverage bounds + spreads for ONE market symbol. Cached per session; null
 * until loaded. Same philosophy as useMarkets: Flash changes limits → the UI
 * follows, no code.
 */
export function useMarketLimits(marketSymbol: string): MarketLimits | null {
  const [limits, setLimits] = useState<MarketLimits | null>(limitsCache.get(marketSymbol) ?? null);
  useEffect(() => {
    const cached = limitsCache.get(marketSymbol);
    setLimits(cached ?? null);
    if (cached) return;
    let dead = false;
    void (async () => {
      try {
        const pricing = await loadCustodyPricing();
        if (dead || !pricing) return;
        const tokens = await loadTokens();
        if (dead) return;
        const out = buildLimits(marketSymbol, pricing, tokens);
        if (out) {
          limitsCache.set(marketSymbol, out);
          setLimits(out);
        }
      } catch { /* fallback stays; next mount retries */ }
    })();
    return () => { dead = true; };
  }, [marketSymbol]);
  return limits;
}

/**
 * Live limits for MANY symbols at once (the Discover grid). Shares the deduped
 * custody + tokens fetches and the one `buildLimits` path with useMarketLimits,
 * so a card and the detail it opens always price through the identical spread.
 * Returns a Map keyed by symbol; absent until a symbol's custody resolves.
 */
export function useAllMarketLimits(symbols: string[]): Map<string, MarketLimits> {
  const key = symbols.join(",");
  const seed = () => {
    const m = new Map<string, MarketLimits>();
    for (const s of symbols) { const c = limitsCache.get(s); if (c) m.set(s, c); }
    return m;
  };
  const [map, setMap] = useState<Map<string, MarketLimits>>(seed);
  useEffect(() => {
    let dead = false;
    void (async () => {
      try {
        const pricing = await loadCustodyPricing();
        if (dead || !pricing) return;
        const tokens = await loadTokens();
        if (dead) return;
        const next = new Map<string, MarketLimits>();
        for (const s of symbols) {
          const out = limitsCache.get(s) ?? buildLimits(s, pricing, tokens);
          if (out) { limitsCache.set(s, out); next.set(s, out); }
        }
        if (next.size > 0) setMap(next);
      } catch { /* keep last good map; next change retries */ }
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return map;
}

// ── owner snapshot stream ────────────────────────────────────────────────────

export type StreamStatus = "connecting" | "open" | "reconnecting" | "polling" | "closed";

export function useOwner(owner: string | null): {
  snapshot: BasketSnapshot | null;
  /** true once we have heard ANYTHING for this owner (fetch or frame). */
  loaded: boolean;
  status: StreamStatus;
  refresh: () => Promise<void>;
} {
  const [snapshot, setSnapshot] = useState<BasketSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<StreamStatus>("connecting");

  useEffect(() => {
    setSnapshot(null);
    setLoaded(false);
    if (!owner) { setStatus("closed"); return; }
    setStatus("connecting");
    let dead = false;

    // Spec move: fetch client.owner(pubkey) on load so the setup wizard can
    // decide instantly; the stream takes over from the first frame onward.
    flash.owner(owner)
      .then((snap) => {
        if (dead) return;
        setSnapshot((prev) => prev ?? snap);
        setLoaded(true);
      })
      .catch(() => { /* stream below retries via poll fallback */ });

    const stream = subscribeOwner({
      owner,
      network: flash.network,
      onUpdate: (snap) => {
        if (dead) return;
        setSnapshot(snap);
        setLoaded(true);
      },
      onStatus: (s) => { if (!dead) setStatus(s); },
    });
    return () => { dead = true; stream.close(); };
  }, [owner]);

  const refresh = useCallback(async () => {
    if (!owner) return;
    try {
      const snap = await flash.owner(owner);
      setSnapshot(snap);
      setLoaded(true);
    } catch { /* non-fatal */ }
  }, [owner]);

  return { snapshot, loaded, status, refresh };
}

/** All live positions for one market symbol out of a snapshot. */
export function positionsFor(snapshot: BasketSnapshot | null, marketSymbol: string): PositionMetrics[] {
  if (!snapshot) return [];
  return Object.values(snapshot.positionMetrics ?? {}).filter(
    (p) => p.marketSymbol?.toUpperCase() === marketSymbol.toUpperCase(),
  );
}

// ── wallet balances (base chain) ─────────────────────────────────────────────

export function useBalances(owner: string | null, usdcMint: string | null): {
  sol: number | null;
  usdc: number | null;
  refresh: () => Promise<void>;
} {
  const [sol, setSol] = useState<number | null>(null);
  const [usdc, setUsdc] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!owner) { setSol(null); setUsdc(null); return; }
    try {
      const lamports = await baseConnection.getBalance(new PublicKey(owner));
      setSol(lamports / 1e9);
    } catch { /* keep last */ }
    if (usdcMint) {
      try {
        const res = await baseConnection.getParsedTokenAccountsByOwner(
          new PublicKey(owner),
          { mint: new PublicKey(usdcMint) },
        );
        const total = res.value.reduce((sum, acc) => {
          const ui = acc.account.data.parsed?.info?.tokenAmount?.uiAmount as number | null | undefined;
          return sum + (typeof ui === "number" ? ui : 0);
        }, 0);
        setUsdc(total);
      } catch { /* keep last */ }
    }
  }, [owner, usdcMint]);

  useEffect(() => {
    void refresh();
    // Background safety-net poll; balance-changing actions refresh explicitly
    // for instant updates. A keyed RPC handles this cadence comfortably.
    const timer = setInterval(() => { void refresh(); }, 6_000);
    return () => clearInterval(timer);
  }, [refresh]);

  return { sol, usdc, refresh };
}

// ── deposited balance: the USER DEPOSIT LEDGER, read like Flash's own infra ──

export interface BasketAsset {
  mint: string;
  symbol: string;
  decimals: number;
  /** AVAILABLE on the rollup side (ledger − debits + pending), native units. */
  amountUi: number;
}

export interface BasketBalance {
  /** USDC available — the tradable "in basket" figure (compat alias of assets). */
  inBasketUsd: number;
  /** EVERY asset with rollup-side availability — nothing orphans invisibly. */
  assets: BasketAsset[];
  /** Where the ledger was found ("er" once delegated, "base" before). */
  source: "er" | "base";
}

// Anchor discriminator for `UserDepositLedger` = sha256("account:UserDepositLedger")[0..8]
// (hex 3363adbe15330782). Precomputed so the browser needs no crypto/bs58 deps.
const LEDGER_DISC_B58 = "9bYPoR9mRKo";
// Zero-copy layout (validated against 60 live mainnet ledgers, all 852 bytes):
// 8 disc | 1 bump | 7 pad | 32 owner @16 | u32 count @48 | 20 × {32 mint, u64 amount} @52.
const LEDGER_OWNER_OFFSET = 16;
const LEDGER_COUNT_OFFSET = 48;
const LEDGER_ENTRIES_OFFSET = 52;
const LEDGER_ENTRY_SIZE = 40;

/** All ledger entries (mint → raw u64 amount), or null when no ledger exists. */
async function fetchLedgerEntries(rpcUrl: string, owner: string): Promise<Map<string, number> | null> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "getProgramAccounts",
      params: [MAGIC_TRADE_PROGRAM_ID, {
        encoding: "base64",
        filters: [
          { memcmp: { offset: 0, bytes: LEDGER_DISC_B58 } },
          { memcmp: { offset: LEDGER_OWNER_OFFSET, bytes: owner } },
        ],
      }],
    }),
  });
  const json = (await res.json()) as { result?: Array<{ account: { data: [string, string] } }> };
  const acct = json.result?.[0];
  if (!acct) return null;
  const buf = Uint8Array.from(atob(acct.account.data[0]), (c) => c.charCodeAt(0));
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const count = view.getUint32(LEDGER_COUNT_OFFSET, true);
  const out = new Map<string, number>();
  for (let i = 0; i < Math.min(count, 20); i++) {
    const off = LEDGER_ENTRIES_OFFSET + i * LEDGER_ENTRY_SIZE;
    const mint = new PublicKey(buf.subarray(off, off + 32)).toBase58();
    const amount = Number(view.getBigUint64(off + 32, true));
    out.set(mint, (out.get(mint) ?? 0) + amount);
  }
  return out;
}



/**
 * The owner's AVAILABLE USDC (GOTCHAS §20):
 *
 *   available = ledger.deposits − basket.debits + basket.pendingCredits
 *
 * V2 is double-entry: the ledger records CUMULATIVE deposits (withdrawals do
 * NOT decrement it), the basket's debits/pendingCredits record all internal
 * churn, and only the three together net to the balance. A fully-withdrawn
 * account nets exactly $0.00; while funded, the same math gives the true
 * positive balance. All three figures MUST come from the same coherent
 * source — the ER-fed store (mixing chains on a half-delegated account breaks
 * the invariant; clamp at 0).
 */
export function useBasketBalance(
  owner: string | null,
  basketPubkey: string | null,
  usdcMint: string | null,
): { bal: BasketBalance | null; refresh: () => Promise<void> } {
  const [bal, setBal] = useState<BasketBalance | null>(null);
  const tokenMeta = useRef<Map<string, { symbol: string; decimals: number }> | null>(null);
  // Monotonic request id: a newer read (poll OR an explicit post-trade refresh)
  // supersedes an in-flight older one, so stale data never lands.
  const reqId = useRef(0);

  const refresh = useCallback(async () => {
    if (!owner || !usdcMint) { setBal(null); return; }
    const id = ++reqId.current;
    try {
      // 1) cumulative deposits — ALL mints from the ledger (ER → base fallback)
      let source: "er" | "base" = "er";
      let ledger = await fetchLedgerEntries(flash.network.erRpc, owner);
      if (ledger === null) {
        ledger = await fetchLedgerEntries(flash.network.baseRpc, owner);
        source = "base";
      }
      if (id !== reqId.current) return;
      if (ledger === null) { setBal({ inBasketUsd: 0, assets: [], source: "base" }); return; }
      // 2) the basket's counter-entries (server-decoded from the ER store)
      const debits = new Map<string, number>();
      const pending = new Map<string, number>();
      if (basketPubkey) {
        const raw = await flash.rawBasket(basketPubkey);
        if (id !== reqId.current) return;
        const acct = raw.account as {
          debits?: Array<{ mint: string; amount: number | string }>;
          pendingCredits?: Array<{ mint: string; amount: number | string }>;
        };
        for (const r of acct.debits ?? []) debits.set(r.mint, (debits.get(r.mint) ?? 0) + Number(r.amount));
        for (const r of acct.pendingCredits ?? []) pending.set(r.mint, (pending.get(r.mint) ?? 0) + Number(r.amount));
      }
      // 3) symbols/decimals from Flash's live token config (cached across reads)
      if (!tokenMeta.current) {
        try {
          tokenMeta.current = new Map(
            (await flash.tokens()).map((t) => [t.mint, { symbol: t.symbol, decimals: t.decimals }]),
          );
        } catch { tokenMeta.current = new Map(); }
      }
      if (id !== reqId.current) return;
      // 4) available per mint = ledger − debits + pending (clamped), native units
      const mints = new Set<string>([...ledger.keys(), ...debits.keys(), ...pending.keys()]);
      const assets: BasketAsset[] = [];
      for (const mint of mints) {
        const meta = tokenMeta.current.get(mint) ?? { symbol: mint.slice(0, 4) + "…", decimals: mint === usdcMint ? 6 : 9 };
        const rawAvail = (ledger.get(mint) ?? 0) - (debits.get(mint) ?? 0) + (pending.get(mint) ?? 0);
        const amountUi = Math.max(0, rawAvail) / 10 ** meta.decimals;
        if (amountUi > 0) assets.push({ mint, symbol: meta.symbol, decimals: meta.decimals, amountUi });
      }
      assets.sort((a, b) => (a.mint === usdcMint ? -1 : b.mint === usdcMint ? 1 : a.symbol.localeCompare(b.symbol)));
      const usdc = assets.find((a) => a.mint === usdcMint)?.amountUi ?? 0;
      setBal({ inBasketUsd: usdc, assets, source });
    } catch { /* keep last good read; next read retries */ }
  }, [owner, basketPubkey, usdcMint]);

  useEffect(() => {
    setBal(null);      // clear on owner/basket change — don't show another owner's balance
    reqId.current++;   // invalidate any in-flight read
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 5_000);
    return () => clearInterval(timer);
  }, [refresh]);

  return { bal, refresh };
}

/** Resolve the USDC mint once via /tokens (deposits need the MINT, not "USDC"). */
export function useUsdcMint(): string | null {
  const [mint, setMint] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    flash.tokens()
      .then((tokens) => {
        if (dead) return;
        const usdc = tokens.find((t) => t.symbol.toUpperCase() === "USDC");
        setMint(usdc?.mint ?? null);
      })
      .catch(() => { /* tokens() retried implicitly when wizard runs */ });
    return () => { dead = true; };
  }, []);
  return mint;
}

// ── latency log (the HUD's data) ─────────────────────────────────────────────

export interface LatencyEntry {
  id: string;
  /** What was tapped, e.g. "LONG 5×", "FLATTEN", "init-basket". */
  action: string;
  /** Which chain confirmed it — "er" rows are the headline numbers. */
  chain: "er" | "base";
  /** REAL wall-clock submit→confirmed milliseconds (flash-v2 confirmMs). */
  ms: number;
  /** Measured send round-trip (≈ one wire trip) — splits network vs rollup. */
  sendMs?: number;
  signature: string;
  at: number;
  /** Trade facts captured at action time (history rows render these).
   *  pnlUi = the WITH-FEE figure at the moment of close (≈ realized). */
  trade?: {
    market: string;
    side: "LONG" | "SHORT";
    entryUi: number | null;
    collateralUi: number | null;
    pnlUi: number | null;
  };
}

export function useLatencyLog(): {
  entries: LatencyEntry[];
  add: (entry: Omit<LatencyEntry, "id" | "at">) => void;
} {
  const [entries, setEntries] = useState<LatencyEntry[]>([]);
  const add = useCallback((entry: Omit<LatencyEntry, "id" | "at">) => {
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
    setEntries((prev) => [{ ...entry, id, at: Date.now() }, ...prev].slice(0, 50));
  }, []);
  return { entries, add };
}
