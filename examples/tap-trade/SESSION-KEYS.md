# Session keys on Flash V2 (MagicBlock) — the real flow

Session keys power **Enable One-Click Trading**: ONE wallet approval, then every
tap auto-signs. This file documents exactly what happens, because the single
most confusing fact is:

> **There is NO server endpoint that creates a session.** The Flash V2 API only
> *accepts* `signer` + `sessionToken` on trading requests. Minting the session
> is entirely client-side, against the gum session-keys program.

PDA derivation below was checked byte-for-byte against live on-chain
`SessionTokenV2` accounts.

## The pieces

| Thing | Value |
| --- | --- |
| Session-keys program ("Keysp") | `KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5` |
| Target program (magic-trade, mainnet) | `FTv2RxXarPfNta45HTTMVaGvjzsGg27FXJ3hEKWBhrzV` |
| SDK | `@magicblock-labs/gum-sdk` v3 — `SessionTokenManager` (a thin Anchor 0.30 wrapper around the gpl_session IDL) |
| Account | `SessionTokenV2 { authority, target_program, session_signer, fee_payer, valid_until }` (144 bytes) |
| PDA seeds (v2!) | `["session_token_v2", target_program, session_signer, authority]` under the Keysp program |

> ⚠ The **v1** instruction (`create_session`) uses seed `"session_token"`. The
> **v2** instruction this app uses (`create_session_v2`) uses
> `"session_token_v2"`. Derive with the wrong seed and the API/program will
> never find your token.

## The flow (implemented in [`lib/session.ts`](./lib/session.ts) + [`lib/enable.ts`](./lib/enable.ts))

1. **Connect** — `@solana/wallet-adapter-react` with the Phantom + Solflare
   adapters. The wallet is the session **authority** (and the basket **owner**).
2. **Build the session tx** — `buildSessionTransaction` generates an ephemeral
   `Keypair`, derives the PDA, sets blockhash + fee payer, and partial-signs
   with the ephemeral key. Note what it does NOT do: ask the wallet for a
   signature — that happens once, for the whole Enable bundle:

```ts
import { BN } from "@coral-xyz/anchor";
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import { Keypair, PublicKey } from "@solana/web3.js";

const KEYSP = new PublicKey("KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5");
const MAGIC_TRADE = new PublicKey("FTv2RxXarPfNta45HTTMVaGvjzsGg27FXJ3hEKWBhrzV");

const sessionSigner = Keypair.generate();
const validUntil = Math.floor(Date.now() / 1000) + 24 * 3600;     // 24h
const [sessionToken] = PublicKey.findProgramAddressSync(
  [
    new TextEncoder().encode("session_token_v2"),                 // _v2 !
    MAGIC_TRADE.toBytes(),
    sessionSigner.publicKey.toBytes(),
    wallet.publicKey.toBytes(),
  ],
  KEYSP,
);

const manager = new SessionTokenManager(wallet, connection);      // baseRpc connection
const tx = await manager.program.methods
  .createSessionV2(true, new BN(validUntil), new BN(0.01 * 1e9))  // topUp 0.01 SOL
  .accountsPartial({
    sessionToken,
    sessionSigner: sessionSigner.publicKey,
    feePayer: wallet.publicKey,        // pays rent + the top-up
    authority: wallet.publicKey,       // the real wallet
    targetProgram: MAGIC_TRADE,
  })
  .transaction();

tx.feePayer = wallet.publicKey;
tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
tx.partialSign(sessionSigner);                  // ephemeral key co-signs
```

   `topUp = true` transfers `lamports` from the wallet to the session signer to
   cover the session account's rent (recoverable on revoke); ER trades
   themselves are gasless. This lands on the **base chain** (the Keysp program
   lives on mainnet L1).

3. **ONE approval for everything** — `lib/enable.ts` puts this tx FIRST in the
   `wallet.signAllTransactions([sessionTx, initBasket, initLedger, delegate])`
   bundle (deposits are a separate explicit step) (sequential `signTransaction` fallback when a wallet lacks
   `signAllTransactions`), then submits in lifecycle order with confirmation.
   The session is **persisted to localStorage (`tap-trade-session`) only after
   its tx confirms** — so a later step failing still leaves you with a working
   session. It is a *capability scoped to one program with an expiry*, which is
   what makes hot-storing it workable. Real risk is real: an XSS could trade
   your basket until expiry. Keep sessions short, revoke when done, size
   deposits to that risk.

4. **Trade with zero popups** — every trading request gains two fields, and the
   ephemeral key signs instead of the wallet:

```ts
const built = await flash.openPosition({
  inputTokenSymbol: "USDC", outputTokenSymbol: "SOL",
  inputAmountUi: "25", leverage: 5, tradeType: "LONG", orderType: "MARKET",
  owner: wallet.publicKey.toBase58(),            // basket owner = the wallet
  signer: sessionSigner.publicKey.toBase58(),    // session signer
  sessionToken: sessionToken.toBase58(),         // SessionTokenV2 PDA
});
await signAndSend(flash.network.erRpc, built.transactionBase64!, sessionSigner);
//                              ^^^^^ trades go to the ER, as always
```

   The API builds the tx with the session signer as fee payer/signer, the
   program validates the token (authority, target program, expiry) on-chain.

5. **End it** — `revoke_session_v2` refunds rent + leftover top-up to the
   `fee_payer`. It requires **no wallet signature** — the session key itself
   can pay the fee (`revokeSession` in lib/session.ts). Otherwise the token
   simply dies at `valid_until`; the app drops stored sessions with <60 s left
   and the action zone falls back to **Enable One-Click Trading**.

## Gotchas we hit so you don't

- **Wrong seed = invisible session.** `"session_token_v2"`, not
  `"session_token"`, for `create_session_v2` (see the table above).
- **The session signer needs lamports.** Forget `topUp` and the session account
  has no rent deposit. 0.01 SOL is plenty for a demo, and it's recoverable on
  revoke.
- **`owner` stays the wallet.** `signer`/`sessionToken` change *who signs*, not
  *whose basket trades*. Setup (init/delegate/deposit) is still wallet-signed —
  session keys only remove the per-trade popups.
- **Expiry is client-checked too.** The app drops stored sessions with <60 s
  left so you never sign a trade the program will reject.
- **Don't sign the session tx early.** In the one-approval bundle the session
  tx must reach `signAllTransactions` with ONLY the ephemeral partial-signature
  attached; the wallet adds the authority/fee-payer signature with the rest.
