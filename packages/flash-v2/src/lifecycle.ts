// ─────────────────────────────────────────────────────────────────────────────
// lifecycle.ts — THE walkthrough. The complete Flash V2 life of an account:
//   init → delegate → deposit → (settle) → trade on the ER → withdraw.
// THE HARD PART: which chain each step belongs to, in which order, and where
// the waits are. Run it dry (default — builds every tx, signs nothing) or for
// real with --submit + KEYPAIR_PATH (REAL FUNDS — use a throwaway wallet with small amounts). Read top-to-bottom: every step
// says WHY it exists and WHERE it lands. GOTCHAS.md → "Lifecycle ordering"
// ─────────────────────────────────────────────────────────────────────────────
//
//   bun run lifecycle                         # dry run — safe, no wallet needed
//   KEYPAIR_PATH=~/.config/solana/throwaway.json bun run lifecycle -- --submit
//
// ── The map ──────────────────────────────────────────────────────────────────
//   BASE CHAIN (network.baseRpc)              EPHEMERAL ROLLUP (network.erRpc)
//   1. init-basket            ┐
//   2. init-deposit-ledger    │ one-time
//   3. delegate-basket        ┘
//   4. deposit-direct  ─────────────────▶      5. open  (MARKET, 5x LONG)
//                                              6. place TP/SL bracket
//                                              7. read live state (owner snapshot)
//                                              8. close (full)
//   9. request-withdrawal ◀── settle ~10s ──
//  10. execute-withdrawal
// ─────────────────────────────────────────────────────────────────────────────

import { Keypair } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { FlashV2Client } from "./client.ts";
import { signAndSend } from "./sign.ts";
import {
  checkCollateralForTriggers,
  validateTriggerPrice,
  RECOMMENDED_MIN_COLLATERAL_USD,
} from "./guards.ts";
import { FlashV2Error } from "./errors.ts";

const SUBMIT = process.argv.includes("--submit");
const MARKET = process.env.MARKET ?? "SOL";
const COLLATERAL = process.env.COLLATERAL ?? "USDC";
const DEPOSIT_UI = process.env.DEPOSIT_UI ?? "15";          // ledger funding
const OPEN_UI = process.env.OPEN_UI ?? String(RECOMMENDED_MIN_COLLATERAL_USD); // ≥$11 → TP/SL allowed

const flash = new FlashV2Client(); // mainnet — see network.ts

// In dry-run mode any pubkey works (we only BUILD transactions, never sign).
// In --submit mode the keypair is the owner and signs everything.
function resolveOwner(): { owner: string; keypair?: Keypair } {
  if (!SUBMIT) {
    const throwaway = Keypair.generate();
    return { owner: throwaway.publicKey.toBase58() };
  }
  const path = process.env.KEYPAIR_PATH;
  if (!path) throw new Error("--submit needs KEYPAIR_PATH=<keypair json>. Use a THROWAWAY wallet — real funds.");
  const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
  return { owner: keypair.publicKey.toBase58(), keypair };
}

// Some build endpoints REQUIRE existing on-chain state (a basket, a position).
// On a fresh owner they fail — that's expected, not broken. We say so.
async function step<T>(label: string, run: () => Promise<T>, opts?: { expectErrorOnFreshOwner?: boolean }): Promise<T | undefined> {
  process.stdout.write(`\n▶ ${label}\n`);
  try {
    const out = await run();
    const tx = (out as { transactionBase64?: string | null } | undefined)?.transactionBase64;
    console.log(tx ? `  ✓ built unsigned tx (${tx.length} base64 chars)` : "  ✓ ok");
    return out;
  } catch (e) {
    if (e instanceof FlashV2Error && opts?.expectErrorOnFreshOwner && !SUBMIT) {
      console.log(`  ◦ expected on a fresh owner (needs on-chain state): ${e.message}`);
      return undefined;
    }
    throw e;
  }
}

async function submitIf(label: string, chain: "base" | "er", tx: string | null | undefined, keypair?: Keypair) {
  if (!SUBMIT || !tx || !keypair) return;
  const rpc = chain === "er" ? flash.network.erRpc : flash.network.baseRpc;
  const { signature, confirmMs } = await signAndSend(rpc, tx, keypair);
  console.log(`  ⛓ ${label} confirmed on ${chain.toUpperCase()} in ${confirmMs}ms → ${signature}`);
}

const { owner, keypair } = resolveOwner();
console.log(`Flash V2 lifecycle — ${flash.network.name} — owner ${owner}`);
console.log(SUBMIT ? "MODE: --submit (REAL mainnet transactions)" : "MODE: dry run (build-only, nothing is signed or sent)");

// ── 0. Reads: prove the API is alive before touching a wallet ────────────────
const health = await step("health — is the deployment alive? which pool config?", () => flash.health());
if (health) console.log(`  program=${health.program} env=${health.config.env} baskets=${health.accounts.baskets ?? "?"}`);

const price = await step(`price ${MARKET} — live Pyth Lazer oracle`, () => flash.price(MARKET));
const mark = price ? price.priceUi : 0;
if (price) console.log(`  ${MARKET} = $${price.priceUi} (${price.marketSession})`);

const tokens = await step("tokens — symbols + MINT addresses (deposits need the mint)", () => flash.tokens());
const collateralMint = tokens?.find((t) => t.symbol.toUpperCase() === COLLATERAL.toUpperCase())?.mintKey;
if (collateralMint) console.log(`  ${COLLATERAL} mint = ${collateralMint}`);

// ── 1–3. One-time account setup — ALL on the BASE chain ──────────────────────
const init = await step("1. init-basket — your one Basket PDA holds ALL positions+orders", () =>
  flash.initBasket({ owner }));
await submitIf("init-basket", "base", init?.transactionBase64, keypair);

const ledger = await step("2. init-deposit-ledger — your collateral inbox", () =>
  flash.initDepositLedger({ owner }));
await submitIf("init-deposit-ledger", "base", ledger?.transactionBase64, keypair);

const delegate = await step("3. delegate-basket — hand the basket to the MagicBlock validator", () =>
  flash.delegateBasket({ payer: owner, owner }));
await submitIf("delegate-basket", "base", delegate?.transactionBase64, keypair);

// ── 4. Fund it (base chain), then LET THE ER CLONE the delegated state ───────
const deposit = collateralMint
  ? await step(`4. deposit-direct — ${DEPOSIT_UI} ${COLLATERAL} into the vault (mint, not symbol!)`, () =>
      flash.depositDirect({ owner, tokenMint: collateralMint, amount: DEPOSIT_UI }))
  : undefined;
await submitIf("deposit-direct", "base", deposit?.transactionBase64, keypair);

// ── 5. Trade — on the EPHEMERAL ROLLUP from here until withdrawal ────────────
const collateralCheck = checkCollateralForTriggers(Number(OPEN_UI), Number(OPEN_UI) * 0.001);
console.log(`\n▶ guard: collateral $${OPEN_UI} after ~fees → ${collateralCheck.ok ? "OK for TP/SL" : collateralCheck.reason}`);

const open = await step(`5. open-position — ${OPEN_UI} ${COLLATERAL} × 5x LONG ${MARKET} (MARKET order)`, () =>
  flash.openPosition({
    inputTokenSymbol: COLLATERAL,
    outputTokenSymbol: MARKET,
    inputAmountUi: OPEN_UI,
    leverage: 5,
    tradeType: "LONG",
    orderType: "MARKET",
    owner,
    slippagePercentage: "0.5",
  }), { expectErrorOnFreshOwner: true });
if (open) {
  console.log(`  entry≈$${open.newEntryPrice} fee=$${open.entryFee} liq≈$${open.newLiquidationPrice} borrow=${open.marginFeePercentage}%/h`);
}
await submitIf("open-position", "er", open?.transactionBase64, keypair);

// ── 6. Bracket it — TP/SL prices MUST be on the right side of mark ───────────
if (mark > 0) {
  const tp = mark * 1.1, sl = mark * 0.9;
  for (const [kind, p] of [["tp", tp], ["sl", sl]] as const) {
    const v = validateTriggerPrice({ side: "LONG", kind, price: p, markPrice: mark });
    console.log(`\n▶ guard: ${kind.toUpperCase()} ${p.toFixed(2)} vs mark ${mark.toFixed(2)} → ${v.ok ? "valid" : v.reason}`);
  }
  const bracket = await step("6. place-tp-sl — bracket the position in ONE atomic tx", () =>
    flash.placeTpSl({
      marketSymbol: MARKET,
      side: "LONG",
      takeProfitUi: tp.toFixed(2),
      stopLossUi: sl.toFixed(2),
      sizeAmountUi: open?.outputAmountUi ?? "0.1",
      owner,
    }), { expectErrorOnFreshOwner: true });
  await submitIf("place-tp-sl", "er", bracket?.transactionBase64, keypair);
}

// ── 7. Read your live state — snapshot now; subscribeOwner() for streaming ───
const snap = await step("7. owner snapshot — positions+orders, PnL/leverage/liq pre-computed", () =>
  flash.owner(owner));
if (snap) {
  const positions = Object.values(snap.positionMetrics);
  console.log(`  basket=${snap.basketPubkey ?? "none yet"} · ${positions.length} live position(s)`);
  for (const p of positions) console.log(`  ${p.marketSymbol} ${p.sideUi} ${p.sizeUsdUi} USD · PnL ${p.pnlWithFeeUsdUi}`);
}

// ── 8. Close — "0" (or ≥97% of size) = FULL close, different instruction ─────
const close = await step(`8. close-position — full close ("0" = everything)`, () =>
  flash.closePosition({
    marketSymbol: MARKET,
    side: "LONG",
    inputUsdUi: "0",
    withdrawTokenSymbol: COLLATERAL,
    owner,
  }), { expectErrorOnFreshOwner: true });
if (close) console.log(`  receive ≈ ${close.receiveTokenAmountUi} ${close.receiveTokenSymbol} · settled PnL ${close.settledPnl}`);
await submitIf("close-position", "er", close?.transactionBase64, keypair);

// ── 9–10. Withdraw — back on the BASE chain ──────────────────────────────────
if (collateralMint) {
  const reqW = await step("9. request-withdrawal — escrow + schedule settlement", () =>
    flash.requestWithdrawal({ owner, tokenMint: collateralMint, amount: "1" }),
    { expectErrorOnFreshOwner: true });
  await submitIf("request-withdrawal", "base", reqW?.transactionBase64, keypair);

  const execW = await step("10. execute-withdrawal — funds land in your wallet", () =>
    flash.executeWithdrawal({ owner, tokenMint: collateralMint }),
    { expectErrorOnFreshOwner: true });
  await submitIf("execute-withdrawal", "base", execW?.transactionBase64, keypair);
}

console.log(`\n${SUBMIT ? "Lifecycle complete." : "Dry run complete — every endpoint exercised, nothing signed."}`);
console.log("Next: examples/tap-trade for the speed demo, GOTCHAS.md for the sharp edges.");
