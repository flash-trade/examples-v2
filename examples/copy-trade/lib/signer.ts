// ─────────────────────────────────────────────────────────────────────────────
// lib/signer.ts — the trading signer: the SESSION keypair signs every tap.
// THE HARD PART: routing — trading txs sign+submit to network.erRpc and NEVER
// touch the blockhash (the API pre-signed it). Setup txs are handled by
// lib/enable.ts on the base chain behind ONE wallet approval.
// GOTCHAS.md → "Two chains, one flow" (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────

import { signAndSend, type NetworkConfig, type SendResult } from "flash-v2";
import type { LoadedSession, SessionWallet } from "./session";

/** Everything a tap needs to know about "who signs and where it goes". */
export interface ActiveSigner {
  /** Basket owner (base58) — the connected wallet. */
  owner: string;
  /** Sign + submit a TRADING tx → Ephemeral Rollup. Popup-free. */
  sendTrade(transactionBase64: string): Promise<SendResult>;
  /** Extra request fields so the API builds for the session signer. */
  tradeFields: { signer: string; sessionToken: string };
}

/**
 * One-Click Trading signer: the wallet approved setup ONCE (lib/enable.ts);
 * every TRADE auto-signs with the ephemeral session key — `signer` +
 * `sessionToken` ride along in the request so the API builds for it.
 */
export function makeSessionSigner(
  wallet: SessionWallet,
  session: LoadedSession,
  network: NetworkConfig,
): ActiveSigner {
  return {
    owner: wallet.publicKey.toBase58(),
    sendTrade: (tx64) => signAndSend(network.erRpc, tx64, session.keypair, { skipPreflight: true }),
    tradeFields: {
      signer: session.keypair.publicKey.toBase58(),
      sessionToken: session.token,
    },
  };
}
