# predict v2 — a real prediction market on Flash V2 perps

Status: **in progress.** Phase 1 (the odds engine, `lib/markets.ts`) is built + typechecked. This spec locks the direction and the remaining phases.

## The decision (confirmed)

Transform "Updown" (a capped-loss UP/DOWN timer) into a **real-feeling prediction market**: cents = probability, buy YES/NO, "to win $X", settle to win/lose. Market types to build: **strike thresholds** ("TOKEN above $X by T") and **multi-outcome buckets** ("where does it land?"). (Timed up/down and all-token-classes were *not* selected for the first build.)

This is the **Drift BET / Kalshi model adapted to Flash's capped-loss perps**: on Drift, "a prediction market is a perp market priced $0–1, YES = long, NO = short." We do the same, but every position is a *capped-loss* perp (you can never lose more than your stake — the liquidation is the floor).

## The honest line (non-negotiable, keep the trust)

The current app is *proud* it's "not a prediction market." v2 adopts the prediction-market framing but stays honest about the one thing it cannot be without a custom on-chain program:

- **Odds are formula-set** from a real leveraged position — they do **not** aggregate other traders' beliefs and do **not** move from order flow.
- **Payout comes from Flash's LP**, not a shared pot of losers' stakes.
- **What is real:** the underlying price, both barriers, and *you can never lose more than your stake.*

Surface this in a first-run disclosure + a persistent "how odds are set" link (inherit `mechanics-disclosure.tsx`). "Trade, not bet" / "formula-set odds on a real position" — Kalshi's lexical discipline is the trust signal.

## The algo (built — `lib/markets.ts`)

A prediction = a step payoff `{−stake, +payout}` + a number `q` read as probability. A perp = a clipped line. Clamp both ends → a one-touch binary:

- **Lower clamp** = the native knockout (liquidation) → lose exactly your stake `C`.
- **Upper clamp** = a **bundled take-profit at the strike** (`OpenPositionRequest.takeProfit`) → win a fixed payout `P`.

```
R (payout multiple) = L·(t − fee)        # profit per $1 staked on YES
q (YES prob, 0..1)  = 1 / (1 + R)        # the cents when ×100
to-win              = stake / q          # $1 per share, shares = stake/q
```

`L` = leverage (set by the knockout distance, `koDist = 0.92/L`), `t` = favorable move to the strike, `C` = stake, `fee` = round-trip rate. **Symmetric barriers give q≈0.52 at any leverage; asymmetry spans the ladder** (far TP + near knockout = long shot). Probabilities clamped to **3¢–97¢** (Drift's 0.05/0.95 convention).

Engine surface (all pure, typechecked):
- `priceMarket({entry, strike, knockoutPrice, direction, timeframe})` → leverage + `prob` + `payoutMult`.
- `marketForTargetProb(...)` → solve the construction for a target YES price.
- `strikeLadder(...)` → a row of YES markets at 85¢/70¢/55¢/40¢/25¢ (the odds ladder).
- `bucketMarket({edges})` → multi-outcome buckets, normalized to sum ~1.
- `openParamsFor(market, stake)` → the `flash.openPosition` params (capped-loss perp + bundled TP).
- `cents` / `toWinUsd` / `profitUsd` / `questionFor` — the cents=probability lexicon.

**Settlement:** open with the TP bundled (YES win → +P). Liquidation = NO (lose stake). Between-barrier at expiry → full close at mark (`inputUsdUi:"0"`, the existing engine) and resolve by which side is ahead. Reuse the existing triple double-close guard, welcome-back settle, and `(market, side)` reconciliation in `lib/rounds.ts` / `components/app.tsx`.

## The UX (Kalshi/Polymarket-grade, on the existing dark glass)

Screens:
1. **Discover** — category tabs (Crypto / Stocks / FX / Commodities, from `/v2/tokens`) + search + a **market-card grid**. Card = question · big YES/NO ¢ · a YES/NO split bar · countdown · sparkline · volume-ish. (The single most important component — make it instantly scannable + clickable.)
2. **Market detail** — the question, a **probability-over-time line chart** (reuse `usePriceHistory`, plot implied prob), the strike ladder / bucket outcomes as rows, and the **buy ticket**.
3. **Buy ticket** — YES/NO toggle, amount, **avg price (¢), shares, "To win $X", max loss = your stake**, the locked-numbers confirm ("these don't drift"). Honest, never manipulative.
4. **Portfolio** — open positions as shares with live value (mark→implied prob), realized history, a local leaderboard/stats (inherit `stats-strip` / `history`).

Reuse wholesale: `enable-sheet`, `funds-sheet`, `wallet-bar`, `settle-card`, `clock`, `stream`, `session`/`signer`, `flash`, `payoff` constants, `token-icon`.

## Design tokens (from the premium research)

Keep the existing "Void Instrument / frosted glass" base (`globals.css`, `DESIGN.md`) but tighten to the premium discipline the research confirmed:

- **Cents = probability everywhere** (Polymarket/Kalshi/Drift/Myriad all do this — it's what makes it read "real").
- **Semantic color, never decoration; never color-alone** — pair YES/NO + up/down with ▲/▼ + words. Kalshi's confirmed split: YES=blue `#265cff` / NO=purple `#aa00ff`; up/green `#0ac285` / down/red `#d91667`; dark bg `#141414`. Manifold: YES=teal `#14B8A6` / NO=scarlet `#F75836`. **Our existing up=`#3EE6C1` / down=`#FF5C87` already works — keep it, just apply it semantically to YES/NO.**
- **Restraint = premium** (Linear/Stripe/Coinbase/Refactoring-UI, all verified): one accent on near-black (`#07080F`, not pure black), **8px grid**, ~9 neutral shades, 2–3 font weights, **hairlines not boxes**, **tabular numerals** on every digit, desaturated accents on dark (no neon vibration), whitespace as luxury. Motion only where it means something (countdown, price tick, settle).
- Type ladder unchanged: Unbounded (display) · Sora (UI) · JetBrains Mono (`tnum`, all numbers).

## Build phases (sequential; subagents rate-limited until Jun 15 9am ET)

1. ✅ **Odds engine** — `lib/markets.ts` (pure, typechecked).
2. **Market model + state** — extend `lib/rounds.ts` for share/market rounds; a `useMarkets`-style hook that builds ladders/buckets from live `/v2/tokens` + `/v2/prices`; the `openParamsFor` → confirm/lock flow.
3. **Discover + market card** — the category/search grid + the card component (the highest-leverage UI).
4. **Market detail + buy ticket** — prob chart + ladder/bucket rows + the YES/NO ticket with "to win $X" / max-loss.
5. **Portfolio + settlement** — shares with live value, history, the welcome-back settle adapted to win/lose framing.
6. **Disclosure + polish** — the honest "how odds are set" disclosure; the premium pass; `typecheck` + `build` green; adversarial review.

## Verification bar (every phase)

`bun run --cwd examples/predict typecheck` and `build` must stay green. Mainnet, real funds — no shortcuts. Adversarial review before anything is called done.
