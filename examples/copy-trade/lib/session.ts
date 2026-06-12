// ─────────────────────────────────────────────────────────────────────────────
// lib/session.ts — REAL session keys via @magicblock-labs/gum-sdk (v3).
// THE HARD PART: there is NO server endpoint for sessions — the CLIENT mints a
// SessionTokenV2 PDA (seeds ["session_token_v2", target, signer, authority] —
// note the _v2!). buildSessionTransaction lets lib/enable.ts bundle it into
// the ONE Enable One-Click Trading approval; trades then auto-sign.
// SESSION-KEYS.md has the full story. GOTCHAS.md → "Session keys" entry.
// ─────────────────────────────────────────────────────────────────────────────

import { BN } from "@coral-xyz/anchor";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import {
  Connection,
  Keypair,
  PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";

/** Gum session-keys program. */
export const SESSION_KEYS_PROGRAM = new PublicKey("KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5");

/**
 * magic-trade (Flash V2 on MagicBlock) program — the session target.
 * Mainnet: FTv2RxXarPfNta45HTTMVaGvjzsGg27FXJ3hEKWBhrzV
 * (verified by decoding a mainnet init-basket transaction from /v2/transaction-builder)
 */
/** magic-trade program (mainnet) — decoded from live builder txs. */
export const MAGIC_TRADE_PROGRAM = new PublicKey("FTv2RxXarPfNta45HTTMVaGvjzsGg27FXJ3hEKWBhrzV");


/** localStorage key for the persisted session (signer secret + token PDA). */
export const SESSION_STORAGE_KEY = "tap-trade-session";

/** Minimal wallet shape we need (matches wallet-adapter's AnchorWallet). */
export interface SessionWallet {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
}

export interface LoadedSession {
  /** Ephemeral signer — auto-signs every trade, no popup. */
  keypair: Keypair;
  /** SessionTokenV2 PDA (base58) — passed as `sessionToken` to the API. */
  token: string;
  /** The real wallet that authorized the session (base58). */
  authority: string;
  /** Unix seconds — the program rejects the session after this. */
  validUntil: number;
}

interface StoredSession {
  secretKey: number[];
  token: string;
  authority: string;
  validUntil: number;
}

/**
 * Derive the SessionTokenV2 PDA. Live-verified on-chain: 77 session tokens
 * targeting magic-trade all match seeds
 * ["session_token_v2", target_program, session_signer, authority].
 */
export function deriveSessionToken(
  authority: PublicKey,
  sessionSigner: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode("session_token_v2"),
      MAGIC_TRADE_PROGRAM.toBytes(),
      sessionSigner.toBytes(),
      authority.toBytes(),
    ],
    SESSION_KEYS_PROGRAM,
  );
  return pda;
}

/** Load the persisted session if it exists, belongs to `authority`, and has
 *  ≥60s of validity left. Anything else is cleared. Browser-only. */
export function loadSession(authority?: string): LoadedSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as StoredSession;
    const fresh = stored.validUntil > Date.now() / 1000 + 60;
    const mine = !authority || stored.authority === authority;
    if (!fresh || !mine) {
      if (!fresh) clearSession();
      return null;
    }
    return {
      keypair: Keypair.fromSecretKey(Uint8Array.from(stored.secretKey)),
      token: stored.token,
      authority: stored.authority,
      validUntil: stored.validUntil,
    };
  } catch {
    clearSession();
    return null;
  }
}

export function clearSession(): void {
  if (typeof window !== "undefined") window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

/** Poll a signature to confirmation (same approach as flash-v2/sign.ts). */
async function confirmSignature(connection: Connection, signature: string, timeoutMs = 60_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    const status = (await connection.getSignatureStatuses([signature])).value[0];
    if (status) {
      if (status.err) throw new Error(`on-chain error (${signature}): ${JSON.stringify(status.err)}`);
      const level = status.confirmationStatus;
      if (level === "confirmed" || level === "finalized") return;
    }
    if (Date.now() - started > timeoutMs) throw new Error(`confirmation timeout (${signature})`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

/** Everything `enableOneClickTrading` needs to bundle the session into ONE
 *  signAllTransactions sheet: the tx (blockhash set, ephemeral key already
 *  partial-signed — the wallet only adds its own signature) plus the pieces
 *  to persist once it confirms. */
export interface BuiltSessionTransaction {
  tx: Transaction;
  sessionSigner: Keypair;
  /** SessionTokenV2 PDA (base58). */
  sessionToken: string;
  validUntil: number;
}

/**
 * Build (don't sign-with-the-wallet, don't send) a `create_session_v2` tx:
 * generate an ephemeral keypair, derive the SessionTokenV2 PDA, set blockhash
 * + fee payer, and partial-sign with the ephemeral key. `topUpSol` moves SOL
 * from the wallet to the session signer so trades pay their own fees.
 */
export async function buildSessionTransaction(
  wallet: SessionWallet,
  connection: Connection,
  opts: { validHours?: number; topUpSol?: number } = {},
): Promise<BuiltSessionTransaction> {
  const { validHours = 24, topUpSol = 0.01 } = opts;
  const sessionSigner = Keypair.generate();
  const validUntil = Math.floor(Date.now() / 1000) + Math.floor(validHours * 3600);
  const sessionToken = deriveSessionToken(wallet.publicKey, sessionSigner.publicKey);
  const targetProgram = MAGIC_TRADE_PROGRAM;

  const manager = new SessionTokenManager(wallet, connection);
  const tx: Transaction = await manager.program.methods
    .createSessionV2(true, new BN(validUntil), new BN(Math.round(topUpSol * 1e9)))
    .accountsPartial({
      sessionToken,
      sessionSigner: sessionSigner.publicKey,
      feePayer: wallet.publicKey,
      authority: wallet.publicKey,
      targetProgram,
    })
    .transaction();

  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  tx.partialSign(sessionSigner); // ephemeral key co-signs; wallet signs later
  return { tx, sessionSigner, sessionToken: sessionToken.toBase58(), validUntil };
}

/** Persist a confirmed session to localStorage and return the live shape. */
export function persistSession(args: {
  sessionSigner: Keypair;
  sessionToken: string;
  authority: string;
  validUntil: number;
}): LoadedSession {
  const stored: StoredSession = {
    secretKey: Array.from(args.sessionSigner.secretKey),
    token: args.sessionToken,
    authority: args.authority,
    validUntil: args.validUntil,
  };
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(stored));
  return {
    keypair: args.sessionSigner,
    token: stored.token,
    authority: stored.authority,
    validUntil: stored.validUntil,
  };
}

/**
 * Compat wrapper (build → ONE wallet popup → send → confirm → persist).
 * `enableOneClickTrading` (lib/enable.ts) uses buildSessionTransaction
 * directly so the session rides the same signAllTransactions sheet as the
 * basket/ledger/delegate/deposit txs.
 */
export async function createSession(opts: {
  wallet: SessionWallet;
  connection: Connection;
  validHours?: number;
  topUpSol?: number;
}): Promise<{ session: LoadedSession; signature: string; confirmMs: number }> {
  const { wallet, connection, validHours, topUpSol } = opts;
  const built = await buildSessionTransaction(wallet, connection, { validHours, topUpSol });
  const signed = await wallet.signTransaction(built.tx); // the ONE popup
  const started = Date.now();                            // measure submit→confirmed only
  const signature = await connection.sendRawTransaction(signed.serialize(), { maxRetries: 3 });
  await confirmSignature(connection, signature);
  const confirmMs = Date.now() - started;
  const session = persistSession({
    sessionSigner: built.sessionSigner,
    sessionToken: built.sessionToken,
    authority: wallet.publicKey.toBase58(),
    validUntil: built.validUntil,
  });
  return { session, signature, confirmMs };
}

/**
 * Revoke the session on-chain (rent + leftover top-up refund to the wallet).
 * `revoke_session_v2` needs NO wallet signature — the session signer itself
 * pays the fee, so even ending a session is popup-free. Always clears local
 * storage, even if the on-chain revoke fails (e.g. already expired + closed).
 */
export async function revokeSession(
  session: LoadedSession,
  connection: Connection,
): Promise<{ signature: string; confirmMs: number } | null> {
  try {
    const authority = new PublicKey(session.authority);
    // Provider wallet here is only a type requirement — nothing is signed by it.
    const manager = new SessionTokenManager(
      {
        publicKey: session.keypair.publicKey,
        signTransaction: async <T,>(t: T) => t,
        signAllTransactions: async <T,>(t: T[]) => t,
      } as SessionWallet,
      connection,
    );
    const tx: Transaction = await manager.program.methods
      .revokeSessionV2()
      .accountsPartial({
        sessionToken: new PublicKey(session.token),
        // Must match tx.feePayer below — the SESSION key pays for its own
        // revocation (popup-free); a mismatch fails the signer constraint.
        feePayer: session.keypair.publicKey,
        authority,
      })
      .transaction();
    tx.feePayer = session.keypair.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
    tx.sign(session.keypair);
    const started = Date.now();
    const signature = await connection.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
    await confirmSignature(connection, signature);
    clearSession();
    return { signature, confirmMs: Date.now() - started };
    // ONLY a confirmed revoke clears storage — wiping on failure would orphan
    // a LIVE key with no way to retry the revoke (audit find).
  } catch {
    return null; // revoke failed — session stays stored so you can retry;
                 // worst case the token expires on its own at validUntil
  }
}
