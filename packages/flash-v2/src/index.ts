// ─────────────────────────────────────────────────────────────────────────────
// flash-v2 — thin, typed client for Flash Trade V2 (MagicBlock Ephemeral
// Rollups). REST-only by design: the hosted API is the only public V2 surface.
// Start at client.ts (the 36 endpoints) · sign.ts (sign+submit) · guards.ts
// (the footguns) · owner-stream.ts (live state) · lifecycle.ts (the walkthrough).
// Docs: ../../README.md · ../../GOTCHAS.md · ../../AGENTS.md
// ─────────────────────────────────────────────────────────────────────────────

export { FlashV2Client, type BuiltTransaction } from "./client.ts";
export { MAINNET, resolveNetwork, type NetworkConfig } from "./network.ts";
export { FlashV2Error, assertNoErr, type ErrorChannel } from "./errors.ts";
export {
  decodeTransaction,
  signWithKeypair,
  signWithWallet,
  sendAndConfirm,
  signAndSend,
  type SendResult,
  type TransactionSigner,
} from "./sign.ts";
export {
  MIN_COLLATERAL_USD_AFTER_FEES,
  RECOMMENDED_MIN_COLLATERAL_USD,
  FULL_CLOSE_THRESHOLD,
  checkCollateralForTriggers,
  validateTriggerPrice,
  isFullClose,
  type PriceKind,
} from "./guards.ts";
export { subscribeOwner, type OwnerStream, type OwnerStreamOptions } from "./owner-stream.ts";
export type * from "./types.ts";
