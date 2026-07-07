# predict — Updown: pick up or down.

**Your stake is the most you can lose.** Timed UP/DOWN price rounds (5m / 15m / 1h) where every round is a *real* Flash Trade V2 perp position on Solana mainnet — opened with your session key in ~30–50 ms, settled by a full close when the clock runs out.

## What you'll build

A single-screen price-call game: pick a market (live from `/tokens`), pick UP or DOWN, pick a timeframe, stake USDC. The ticket shows your numbers *before* you sign — payoff per 1% move, break-even, knockout level, max loss (= your stake) — locks them at commit, and settles the round from your browser at expiry. Wins land in your basket; history keeps the receipts.

## What's tricky here

- **It is not a prediction market** — no fixed odds, no shared pot. It's a capped-loss leveraged position wearing a round-timer. The app says this out loud (first-run disclosure) instead of letting users keep the Polymarket mental model.
- **The browser is the settlement engine.** Settlement triggers on *observed* state (owner stream + a shared 1 s clock), never a bare `setTimeout`. Three guards prevent double-closes: a `settling` status, an in-flight set, and a retry backoff.
- **Chain is the source of truth; localStorage is a cache.** Rounds reconcile against live positions by `(market, side)` — positions carry no timestamp. Positions opened elsewhere surface for *adoption*; rounds whose position vanished get marked *settled elsewhere*, never silently dropped.
- **Close the tab mid-round and nothing is lost** — the position stays on-chain. Come back and the welcome-back card settles it in front of you; acknowledgment gates the next round.
- **Your numbers can't drift.** PancakeSwap Prediction's biggest trust failure is a payout multiplier that changes after you enter. Here the entry, fees, and knockout shown on the confirm card come from the same signed response the round is built from.
- **Displayed PnL is Flash-parity client math** (`computePositionView`) — the indexer's `pnlWithFeeUsdUi` is never rendered (GOTCHAS §20).

## How it's meant to work

1. **Connect** (Phantom / Solflare) — mainnet warning up front.
2. **Enable one-tap rounds** — one wallet approval: session key + basket + ledger + delegate. *No funds move*; the disclosed 0.01 SOL rent top-up goes to your own session key and comes back on revoke.
3. **Deposit** — explicit, typed amount, its own approval (GOTCHAS §17 consent rule).
4. **Call it** — UP or DOWN; review the locked numbers; confirm. The position opens on the Ephemeral Rollup via your session key — no popup.
5. **Watch** — countdown bar, live mark-price PnL, settle-early any time.
6. **Settle** — at expiry the app full-closes the position (`inputUsdUi: "0"` — the 97% partial-close trap never applies). Result card shows won/lost with the on-chain receipt.
7. **Withdraw** — two approvals by design: `request-withdrawal` → `execute-withdrawal`, with unsigned-simulation polling in between (no popup burning).

Timeframe → payout profiles: **5m → ×5, 15m → ×3.3, 1h → ×2**, clamped to the market's live caps. Break-even move is multiplier-independent (fees scale with size); early-end distance ≈ 92%/multiplier (−18% / −28% / −46%) — deliberately far away on every round length.

## Endpoints used

| Endpoint | Why |
|---|---|
| `GET /tokens` | live market list (never hardcoded) |
| `GET /prices/{symbol}` | ticket price + live PnL mark |
| `POST open-position` (no `owner`) | the free quote at the review gate |
| `POST open-position` | the round itself (session-signed → ER RPC) |
| `POST close-position` (`"0"`) | settlement — explicit FULL close |
| `GET /owner/{owner}/ws` | live positions (one shared `subscribeOwner`) |
| `init-basket` / `init-deposit-ledger` / `delegate-basket` / `deposit-direct` | Enable + deposit (base chain) |
| `request-withdrawal` / `execute-withdrawal` | two-phase exit (base chain) |

## Run it

```bash
cp examples/predict/.env.example examples/predict/.env.local   # add your RPC key
bun install
bun run predict        # from the repo root (or: bun run --cwd examples/predict dev)
```

Open http://localhost:3000. You can browse markets, prices, and quotes with **no wallet at all** — connect + enable only when you want a real round. `bun run --cwd examples/predict typecheck` and `bun run --cwd examples/predict build` must stay green.

## Money flows (the consent rule)

Enable never moves funds. Deposits and withdrawals are explicit: user-typed amount, labeled source → destination (wallet vs basket), dedicated approval. Balances are computed with the deposit-ledger formula from the ER (`deposits − debits + pendingCredits`) and always labeled by where they live. Session revoke returns the rent top-up.

## Production checklist (for operators)

This is an open-source example. Before running it as a *service* for other people:

- **Jurisdictions are your problem.** Comparable products geo-fence: PancakeSwap Prediction hard-blocks restricted regions (HTTP 451), dYdX/Hyperliquid block US/UK/Canada IPs and prohibit VPN circumvention in their ToU. Several countries classify prediction-style products as gambling (Singapore, Indonesia, Spain, others). Get advice, geofence accordingly, and put a Restricted-Persons clause in your terms.
- **Adopt the loss-disclosure banner.** ESMA/FCA require "X% of retail accounts lose money" for CFD-like retail products; this app ships a voluntary version in the footer. Keep it.
- **Protect your RPC key.** `NEXT_PUBLIC_BASE_RPC` ships in the browser bundle — use a domain-restricted key, or better, a server-side proxy (e.g. Helius's one-click worker). Add a fallback provider; map 429s to calm copy (already done in `lib/copy.ts`).
- **Add error monitoring** (Sentry + source maps) and uptime checks on `https://flashapi.trade/health`.
- **Keeper settlement.** Client-side settlement is honest but depends on the user returning. A production service should run a keeper that closes expired rounds server-side — that requires a delegated signing design (users' session keys must never leave their browser; consider per-round TP/SL brackets via `place-tp-sl` as a chain-side backstop instead).
- **Known future work:** touch-mode rounds (TP/SL bracket = near-binary payoff, `validateTriggerPrice` + the $11 floor already enforced), shared leaderboards (needs an indexer), Mobile Wallet Adapter flows for Android/iOS.
