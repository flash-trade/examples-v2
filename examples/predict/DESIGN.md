# Updown — design direction

**Vibe: Void Instrument, v2 — frosted.** A dark room with one light source that knows how you're doing; the instruments are sheets of glass catching that light. Not a casino, not a terminal — a kitchen timer with money on it.

## Glass recipe (v2)

One static ambient orb (mood-tinted teal/coral via `body[data-mood]`) gives the frost something to refract — never two (they fight). Surfaces: `.glass` = white 5% fill, `blur(12px) saturate(180%) brightness(1.08)`, 1px white/10 border, inset top rim-light `0 1px 0 white/12`, drop `0 8px 32px black/36`, radius 20px. `.glass-strong` (inputs, picker, locked-numbers) = white 7% + blur 16. **Live digits always sit on a `.film`** (~32% dark plate) so numbers never fight the frost. Blur only on static surfaces — history rows stay solid. Solid teal/coral commit buttons keep an accent glow (`.cta-glow-*`); everything else is quiet glass. No-`backdrop-filter` fallback: solid `#0d0f1a/92`.

## Plain-words rule (v2.1)

Zero trading vocabulary anywhere a user reads, and **no payoff chart at all** — a chart is still something to decode. "What can happen" is three one-line rows on film plates (▲ Moves your way 1% → +$0.55 · ▼ Moves against you 1% → −$0.55 · ✕ Falls 18% — round ends → −$11 max). Reading beats decoding; nothing can overlap. Timeframes say "pays ×5/×3.3/×2"; the locked card says "You get in at / Round ends early at / Backing your call". The first-run disclosure remains the one place mechanics are named honestly.

## Tokens

| Token | Value | Rule |
|---|---|---|
| `bg` | `#07080F` | indigo-tinted void — never pure black, never the sibling's `#0b0d0c` green-black |
| `panel / panel2 / sheet` | `#0D0F1A / #131628 / #0B0D17` | flat layers, 1px `edge #1E2338` hairlines |
| `ink / dim / faint` | `#EFF1FF / #9AA1C4 / #5A6184` | type ladder |
| `up` | `#3EE6C1` | mint-teal — UP, wins. Always paired with ▲ or words (never color-only) |
| `down` | `#FF5C87` | coral-rose — DOWN, losses. Always paired with ▼ or words |
| `warn` | `#FFC857` | amber — disclosure & warnings ONLY. Never decorative |

Anti-patterns enforced: no AI purple/pink gradients, no glassmorphism-everywhere, no traffic-light green/red, no Inter.

## Type

- **Unbounded** (500/700/900) — display only: wordmark, UP/DOWN buttons, result verdicts ("CALLED IT").
- **Sora** (400–700) — all UI copy.
- **JetBrains Mono** — every number, `tnum` everywhere a digit lives. Numbers never reflow.

## Motion (meaning only)

Curve: `cubic-bezier(0.32, 0.72, 0, 1)` — mass, no bounce. Press = scale 0.98.
Only four things move: the countdown bar (1s linear depletion; urgency pulse + coral in the final fifth), the price tick (brightness flash, direction-tinted), the settle card (`settle-pop`), and sheets (transform-only slide). `prefers-reduced-motion` kills all of it.

## Signature moves

1. **The ambient mood radial** — a fixed background glow tinted by state (`body[data-mood]`): teal when you're calling UP / winning, coral on DOWN / a loss. The room reacts; the UI stays still.
2. **Double-bezel cards** — every major card is machined: outer shell (`.bezel`, white/3% + hairline + 1.6rem radius) holding an inner core with concentric radius and inset highlight.
3. **The payoff line IS the screen** — an SVG of your actual dollars vs the move, with break-even (teal dot) and knockout (coral wall) marked. It kills the odds mental model on sight.
4. **Locked-numbers card** — commit is two-step; the confirm card restates *your* numbers ("These don't drift") in mono before anything signs.
5. **The welcome-back settle card** — a returning user's expired round settles in front of them: stake shown intact while "settling…", then the verdict in Unbounded with a receipt link. Acknowledgment gates the next round.
6. **Verb, not noun** — the word "predict" appears as something you *do*; the product never claims to *be* a prediction market (the disclosure negates it explicitly, in amber).

## Layout

Mobile-first 390px single column (ticket → live rounds → history). Desktop ≥1024px: asymmetric 12-col bento — ticket col-span-5, rounds column col-span-7 offset down 4rem so the grid breathes diagonally.
