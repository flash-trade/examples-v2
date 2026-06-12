// ─────────────────────────────────────────────────────────────────────────────
// hello.ts — your first success, in under a minute, with NO wallet.
// Reads a live oracle price from the hosted API, then asks for a full
// trade QUOTE (omitting `owner` = preview-only: real math, no transaction).
// If this prints numbers, you are connected to Flash V2 on MagicBlock.
// Next: lifecycle.ts (the full account walkthrough) → examples/tap-trade.
// ─────────────────────────────────────────────────────────────────────────────

import { FlashV2Client } from "./client.ts";

const flash = new FlashV2Client(); // mainnet (override: FLASH_V2_BASE_URL)

console.log(`network: ${flash.network.name} → ${flash.network.apiBase}\n`);

// 1) A read — no auth, no wallet, just data.
const sol = await flash.price("SOL");
console.log(`SOL = $${sol.priceUi}  (Pyth Lazer, session: ${sol.marketSession})`);

// 2) A real quote — same endpoint that builds transactions, minus `owner`.
const quote = await flash.openPosition({
  inputTokenSymbol: "USDC",
  outputTokenSymbol: "SOL",
  inputAmountUi: "11",      // ≥ $11 so TP/SL stay possible after fees (GOTCHAS.md)
  leverage: 5,
  tradeType: "LONG",
});

console.log(`\nQuote — 11 USDC × 5x LONG SOL`);
console.log(`  entry price     $${quote.newEntryPrice}`);
console.log(`  entry fee       $${quote.entryFee}`);
console.log(`  liquidation     $${quote.newLiquidationPrice}`);
console.log(`  hourly borrow   ${quote.marginFeePercentage}%`);
console.log(`  position size   ${quote.outputAmountUi} SOL`);

console.log(`\nThat's the whole loop: read → quote. Add \`owner\` to get an unsigned`);
console.log(`transaction back, then sign.ts submits it to the right chain.`);
console.log(`→ next: bun run lifecycle`);
