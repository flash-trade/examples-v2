# copy-trade — mirror a leader, non-custodially

⏱ **Time to run: 1 min (dry-run)**

## What you'll build

A follower bot that watches any wallet's live Flash V2 positions and mirrors its moves — opens, grows, shrinks, closes — **sized to the follower's own collateral**, signed by the **follower's own key**. Dry-run by default: it prints exactly what it *would* mirror.

## What's tricky here

> [!WARNING]
> **There is no "trades feed" — you build one by diffing snapshots.** Diff only `basket` frames; `metrics` frames re-price the same position every second and would spam phantom events ([GOTCHAS §9](../../GOTCHAS.md#9-the-ws-sends-two-frame-types--merge-them-or-go-stale)). **Never copy raw size** — scale by collateral ratio and hard-cap it, or a whale's $50k open becomes your liquidation. Respect the **$11 floor** ([§16](../../GOTCHAS.md#16-the-11-rule)) and remember `"0"` = full close ([§18](../../GOTCHAS.md#18-owner-is-optional-exactly-once)). Followers fill *later* than the leader — use wider slippage and accept drift.

## How it's meant to work

1. `subscribeOwner(LEADER)` streams the leader's basket
2. `diff(prev, next)` turns consecutive snapshots into `OPEN / GROW / SHRINK / CLOSE` events
3. Each event is sized: `mirror = leaderΔ × (follower_collateral / leader_collateral)`, capped at `MAX_FOLLOW_USD`
4. Replay via the trade builder — the unsigned tx is signed by the FOLLOWER's key → ER RPC
5. Dry-run prints the intent instead of signing — flip with `--execute` (mainnet)
6. Failures (e.g. follower lacks collateral) surface per-event and never desync the stream

## Endpoints used

| Endpoint | Why |
|---|---|
| `GET /owner/{LEADER}` + `/ws` | the leader's live positions (the diff source) |
| `GET /owner/{follower}` | follower collateral for ratio sizing |
| `POST /transaction-builder/open-position` | mirror opens/grows |
| `POST /transaction-builder/close-position` | mirror shrinks/closes ("0" = full) |

## Run it

```bash
LEADER=<pubkey> bun run dev                          # dry-run (prints intents)
LEADER=<pubkey> FOLLOWER_KEYPAIR=~/.config/solana/mainnet.json bun run dev -- --execute
```
