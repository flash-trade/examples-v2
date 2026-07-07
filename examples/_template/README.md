# _template — start your project here

⏱ **Time to run: 1 min**

## What you'll build

Whatever you want — this folder is the starting point. It ships doing the three universal moves (read a price, take a quote, stream an owner's live state) so you delete nothing and add only your idea.

## What's tricky here

> [!WARNING]
> Before you build: skim [GOTCHAS.md](../../GOTCHAS.md). The five that bite first: `err` arrives inside HTTP 200 · trigger prices aren't validated server-side (6057) · ≥97% of size = full close · trading txs go to the **ER** RPC, setup to **base**.

## How it's meant to work

1. Copy this folder: `cp -r examples/_template examples/my-idea`
2. Rename it in `package.json`, then `bun install` at the repo root
3. Build your strategy on the three primitives already imported from `flash-v2`
4. Need to sign? `signAndSend(network.erRpc | network.baseRpc, tx64, keypair)` — chain per endpoint is in each client method's TSDoc

## Endpoints used

| Endpoint | Why |
|---|---|
| `GET /prices/{symbol}` | live oracle read |
| `POST /transaction-builder/open-position` (no owner) | free quote API |
| `GET /owner/{owner}` + `/ws` | live positions via `subscribeOwner` |

## Run it

```bash
cp ../../.env.example ../../.env   # mainnet defaults work as-is
bun run dev                        # from this folder (or: bun run --cwd examples/_template dev)
```

> **Copying this OUTSIDE the repo?** `"flash-v2": "workspace:*"` only resolves
> inside the workspace — change it to a `file:../path/to/packages/flash-v2`
> reference (or a published version) in your copy's package.json.
