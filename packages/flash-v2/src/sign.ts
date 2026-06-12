// ─────────────────────────────────────────────────────────────────────────────
// sign.ts — sign the API's PARTIALLY-SIGNED transactions and submit them.
// THE HARD PART: the backend already signed any ephemeral signers and chose
// the blockhash for the RIGHT chain (ER for trades, base for setup/withdraw).
// You only fill the owner/payer slot. NEVER replace the blockhash — it would
// invalidate the server's signatures. And submit to the chain the builder
// targeted: trading → network.erRpc, setup/withdrawal → network.baseRpc.
// GOTCHAS.md → "Partially-signed txs" · "Two-chain mental model"
// ─────────────────────────────────────────────────────────────────────────────

import {
  Connection,
  Keypair,
  VersionedTransaction,
} from "@solana/web3.js";

/** Anything that can sign a VersionedTransaction (wallet-adapter compatible). */
export interface TransactionSigner {
  signTransaction(tx: VersionedTransaction): Promise<VersionedTransaction>;
}

/** Decode the API's base64 into a VersionedTransaction (signatures intact). */
export function decodeTransaction(transactionBase64: string): VersionedTransaction {
  const raw = typeof Buffer !== "undefined"
    ? Buffer.from(transactionBase64, "base64")
    : Uint8Array.from(atob(transactionBase64), (c) => c.charCodeAt(0));
  return VersionedTransaction.deserialize(raw);
}

/**
 * Sign with a local Keypair — fills ONLY this key's signature slot; the
 * server's pre-filled signatures are preserved. (Demo wallets, bots, scripts.)
 */
export function signWithKeypair(transactionBase64: string, keypair: Keypair): VersionedTransaction {
  const tx = decodeTransaction(transactionBase64);
  tx.sign([keypair]); // web3.js writes only the matching signer slot
  return tx;
}

/** Sign with a wallet-adapter style signer (browser wallets). */
export async function signWithWallet(
  transactionBase64: string,
  signer: TransactionSigner,
): Promise<VersionedTransaction> {
  return signer.signTransaction(decodeTransaction(transactionBase64));
}

export interface SendResult {
  signature: string;
  /** Wall-clock milliseconds from submit to confirmed — the latency-HUD number.
   *  Includes YOUR network distance to the endpoint (twice: send + status). */
  confirmMs: number;
  /** The send call's measured round-trip ≈ one wire trip. Rollup execution
   *  ≈ max(0, confirmMs − 2×sendMs) — split them in UIs; never bill the
   *  chain for the user's geography. */
  sendMs?: number;
}

/**
 * Submit a signed tx and wait for confirmation by polling signature status.
 * Pass the RIGHT rpc: `network.erRpc` for trades, `network.baseRpc` for
 * setup/withdrawal. (We poll instead of confirmTransaction so the same code
 * path works against both the ER and the base chain.)
 *
 * @example Tap-trade hot path (ER):
 * ```ts
 * const built = await flash.openPosition({ ...template, owner });
 * const tx = signWithKeypair(built.transactionBase64!, demoKeypair);
 * const { signature, confirmMs } = await sendAndConfirm(flash.network.erRpc, tx);
 * console.log(`confirmed on the ER in ${confirmMs}ms`, signature);
 * ```
 */
export async function sendAndConfirm(
  rpcUrl: string,
  tx: VersionedTransaction,
  opts: { timeoutMs?: number; skipPreflight?: boolean } = {},
): Promise<SendResult> {
  const { timeoutMs = 60_000, skipPreflight = false } = opts;
  const connection = new Connection(rpcUrl, "confirmed");
  const started = Date.now();

  const sendStarted = Date.now();
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight,
    maxRetries: 3,
  });
  // One measured wire round-trip — lets UIs split "your network" from
  // "rollup execution" instead of billing the chain for the user's geography.
  const sendMs = Date.now() - sendStarted;

  // Poll until confirmed/finalized — works identically on ER and base chain.
  // ADAPTIVE CADENCE: the ER confirms in tens of ms, so a flat 200ms poll
  // quantizes every measurement to its own boundary (a 50ms fill reads as
  // 200+). Sprint at 50ms for the first ~300ms (catches real ER fills at
  // their true latency), then settle to 150ms for base-chain confirmations.
  let polls = 0;
  for (;;) {
    const status = (await connection.getSignatureStatuses([signature])).value[0];
    if (status) {
      if (status.err) {
        throw new Error(`on-chain error (${signature}): ${JSON.stringify(status.err)}`);
      }
      const level = status.confirmationStatus;
      if (level === "confirmed" || level === "finalized") {
        return { signature, confirmMs: Date.now() - started, sendMs };
      }
    }
    if (Date.now() - started > timeoutMs) {
      throw new Error(`confirmation timeout after ${timeoutMs}ms (sent ${signature})`);
    }
    polls += 1;
    await new Promise((r) => setTimeout(r, polls <= 10 ? 30 : 150));
  }
}

/** One-liner for scripts and bots: keypair-sign, submit, confirm, time it. */
export async function signAndSend(
  rpcUrl: string,
  transactionBase64: string,
  keypair: Keypair,
  opts?: { timeoutMs?: number; skipPreflight?: boolean },
): Promise<SendResult> {
  return sendAndConfirm(rpcUrl, signWithKeypair(transactionBase64, keypair), opts);
}
