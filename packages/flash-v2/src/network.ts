// ─────────────────────────────────────────────────────────────────────────────
// network.ts — Flash V2 runs on Solana MAINNET. Real funds.
// THE HARD PART: V2 spans TWO chains. Trading txs go to the Ephemeral Rollup
// RPC; setup + withdrawal txs go to the base-chain Solana RPC. Mixing them
// fails. The config carries BOTH RPCs so you can't lose track.
// GOTCHAS.md → "Two-chain mental model"
// ─────────────────────────────────────────────────────────────────────────────

/** Everything the client needs to talk to Flash V2. */
export interface NetworkConfig {
  name: "mainnet";
  /** Hosted Flash V2 REST base, INCLUDING the /v2 suffix. */
  apiBase: string;
  /** Ephemeral Rollup RPC — submit TRADING txs here (open/close/triggers/…). */
  erRpc: string;
  /** Base-chain Solana RPC — submit SETUP + WITHDRAWAL txs here. */
  baseRpc: string;
}

export const MAINNET: NetworkConfig = {
  name: "mainnet",
  apiBase: "https://flashapi.trade/v2",
  erRpc: "https://flash.magicblock.xyz",
  baseRpc: "https://api.mainnet-beta.solana.com",
};

/**
 * Resolve the network config. Env overrides:
 * FLASH_V2_BASE_URL, ER_RPC_URL, BASE_RPC_URL (see .env.example).
 * Set BASE_RPC_URL to your own keyed RPC — the public one rate-limits.
 */
export function resolveNetwork(): NetworkConfig {
  const env = typeof process !== "undefined" ? process.env : ({} as Record<string, string | undefined>);
  return {
    ...MAINNET,
    apiBase: env.FLASH_V2_BASE_URL?.replace(/\/$/, "") ?? MAINNET.apiBase,
    erRpc: env.ER_RPC_URL ?? MAINNET.erRpc,
    baseRpc: env.BASE_RPC_URL ?? MAINNET.baseRpc,
  };
}
