// ─────────────────────────────────────────────────────────────────────────────
// lib/flash.ts — one FlashV2Client + one base-chain Connection for the app.
// THE HARD PART: V2 spans TWO chains — trading txs go to network.erRpc, setup
// txs to network.baseRpc. Flash V2 is MAINNET — real funds.
// GOTCHAS.md → "Two chains, one flow" (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────

import { Connection } from "@solana/web3.js";
import { FlashV2Client, type NetworkConfig } from "flash-v2";

/** NEXT_PUBLIC_ env overrides, applied only when actually set (a key whose
 *  value is `undefined` would otherwise stomp the preset in the spread). */
function overridesFromEnv(): Partial<NetworkConfig> {
  const cfg: Partial<NetworkConfig> = {};
  if (process.env.NEXT_PUBLIC_FLASH_API_BASE) cfg.apiBase = process.env.NEXT_PUBLIC_FLASH_API_BASE;
  if (process.env.NEXT_PUBLIC_ER_RPC) cfg.erRpc = process.env.NEXT_PUBLIC_ER_RPC;
  if (process.env.NEXT_PUBLIC_BASE_RPC) cfg.baseRpc = process.env.NEXT_PUBLIC_BASE_RPC;
  return cfg;
}

/** The one client. Reads, quotes, and every transaction builder. */
export const flash = new FlashV2Client(overridesFromEnv());


/** Base-chain connection — airdrops, balances, setup-tx submission.
 *  disableRetryOnRateLimit: the public RPC rate-limits; one attempt, one
 *  clean failure — the app owns retry UX. */
export const baseConnection = new Connection(flash.network.baseRpc, {
  commitment: "confirmed",
  disableRetryOnRateLimit: true,
});

/** All tradeable markets (first is the default). */
export const MARKETS = ["SOL", "BTC", "ETH"];
/** Kept for backward compat — equals MARKETS[0]. */
export const MARKET = MARKETS[0] as string;
export const COLLATERAL = "USDC";

/** Price poll cadence — 1s keeps the chart line + slot-reel digits alive. */
export const PRICE_POLL_MS = 1000;

/** Static, clearly-labeled comparison baseline for the latency HUD. */
export const SOLANA_L1_TYPICAL_MS = 400;

/** Explorer link for a signature — cluster param matches the active network. */
export function explorerTx(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}`;
}
