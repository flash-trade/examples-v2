# tap-trade — tap. trade. ~30 ms.

⏱ Time to run: ~3 min

## What you'll build

A viewport-locked tap-trading screen in the bloxwap genre, skinned to Flash Trade's brand: a full-bleed canvas chart of live SOL (mint line, slot-reel price digits, the price pill glowing at the line tip), a floating FEE/SIZE/LEV badge, and two giant stadium buttons in the thumb zone — **SHORT** and **LONG**. Connect Phantom or Solflare, tap **Enable One-Click Trading** once (ONE wallet approval covers everything), and from then on every tap fills on a MagicBlock Ephemeral Rollup in ~30–50 ms with zero popups. The latency chip in the top bar prints the REAL submit→confirmed milliseconds of your last fill; tap it for the full session log with explorer links.

## What's tricky here

> [!WARNING]
> - **Enable One-Click Trading bundles four ACCOUNT-SETUP steps behind ONE approval** — session key + init-basket + init-deposit-ledger + delegate-basket, all built first, signed together via `signAllTransactions`, then submitted to the base chain in strict order (`lib/enable.ts`). **No user funds move during Enable** — deposits are a separate explicit step (the consent rule, [GOTCHAS §19](../../GOTCHAS.md#19-funds-move-on-consent-only--never-inside-a-convenience-flow)). Never touch the API transactions' blockhashes — they arrive partially signed server-side.
> - **Session keys have NO server creation endpoint** — the CLIENT mints the `SessionTokenV2` PDA itself via the gum program (`Keysp…wde5`), then passes `signer` + `sessionToken` on every trade request. See [SESSION-KEYS.md](./SESSION-KEYS.md).
> - **Two chains, two RPCs.** Trading txs (open / close / reverse / tp-sl) submit to the **ER RPC** (`network.erRpc`); setup txs submit to the **base chain** (`network.baseRpc`). Mixing them fails.
> - **The API returns HTTP 200 with `err` inside.** Trading/preview failures hide in a 200 body. `flash-v2` normalizes all three error channels into `FlashV2Error` so you only handle one shape.

## How it's meant to work

1. **Connect** — the wallet pill (upper-right) or the full-width CTA opens the wallet sheet: Phantom or Solflare. The connected wallet OWNS the basket; `GET /owner/{pubkey}` + the owner WebSocket stream tell the app what exists.
2. **Enable One-Click Trading** — the mint-gradient pill orchestrates ACCOUNT SETUP behind ONE approval sheet:
   - builds everything first: the `create_session_v2` tx (`lib/session.ts → buildSessionTransaction`) plus `init-basket`, `init-deposit-ledger`, `delegate-basket` from the transaction-builder API;
   - one `signAllTransactions` popup (sequential `signTransaction` fallback if the wallet lacks it);
   - submits sequentially to the base chain with per-step rows (status, ms, explorer link) in the enable sheet;
   - "already in use" responses are treated as *already set up* and skipped past.
   **No USDC moves here.** The only transfer is the disclosed 0.01 SOL top-up to your own session key. The wallet needs a little SOL for setup (mostly recoverable account rent + a 0.01 SOL session top-up, computed at runtime), or the sheet stops with a funding hint.
3. **Deposit — your amount, your approval.** The enable sheet (and the wallet-pill menu → *deposit / withdraw*) opens the Funds sheet: type the USDC amount, approve the single transfer, and it's tradable once the deposit confirms. Withdrawing is the same sheet — two approvals (`request-withdrawal` → `execute-withdrawal`, with a visible "Execute again" recovery path).
4. **Trade** — tap **SHORT** or **LONG** (live price + `$25 · 5×` on the buttons): `open-position` builds for the session signer, the session key auto-signs, the tx lands on the **ER RPC**. No popup, no spinner — the button fill-flashes on the real confirm and the floating position chip appears from the owner stream.
5. **Manage** — with a position open the action zone becomes one full-width **CLOSE** button carrying live PnL (ticking from the stream) plus a reverse pill. The floating badge (FEE/SIZE/LEV) opens the trade sheet: size presets `$11/$25/$50/$100`, leverage `2×/5×/10×`, TP/SL with the $11-rule warning, slippage. TP/SL prices are validated against the LIVE mark before building (skipping error 6057).
6. **Measure** — every confirm feeds the latency chip; tap it for the latency sheet: last ER confirm big, ER vs ~400 ms typical L1 bars, and the session log with explorer links. Every number is a real `confirmMs` — nothing is invented.

## Endpoints used

| Endpoint | Used for | Submit signed tx to |
| --- | --- | --- |
| `POST /transaction-builder/open-position` | SHORT / LONG taps + the FEE badge preview (no `owner` = quote-only) | **ER RPC** |
| `POST /transaction-builder/close-position` | CLOSE (`inputUsdUi: "0"` = full close) | **ER RPC** |
| `POST /transaction-builder/reverse-position` | the reverse pill | **ER RPC** |
| `POST /transaction-builder/place-tp-sl` | optional TP/SL bracket after the fill | **ER RPC** |
| `GET /owner/{owner}` (+ `/owner/{owner}/ws`) | basket check + live position/PnL stream | — (read) |
| `GET /prices/SOL` | 1 s ticker → slot-reel digits + chart + TP/SL math | — (read) |
| `GET /tokens` | the LIVE market list + the USDC **mint** for deposits | — (read) |
| `POST /transaction-builder/init-basket` · `init-deposit-ledger` · `delegate-basket` | Enable One-Click Trading — account setup, one approval, **no funds** | **base chain RPC** |
| `POST /transaction-builder/deposit-direct` | the EXPLICIT Deposit (your amount, its own approval) | **base chain RPC** |
| `POST /transaction-builder/request-withdrawal` → `execute-withdrawal` | the EXPLICIT Withdraw (two approvals; execute re-runs to recover) | **base chain RPC** |

## Run it

```bash
cp examples/tap-trade/.env.example examples/tap-trade/.env.local   # then paste your free RPC key
bun install                                                        # repo root
bun run --cwd examples/tap-trade dev                               # (or: bun run tap-trade)
```

Open [http://localhost:3000](http://localhost:3000). **Flash V2 runs on Solana mainnet** — real funds, start small. One-time setup: `cp .env.example .env.local` and paste a **free RPC key** (helius.dev / triton.one) into `NEXT_PUBLIC_BASE_RPC` — domain-restrict it, since it ships in the browser.

## Money flows (the consent rule)

**Funds move only on an explicit, amount-chosen, separately-approved action — never inside a convenience flow.** This is the production pattern the example teaches ([GOTCHAS §19](../../GOTCHAS.md#19-funds-move-on-consent-only--never-inside-a-convenience-flow)):

| Action | What moves | Where |
|---|---|---|
| **Enable One-Click Trading** | **No USDC — ever.** Account setup only (session key + basket + ledger + delegate) behind one approval. Sole disclosed transfer: 0.01 SOL to your own session key (covers session-account rent; recoverable on revoke) | base chain |
| **Deposit** (wallet pill → deposit / withdraw) | The USDC amount **you type**, one approval | base chain → tradable on the rollup |
| **Withdraw** | Two approvals by design: `request-withdrawal` (queues settlement) → `execute-withdrawal` (to your wallet; re-run alone to recover) | base chain |
| **Taps** (SHORT / LONG / CLOSE) | Position changes only, signed by the session key — popup-free | Ephemeral Rollup, ~30–50 ms |

Balances are labeled by where they live — **wallet USDC** (depositable) vs **in basket** (tradable) vs **margin in use** — in the wallet-pill menu. The "in basket" figure is read from the on-chain **`UserDepositLedger`** via the **ER RPC** (the same account Flash's indexer ingests; delegated V2 state is invisible to base-chain reads) — never from the basket's `debits`/`pendingCredits` accounting lines ([GOTCHAS §20](../../GOTCHAS.md#20-your-balance-is-the-deposit-ledger--and-v2-state-lives-on-the-er)).
