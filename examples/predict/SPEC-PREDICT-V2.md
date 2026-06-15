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

## v2.1 REDESIGN — Path A, spread-aware (supersedes the engine math above)

The 3-reviewer money-path audit (2026-06-15) found the v2 engine **funds-loss-grade broken**: it modeled cost as a 0.16% fee and **ignored the real 5–10% Flash trade spread**, so the bundled take-profit landed *inside* the spread and fired as a ~100% loss on SOL (live `pnlPercentage: −100`), leverage was never clamped (SOL opened at 100× already-liquidated), and nothing was reconciled to the signed fill. Decision: **keep the true fixed-odds binary (Path A), corrected for the spread.** `$11` floor is correct here — a bundled TP needs `> $10` collateral after fees (`guards.ts`: `MIN_COLLATERAL_USD_AFTER_FEES=10`, `RECOMMENDED_MIN_COLLATERAL_USD=11`). (A bare open's floor is ~$5, but our win = a bundled TP, so $11 stands.)

### The corrected construction — the spread is paid on BOTH legs (EMPIRICALLY corrected 2026-06-15)

A LONG fills at `entryFill = oracle·(1+s)`; a SHORT at `oracle·(1−s)`, where `s = tradeSpread` (live, per market, from `useMarketLimits` — SOL≈0.10, BTC/ETH≈0.05).

**Implementation discovery (live probe, read-only quote):** the v2.1 math above was STILL incomplete — it only charged the spread on ENTRY. The live API charges it AGAIN on exit: a take-profit triggering at price `K` *exits* at `K·(1∓s)` (a LONG sells back at the bid). Proof: a $90 SOL TP returned `exitPriceUi=$81` (=90×0.9) and `profitUsdUi≈$0` — break-even, not the 59¢ winner the entry-only math claimed. **A take-profit must clear TWO spreads to win.** The corrected, live-matched construction:

```
entryFill = oracle·(1 ± s)                        # + ABOVE/LONG, − BELOW/SHORT  (pay the spread on entry)
exitFill  = strike·(1 ∓ s)                         # the TP EXITS through the spread too  (pay it again)
t         = exitFill/entryFill − 1   (LONG)        # the NET move that drives PnL (∓ mirrored for SHORT)
strike    = entryFill·(1 ± t)/(1 ∓ s)             # ⇒ gross the strike UP by 1/(1−s) so net move = t
knockout  = entryFill·(1 ∓ 0.92/L)                # liquidation (the loss); builder's liq is degenerate
R         = L·(t − fee)        q = 1/(1+R)         # q now matches the venue's real payout
to-win    = stake/q            max-loss = stake
```

Break-even (LONG) is `strike = oracle·(1+s)/(1−s)` ≈ ×1.222 on SOL — so a genuine 58¢ SOL headline strike sits at ≈ `$100` when the oracle is `$74` (oracle×1.36), and the bet truly needs a big move. **Verified live end-to-end:** across the SOL and BTC headline + full ladder, the engine's shown to-win matches the API's `takeProfitQuote` to within 3%. The commit-gate reconcile (#3) is the backstop — it reads the venue's own `profitUsdUi` and blocks if the real payout diverges from what was shown.

### The new hard constraint: the knockout must sit BEYOND the spread

At high L, `koDist = 0.92/L` can be smaller than `s` → the position opens already past liquidation (CRIT-2). So clamp:

```
L_max = min( custody.maxLeverage ,  0.92 / (s · KO_MARGIN) )     # KO_MARGIN ≈ 1.5
```

SOL (s=0.10) ⇒ `L ≤ 0.92/0.15 ≈ 6×`. High-spread markets are naturally low-leverage (correct). The ladder must only offer odds achievable within `L_max` at a believable strike; deeper long-shots simply aren't available on high-spread tokens (show them honestly or omit).

### The fix list (every CRITICAL/HIGH from the audit), in order

1. **Engine spread-aware** (`lib/markets.ts`): `priceMarket`/`marketForTargetProb`/`strikeLadder`/`bucketMarket` take `oracle` + `spread` + `maxLeverage`; compute from `fillEntry`; clamp `L` by the constraint above; the `Market` carries `oracle` (display) and `entry`=`fillEntry`. **Fixes CRIT-1, CRIT-2, HIGH-4.**
2. **Wire live spread + caps**: card/detail call `useMarketLimits(token)` → pass `tradeSpread` + `maxLeverage` into the engine. No market is built before limits load (gate the ticket).
3. **Reconcile to the signed fill** (two-step review→confirm): quote the REAL fill, render the venue's own numbers, and **block the commit** if (a) the strike fails `validateTriggerPrice` vs the real entry, (b) the API returns no `takeProfitQuote`, (c) `takeProfitQuote.profitUsdUi ≤ 0` (TP inside the round-trip spread → fires as a loss), or (d) the live payout falls below 60% of the shown odds (stale-price / model-drift divergence guard). Re-quote + re-check at confirm (two-step like `app.tsx doReview→doConfirm`). The venue's `profitUsdUi` is ground truth — never trust local math over it. **Fixes CRIT-3, MEDIUM (stale price).**
4. **Validate the TP**: call `guards.validateTriggerPrice({side, kind:"tp", price:strike, markPrice:fillEntry})` before sending; refuse on `!ok` (avoids on-chain `6057`).
5. **Settlement + expiry** (port `lib/rounds.ts`): record a `Round{…expiresAt}` on a confirmed send; run the reconcile/settle watcher; close at expiry by mark (`inputUsdUi:"0"`) for the between-barrier case. Render a **/markets-specific** disclosure (don't inherit Updown's). **Fixes HIGH-5.**
6. **Gates + errors**: `canBet` floor → `MIN_STAKE` (11); add `stake > balance` block; double-submit guard (in-flight set keyed by owner|market|side, re-check live balance); route `place()`/`enable()` errors through `calmError`; surface the real `enable` step error. **Fixes C3, H1, H2, M1.**
7. **Buckets**: rebuild as bounded (double-barrier / call-spread) outcomes, or relabel honestly as "chance price *reaches* this zone" and drop the fake normalization. **Fixes HIGH-6.**
8. **Slippage**: set `slippagePercentage` ≥ the spread (or omit and let the spread price it) — `"1"` is below a 5–10% spread. **Fixes MEDIUM-7.**
9. Guard degenerate inputs (`oracle ≤ 0`, `t ≤ s+fee`). **Fixes LOW-8.**

**Re-run the 3-agent adversarial review before flipping the "don't trade real funds" banner.**

## Verification bar (every phase)

`bun run --cwd examples/predict typecheck` and `build` must stay green. Mainnet, real funds — no shortcuts. Adversarial review before anything is called done.
