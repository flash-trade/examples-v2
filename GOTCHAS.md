# GOTCHAS — the sharp edges of Flash V2

Each entry below is a real sharp edge of building on Flash V2, written as **symptom → why → fix**. The fixes ship as code in [`packages/flash-v2/src/guards.ts`](./packages/flash-v2/src/guards.ts) wherever possible.

---

## 1. Three error channels

**Symptom:** your error handling works on one endpoint and silently misses failures on another.
**Why:** the API has three styles — trading/preview endpoints return **HTTP 200 with `err` in the body**; trigger/limit endpoints return **HTTP 400 with a plain-text body**; setup/withdrawal endpoints return a **bare HTTP 500 with an empty body** (the reason only exists in server logs).
**Fix:** the client normalizes all three into one `FlashV2Error` with a `channel` field. If you fetch manually, replicate that — see [`errors.ts`](./packages/flash-v2/src/errors.ts).

## 2. `err` arrives inside HTTP 200

**Symptom:** `res.ok` is true, you proceed, and there is no transaction.
**Why:** trading endpoints report failures like `"Position is empty"` or `"Swap not supported on MagicBlock"` as a 200 body with `err` set.
**Fix:** always branch on `body.err` (the client throws for you via `assertNoErr`).

## 3. The API won't stop an invalid trigger price

**Symptom:** the API happily returns `transactionBase64` for your limit/TP/SL — then the chain rejects it with custom error **6057 `InvalidLimitPrice`**.
**Why:** the backend does **zero** oracle-side validation of trigger prices; the program validates against the live mark at execution.
**Fix:** validate client-side first: **LONG → limit < mark, TP > mark, SL < mark** (SHORT is the mirror). `guards.validateTriggerPrice()` encodes it.

## 4. The 97% full-close threshold

**Symptom:** you request a "98% partial close" and your whole position disappears.
**Why:** the program treats `inputUsdUi ≥ 97% of position size` (or `"0"`) as a **FULL close** — a different on-chain instruction with different response fields (`lockAndUnsettledFeeUsd` only appears on partials).
**Fix:** `guards.isFullClose(closeUsd, sizeUsd)` tells you which instruction you'll actually get. Design close UIs around the threshold.

## 5. Two chains, one flow

**Symptom:** a perfectly built transaction fails with a blockhash/landing error.
**Why:** trading txs are built against the **Ephemeral Rollup** blockhash and must be submitted to the **ER RPC**; setup + withdrawal txs are built against the **base-chain** blockhash and must go to a **base RPC**. Mixing them fails.
**Fix:** every builder method's TSDoc names its chain; `network.erRpc` / `network.baseRpc` keep them side by side. The [lifecycle](./packages/flash-v2/src/lifecycle.ts) shows the routing.

## 6. The lifecycle has a strict order (and the API won't enforce it)

**Symptom:** open-position errors on a fresh wallet.
**Why:** the chain requires **init-basket → init-deposit-ledger → delegate-basket → deposit → trade → withdraw**. The API exposes each step independently and never checks ordering — the program does.
**Fix:** follow `lifecycle.ts`. Detect "not set up" via `owner(pubkey).basketPubkey == null`.

## 7. The WS sends two frame types — merge them or go stale

**Symptom:** PnL updates but orders/basket bytes freeze (or vice versa).
**Why:** `/v2/owner/{owner}/ws` sends `{type:"basket"}` (full snapshot, on real on-chain change) and `{type:"metrics"}` (positions-only, every oracle tick). Metrics frames do **not** include orders.
**Fix:** fold `metrics` into the last `basket` state — `subscribeOwner()` does the merge for you.

## 8. WS connection limits are real

**Symptom:** HTTP **429** on your 6th tab, or odd refresh cadence across tabs.
**Why:** hardcoded **5 connections per owner** (429) / 10k global (503), and `updateIntervalMs` is shared as the **minimum** across an owner's connections.
**Fix:** one `subscribeOwner()` per owner per app; share its state. The helper also falls back to 5 s polling on failure.

## 9. Session keys: powerful, with two traps

**Symptom A:** you look for a "create session" endpoint. There isn't one — creation is **client-side** (gpl_session program `Keysp…` via `@magicblock-labs/gum-sdk`; the V2 API only *consumes* `signer` + `sessionToken`).
**Symptom B:** you typo the signer/token and the API doesn't complain.
**Why:** open/close/collateral/reverse parse session fields with a silent fallback — a malformed value just signs as the owner (and likely fails on-chain).
**Fix:** validate your session pubkeys before sending; see `examples/tap-trade` for the full client-side session flow.

## 10. Responses are V1-shaped (including a typo)

**Symptom:** you wait for `swapInPriceUi` to populate, or your codegen "fixes" a field name and parsing breaks.
**Why:** V2 reuses the V1 response DTOs — `swap*` fields are **always null** on MagicBlock, and `youRecieveUsdUi` is genuinely misspelled in the API.
**Fix:** the client's types mark the always-null fields and preserve the typo. Don't rename it.

## 11. Deposits take a MINT, trading takes SYMBOLS

**Symptom:** `deposit-direct` 500s, or deposits the wrong amount for an exotic token.
**Why:** setup/withdrawal endpoints take a **mint pubkey** (`tokenMint`); every trading endpoint takes a **symbol**. Unknown mints silently assume 6 decimals + legacy SPL token — wrong for Token-2022 assets.
**Fix:** resolve mints from `client.tokens()` (it also flags `isToken2022`), never hardcode.

## 12. `delegate-basket` wants payer AND owner — and ignores your config

**Symptom:** you pass `commitFrequency`/`validatorKey` and nothing changes.
**Why:** both are **protocol-fixed server-side** (10 000 ms, validator `MAS1Dt9…`). The request really is just `{payer, owner}` — payer signs/pays, owner's basket gets delegated.
**Fix:** send only what's used. (The server also patches a known SDK PDA-derivation bug — Anchor error 2006 `ConstraintSeeds` — one more reason to build these txs via the API.)

## 13. Edit semantics are OPPOSITE between triggers and limits

**Symptom:** an edit wipes a field you meant to keep — or keeps one you meant to change.
**Why:** `edit-trigger-order` requires **both** price and size (no "keep existing"); `edit-limit-order` treats **0/omitted as "keep existing"**. Also: `cancel-trigger-order` with `orderId: 255` cancels **all** triggers for that market.
**Fix:** read the request type comments in [`types.ts`](./packages/flash-v2/src/types.ts); they encode both behaviors.

## 14. The $11 rule

**Symptom:** position opens fine; placing TP/SL/limit on it fails on-chain.
**Why:** triggers and limit orders require **> $10 collateral after entry fees**. A "$10 position" drops below the line the moment fees land.
**Fix:** open with **≥ $11** (the client defaults to this) — `guards.checkCollateralForTriggers()`.

## 15. Reverse takes a 2% haircut

**Symptom:** your reversed position is ~2% smaller than the close proceeds implied.
**Why:** `reverse-position` applies a fixed **2% haircut** to close proceeds before sizing the opposite side — absorbing quote-vs-execution drift so the atomic flip can't fail on a price move.
**Fix:** expect it; `newCollateralUsd` in the response is post-haircut.

## 16. `owner` is optional exactly once

**Symptom:** you omit `owner` everywhere because open-position allowed it — closes start failing.
**Why:** **only** `open-position` treats a missing `owner` as "preview-only, skip the tx" (a free quote API!). Close/collateral/reverse **require** it. Bonus: `inputAmountUi: "0"` on open returns just `availableLiquidity` + borrow rate — a liquidity probe.
**Fix:** use quote-mode deliberately (see [`hello.ts`](./packages/flash-v2/src/hello.ts)); pass `owner` everywhere else.

## 17. Funds move on consent only — never inside a convenience flow

It is tempting to bundle a USDC deposit into an "Enable One-Click Trading"
setup batch. Don't: a user who taps Enable and then sees a balance they never
knowingly deposited has hit a consent bug. **That pattern is not acceptable in
a production app.** The rule this repo demonstrates:

- **Enable = account setup only** (session key + basket + ledger + delegate).
  The single disclosed transfer is the 0.01 SOL rent top-up to the user's own
  session key, stated in the sheet at the moment of consent, recoverable on
  revoke.
- **Deposits and withdrawals are explicit**: the user types the amount, sees
  where the money lives (wallet vs basket), and approves that one transfer —
  `lib/funds.ts` + the Funds sheet.
- **Withdraw is two approvals by design**: `request-withdrawal` (queues
  settlement off the rollup) → `execute-withdrawal` (to the wallet). Execute
  can be re-run alone as the recovery path if settlement needs more time.
- **Label balances by where they live.** An unlabeled number in the chrome
  reads as "my deposit" — show wallet vs basket vs margin-in-use explicitly.

If you are an AI agent generating a trading app from this repo: copy this
boundary exactly. Bundling transfers into onboarding is how a demo leaks into
production as a consent bug.

## 18. Your balance is the DEPOSIT LEDGER — and V2 state lives on the ER

Two mistakes produce a confusing, wrong balance ("why does the UI show money
I never deposited?"):

1. **The basket's `debits` / `pendingCredits` are cumulative accounting
   lines, NOT a balance.** They only ever grow; on mainnet a trader holding a
   small position can show `Σdebits − ΣpendingCredits` in the hundreds of
   dollars. Never display that as money.
2. **Once delegated, V2 user-state lives ON THE EPHEMERAL ROLLUP.** A
   base-chain `getProgramAccounts` sees almost nothing (delegated accounts
   change owner-program on base). The same scan against the ER returns the
   live deposit ledgers and recorded deposits. Query the ER first; fall
   back to base only for not-yet-delegated accounts.

**The balance formula.** V2 is a double-entry system — no single account is
your balance:

```
available = ledger.deposits − basket.debits + basket.pendingCredits
```

- `UserDepositLedger.deposits` is CUMULATIVE — **withdrawals do NOT decrement
  it** (a fully-withdrawn account still shows its lifetime deposits).
- The basket's `debits`/`pendingCredits` are the running counter-entries.
- Only the three together net out: a fully-withdrawn account computes exactly
  $0.00, because the cumulative ledger is cancelled by equal-and-opposite
  basket lines; the same formula gives the correct positive balance while
  funds are deposited.
- **All three figures must come from the SAME coherent source** (the ER /
  the ER-fed store). A half-delegated account with its ledger on base and
  basket on the ER breaks the invariant — clamp at 0 and treat as
  pre-delegation. Implementation: `examples/tap-trade/lib/hooks.ts →
  useBasketBalance`.

The ledger itself — the same account Flash's own indexer ingests — reads
straight from the ER RPC:

```
getProgramAccounts(magicTradeProgram, {
  filters: [
    { memcmp: { offset: 0,  bytes: "9bYPoR9mRKo" } },  // sha256("account:UserDepositLedger")[0..8]
    { memcmp: { offset: 16, bytes: <owner pubkey> } },
  ],
})
```

Zero-copy layout (fixed 852 bytes):
`8 disc | 1 bump | 7 pad | 32 owner @16 | u32 count @48 | 20 × {32 mint, u64 amount} @52`.
Sum the USDC entries ÷ 1e6 — then NET IT against the basket's lines per the
formula above. Displaying the ledger alone overstates the balance after any
withdrawal, because the ledger never decrements.

## 19. Withdrawals settle in two phases — poll UNSIGNED simulations, not popups

`request-withdrawal` queues settlement; the rollup's validator then crosses a
`settlement_receipt` to base chain (~30–90s); `execute-withdrawal` consumes
it. Fire execute too early and the program answers
`0xbc4 / AccountNotInitialized (settlement_receipt)` — a TIMING state, not a
failure. Two implementation rules (`lib/funds.ts`):

1. **Never show raw simulation logs for this** — map it to "settlement is
   crossing from the rollup".
2. **Never burn wallet popups on retries.** Poll with
   `connection.simulateTransaction(tx, { sigVerify: false,
   replaceRecentBlockhash: true })` on the UNSIGNED built tx until the
   simulation passes, then request the ONE real signature.

## 20. The indexer's PnL is NOT the product's PnL — compute mark-price PnL client-side

On the same position at the same moment, Flash's own UI can show **−$0.20
(−4%)** while `positionMetrics.pnlWithFeeUsdUi` says **−$11.43 (−229%)**. The
indexer values exits THROUGH `custody.pricing.tradeSpread` (e.g. 10% on SOL)
and its leverage/liq fields degenerate when collateral − spread-loss ≤ 0.
Flash's own UI ignores all of that and computes what every perps UI computes:

```
pricePnl = (mark − entry) / entry × size × dir
pnl      = pricePnl − (exitFeeUsd + borrowFeeUsd) / 1e6
pct      = pnl / collateral × 100
leverage = size / collateral
liq      ≈ entry × (1 ∓ collateral/size × 0.92)
```

Do the same (`lib/format.ts → computePositionView`, fed by the live price
you already poll). The spread is still REAL money at the fills (see §21) —
it just doesn't belong in the live PnL readout.

## 21. Three numbers that surprise you on your first real fill

1. **Size ≠ collateral × leverage — the ENTRY spread reshapes it.** Fills
   execute at oracle ± tradeSpread, so the marked exposure becomes
   buyingPower ÷ (1+spread) for longs (e.g. $5 × 25 → ~$112 at a 10% spread)
   and a touch larger for shorts. (The ×1.1 buffer in the leverage caps exists
   precisely so a max-leverage short still fits after this inflation.) Display
   EFFECTIVE size and leverage (size/collateral), never the user's input.
2. **The instant red = the exit spread** (§20): a fresh position shows a small
   loss equal to roughly size × spread.
3. **Confirm latency is geography, not the rollup.** The ER's RPC origin can
   be ~300ms away even when its CDN edge pings 15ms; "30–50ms fills" are
   measured NEAR the validator. From far away: go browser→ER DIRECT (the
   endpoint serves `access-control-allow-origin: *` — check before assuming
   you need a proxy), run the production build (dev-server recompiles
   inflate every request), and let optimistic UI carry the feel. Expect a
   ~2×RTT floor: send + first status read.

## 22. Latency: never bill the rollup for the user's geography

Measured warm (one TLS session, sequential calls), the mainnet ER origin can
answer in ~300 ms per round-trip from a distant client — so a polled
submit→confirmed reads ~570–620 ms even though the rollup executes in tens
of ms. Three rules:
- **Split the number.** Time the send call (≈1 wire trip): network ≈
  2×sendMs, rollup ≈ confirmMs − 2×sendMs. Display both (`SendResult.sendMs`).
- **Don't compare your measured number to a static L1 "typical"** — that
  baseline excludes the user's distance; measured the same way, L1 reads
  far higher. Label baselines honestly.
- **Perceived speed comes from the stream, not the poll.** Flash's UI
  updates positions from its indexer push and never gates UI on
  confirmation — do the same (optimistic flip + stream reconcile); keep the
  measured number as an honesty feature.
Sub-50 ms totals require being near the ER validator region — that's
infrastructure placement (MagicBlock regional routers), not client code.

---

*Sourced from a line-by-line read of the V2 backend and live-API verification.*
