# Security

## What this repo is (and isn't)

An **educational starter** for building on Flash Trade V2 (MagicBlock Ephemeral Rollups). It is not a custodial product and not financial advice. Perpetual futures are leveraged instruments — you can lose your collateral, and liquidation distance shrinks as leverage rises.

## The trust model

- The hosted V2 API **builds unsigned transactions**. It never holds keys and cannot move funds — *you* sign and submit. Review what you sign.
- Everything is **mainnet — real funds**. Size positions to what you can lose.
- tap-trade is **wallet-connect only** (Phantom/Solflare). There is no app-held wallet; deposits/withdrawals each require an explicit owner signature.
- Session keys (gpl_session) **auto-sign trades against your basket until they expire** — that is their purpose and their blast radius: an attacker with the key (it lives in plaintext `localStorage`, scoped to the magic-trade program, default 24 h) could open/close positions against your deposited collateral and spend the key's SOL top-up, but cannot withdraw to their own wallet (withdrawals need the owner signature). Keep deposits sized to that risk, keep sessions short, revoke when done — and note a failed revoke now KEEPS the session stored so you can retry it.

## Key handling rules

- `.env` is gitignored; only `.env.example` (no secrets) is committed.
- Never commit keypairs, RPC API keys, or provider tokens. CI fails the build if a secret pattern lands in the tree.
- `lifecycle --submit` requires `KEYPAIR_PATH` — point it at a **dedicated throwaway wallet (real funds — keep it small)**.

## Reporting a vulnerability

- **This starter:** open a GitHub security advisory on the repo (Security → Report a vulnerability).
- **The Flash protocol or V2 API:** contact the Flash Trade team — https://flash.trade (Discord/Telegram linked there). Please do not open public issues for protocol-level reports.
