// ─────────────────────────────────────────────────────────────────────────────
// _template — copy this folder to start YOUR project.
// It already does the three things every Flash V2 app does: read a price,
// take a quote, and watch an owner's live state. Replace the strategy logic
// with your idea; the plumbing (errors, networks, signing) is the platform's.
// Hard parts reference: ../../GOTCHAS.md · API surface: packages/flash-v2
// ─────────────────────────────────────────────────────────────────────────────

import { FlashV2Client, subscribeOwner } from "flash-v2";

const flash = new FlashV2Client(); // mainnet by default

// 1) Read — no wallet needed.
const sol = await flash.price("SOL");
console.log(`SOL = $${sol.priceUi}`);

// 2) Quote — omit `owner` for preview-only (no transaction built).
const quote = await flash.openPosition({
  inputTokenSymbol: "USDC",
  outputTokenSymbol: "SOL",
  inputAmountUi: "11",
  leverage: 5,
  tradeType: "LONG",
});
console.log(`5x LONG quote: entry $${quote.newEntryPrice}, liq $${quote.newLiquidationPrice}`);

// 3) Live state — point at any wallet to stream its positions.
//    (Your strategy reacts here. Ctrl+C to exit.)
const OWNER = process.env.OWNER ?? "";
if (OWNER) {
  console.log(`streaming ${OWNER} — Ctrl+C to stop`);
  subscribeOwner({
    owner: OWNER,
    onUpdate: (snap, source) => {
      const positions = Object.values(snap.positionMetrics);
      console.log(`[${source}] ${positions.length} position(s)`,
        positions.map((p) => `${p.marketSymbol} ${p.sideUi} PnL ${p.pnlWithFeeUsdUi}`).join(" · "));
    },
  });
} else {
  console.log("\nSet OWNER=<wallet pubkey> to stream live positions. Then build your thing.");
}
