# AGENTS.md — instructions for coding agents

You are working in a **TypeScript starter for Flash Trade V2** — perpetual futures on a MagicBlock Ephemeral Rollup, consumed **exclusively through a hosted REST API** (there is no public V2 SDK; do not look for one or add chain-SDK dependencies to the base package).

## Commands

```bash
bun install                 # workspace install (bun ≥ 1.1; runs TS natively)
bun run hello               # first success: live price + quote (no wallet)
bun run lifecycle           # full account walkthrough — DRY RUN by default
bun run typecheck           # all workspaces (tsc --noEmit)
bun run tap-trade           # the hero example (Next.js dev server)
```

There is no test suite yet; **`bun run typecheck` is the gate** — keep it green.
`lifecycle --submit` sends REAL mainnet transactions and needs `KEYPAIR_PATH`; never run it unless the user explicitly asks.

## Map (where to edit what)

| You want to… | Edit |
|---|---|
| call a V2 endpoint | `packages/flash-v2/src/client.ts` (35 REST methods; the WS path lives in `owner-stream.ts`; types in `types.ts`) |
| sign/submit a built tx | `packages/flash-v2/src/sign.ts` — trading→`network.erRpc`, setup/withdraw→`network.baseRpc` |
| add a safety check | `packages/flash-v2/src/guards.ts` |
| consume live positions | `packages/flash-v2/src/owner-stream.ts` (`subscribeOwner`) |
| change networks | `packages/flash-v2/src/network.ts` + `.env` (`FLASH_V2_BASE_URL`) |
| build a new example | copy `examples/_template`, depend on `"flash-v2": "workspace:*"` |
| understand a failure | `GOTCHAS.md` — 18 documented sharp edges with fixes |

Full API reference: `openapi.v2.json` (vendored) · live Swagger at https://flashapi.trade/docs.

## Conventions (match them)

- **bun + TypeScript strict.** ESM, `.ts` import specifiers, `moduleResolution: Bundler`.
- Every source file opens with a **6-line `// ───` banner**: what it shows · the hard part · GOTCHAS pointer. Keep that pattern in new files.
- Public client methods carry **TSDoc with `@example`** and name the submit chain (`→ network.erRpc`).
- All amounts/prices are **UI decimal strings** ("11.5") at the API boundary.
- The API field `youRecieveUsdUi` is misspelled **on purpose** (matches the backend) — never "fix" it.
- Errors: throw/propagate `FlashV2Error`; never swallow `err`-in-200 bodies.
- Examples are self-contained: own README (7 fixed sections — copy tap-trade's), own `.env.example`, `dev`/`build`/`typecheck` scripts, **mainnet defaults that work with zero edits**.

## Domain rules the chain enforces (the API won't warn you)

1. Account order: init-basket → init-deposit-ledger → delegate-basket → deposit → trade → withdraw.
2. **≥ $11** collateral or TP/SL/limit placement fails after fees.
3. LONG: limit < mark, TP > mark, SL < mark (SHORT mirrored) — else on-chain error 6057. Use `validateTriggerPrice()`.
4. Close ≥ 97% of size = FULL close (different instruction) — `isFullClose()`.
5. Session keys are created **client-side** (gum-sdk / gpl_session `Keysp…`), then passed as `signer` + `sessionToken`.

## Safety rails

- **Mainnet — real funds.** Never commit `.env`, keypairs, or RPC tokens.
- Transactions from the API are **partially signed — never replace the blockhash**.
- This repo must stay free of secrets; CI greps for them and fails the build.

## One-shot: "set up a trading app" (everything you need, in order)

You are probably here because someone said "build me a tap-trading app on
Flash V2". The complete known-good recipe:

1. **Network = mainnet.** Flash V2 is live on Solana mainnet
   (`https://flashapi.trade/v2`). Real funds — default position sizes small.
2. **Env (`examples/tap-trade/.env.local`, gitignored):** copy
   `.env.example`, then set your own CORS-friendly RPC (a free helius.dev /
   triton.one key) as `NEXT_PUBLIC_BASE_RPC`; it ships in the browser bundle,
   so use a domain-restricted key. The ER RPC is called directly (it serves
   CORS).
3. **Two chains, one flow:** account setup + deposits/withdrawals sign to the
   BASE chain; trades sign with the session key to the EPHEMERAL ROLLUP
   (`https://flash.magicblock.xyz`). Builder txs arrive partially signed
   — NEVER replace their blockhashes.
4. **The consent rule (non-negotiable for production):** onboarding/"Enable"
   flows do account setup ONLY. User funds move exclusively through explicit
   deposit/withdraw actions with a user-typed amount and a dedicated wallet
   approval (`examples/tap-trade/lib/funds.ts`, GOTCHAS §19). Never bundle a
   transfer into a convenience flow; never display an unlabeled balance.
5. **Markets are dynamic:** `GET /v2/tokens` is Flash's live config (every
   non-stable token is a market — SOL, BTC, ETH, ZEC, HYPE, equities…). Read
   it at runtime; never hardcode the list.
6. **Withdraw is two steps:** `request-withdrawal` → `execute-withdrawal`
   (execute re-runs alone as recovery). Both base chain, both owner-signed.
7. **Session keys:** gum `session_token_v2`, 24h default, stored client-side;
   top-up 0.01 SOL covers the session account's rent; revoke returns it.
   Session ≠ deposit authority — deposits always need the owner wallet.
8. **Known failure modes you should map to calm UX:** RPC 429 → "add a free
   RPC key"; RPC errors → check your RPC URL/key; `blockhash expired` →
   rebuild and re-approve.
9. **Balances: read the deposit LEDGER from the ER.** "In basket" =
   `UserDepositLedger` via ER-RPC `getProgramAccounts` (discriminator
   `9bYPoR9mRKo`, owner memcmp @16; layout in GOTCHAS §20). The basket's
   `debits`/`pendingCredits` are accounting lines, never a balance — and
   delegated V2 state is INVISIBLE to base-chain account scans, so query the
   ER first and fall back to base only pre-delegation.
10. **Display math = Flash parity, computed client-side.** Render
   `computePositionView` (lib/format.ts): mark-price PnL incl. fees, lev =
   size/collateral, liq ≈ entry×(1 ∓ coll/size×0.92). NEVER render the
   indexer's pnlWithFee/leverageUi/liquidationPriceUi directly (GOTCHAS
   §22). Token art is vendored at examples/tap-trade/public/token-icons (Flash's real set);
   latency displays must split network vs rollup (GOTCHAS §24).
