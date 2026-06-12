// ─────────────────────────────────────────────────────────────────────────────
// copy-trade — mirror a leader wallet's positions, non-custodially.
// THE HARD PARTS: there is no "trades feed" — you DIFF consecutive owner
// snapshots into events; you size by COLLATERAL RATIO (never copy raw size,
// that's how followers get over-leveraged); and the follower signs their own
// transactions — nobody ever holds their keys. Dry-run by default.
// GOTCHAS.md → §9 WS frames · §16 the $11 rule · §4 the 97% close threshold
// ─────────────────────────────────────────────────────────────────────────────
//
//   LEADER=<pubkey> bun run dev                 # dry-run: print mirrored intents
//   LEADER=<pubkey> FOLLOWER_KEYPAIR=~/.config/solana/mainnet.json \
//     bun run dev -- --execute                  # mainnet: follower signs + submits
//
// Architecture (one screen):
//   subscribeOwner(LEADER) ──▶ diff(prev, next) ──▶ events: OPEN / GROW / SHRINK / CLOSE
//        events × (follower_collateral / leader_collateral) ──▶ trade-builder calls
//        dry-run prints them · --execute signs with the FOLLOWER's key → ER RPC

import { Keypair } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import {
  FlashV2Client,
  subscribeOwner,
  signAndSend,
  RECOMMENDED_MIN_COLLATERAL_USD,
  type BasketSnapshot,
  type PositionMetrics,
  type TradeType,
} from "flash-v2";

// ── Config ───────────────────────────────────────────────────────────────────
const LEADER = process.env.LEADER ?? "";
const EXECUTE = process.argv.includes("--execute");
const MAX_FOLLOW_USD = Number(process.env.MAX_FOLLOW_USD ?? "100"); // hard cap per mirror
const RATIO_OVERRIDE = process.env.RATIO ? Number(process.env.RATIO) : undefined;

if (!LEADER) {
  console.log("copy-trade needs LEADER=<wallet pubkey to mirror>.");
  console.log("Tip: any wallet with live V2 positions works. Dry-run prints intents only.");
  process.exit(1);
}

const flash = new FlashV2Client();

const followerKeypair = (() => {
  if (!EXECUTE) return undefined;
  const p = process.env.FOLLOWER_KEYPAIR;
  if (!p) throw new Error("--execute needs FOLLOWER_KEYPAIR (THROWAWAY wallet — real funds, keep it small)");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
})();
const follower = followerKeypair?.publicKey.toBase58();

// ── 1. Diffing: snapshots → events ───────────────────────────────────────────
// A position is keyed by market+side (V2 allows one long + one short per market).
type PosKey = string;
const keyOf = (p: PositionMetrics): PosKey => `${p.marketSymbol}:${p.sideUi.toUpperCase()}`;

interface MirrorEvent {
  kind: "OPEN" | "GROW" | "SHRINK" | "CLOSE";
  market: string;
  side: TradeType;
  deltaUsd: number;       // size change, USD notional
  leverage: number;       // leader's current leverage (for OPEN/GROW)
  leaderCollateralUsd: number;
}

function diff(prev: BasketSnapshot | undefined, next: BasketSnapshot): MirrorEvent[] {
  const events: MirrorEvent[] = [];
  const before = new Map<PosKey, PositionMetrics>(
    Object.values(prev?.positionMetrics ?? {}).map((p) => [keyOf(p), p]),
  );
  const after = new Map<PosKey, PositionMetrics>(
    Object.values(next.positionMetrics).map((p) => [keyOf(p), p]),
  );

  for (const [k, now] of after) {
    const was = before.get(k);
    const side = now.sideUi.toUpperCase() as TradeType;
    const sizeNow = Number(now.sizeUsdUi);
    const lev = Number.parseFloat(now.leverageUi) || 1;
    const col = Number(now.collateralUsdUi);
    if (!was) {
      events.push({ kind: "OPEN", market: now.marketSymbol, side, deltaUsd: sizeNow, leverage: lev, leaderCollateralUsd: col });
    } else {
      const deltaUsd = sizeNow - Number(was.sizeUsdUi);
      if (Math.abs(deltaUsd) > 0.01) {
        events.push({
          kind: deltaUsd > 0 ? "GROW" : "SHRINK",
          market: now.marketSymbol, side, deltaUsd: Math.abs(deltaUsd), leverage: lev, leaderCollateralUsd: col,
        });
      }
    }
  }
  for (const [k, was] of before) {
    if (!after.has(k)) {
      events.push({
        kind: "CLOSE", market: was.marketSymbol,
        side: was.sideUi.toUpperCase() as TradeType,
        deltaUsd: Number(was.sizeUsdUi), leverage: 1, leaderCollateralUsd: Number(was.collateralUsdUi),
      });
    }
  }
  return events;
}

// ── 2. Sizing: collateral ratio, never raw size — ONE function, both modes ───
async function followerCollateralUsd(): Promise<number> {
  if (!follower) return 0;
  const snap = await flash.owner(follower);
  // Free collateral approximation for the demo: sum of position collateral.
  // A production copier would track its deposit-ledger balance too.
  return Object.values(snap.positionMetrics).reduce((s, p) => s + Number(p.collateralUsdUi), 0);
}

/** Identical sizing for dry-run and execute. Dry-run without a follower wallet
 *  assumes ratio 1 and SAYS SO — the printed intent must match what execute
 *  would do, or the dry-run is a lie. */
function sizeFor(e: MirrorEvent, followerColUsd: number | undefined): { usd: number; label: string } {
  const ratio =
    RATIO_OVERRIDE ??
    (followerColUsd === undefined
      ? 1 // dry-run with no follower configured — labeled as assumed below
      : e.leaderCollateralUsd > 0 && followerColUsd > 0
        ? followerColUsd / e.leaderCollateralUsd
        : 0); // unknown leader collateral or broke follower → mirror nothing
  const usd = Math.min(e.deltaUsd * ratio, MAX_FOLLOW_USD); // hard cap — never YOLO a whale's size
  const label =
    RATIO_OVERRIDE !== undefined ? `ratio ${RATIO_OVERRIDE} (RATIO env)` :
    followerColUsd === undefined ? "ratio 1 (ASSUMED — set FOLLOWER_KEYPAIR for real sizing)" :
    `ratio ${ratio.toFixed(3)} (collateral ${followerColUsd.toFixed(2)}/${e.leaderCollateralUsd.toFixed(2)})`;
  return { usd, label };
}

// ── 3. Replay: build → (dry-print | follower signs → ER) ─────────────────────
async function replay(e: MirrorEvent) {
  const followerCol = EXECUTE ? await followerCollateralUsd() : undefined;
  const { usd, label } = sizeFor(e, followerCol);
  const stamp = new Date().toISOString().slice(11, 19);

  if (e.kind === "OPEN" || e.kind === "GROW") {
    // GOTCHAS §16: collateral below ~$11 can't take TP/SL — but FLOORING the
    // collateral while keeping leader leverage would INFLATE the position
    // (e.g. a $5 mirror becoming $55). Too small to mirror honestly → skip.
    const collateral = usd / e.leverage;
    if (collateral < RECOMMENDED_MIN_COLLATERAL_USD) {
      console.log(`[${stamp}] SKIP ${e.kind} ${e.side} ${e.market} — mirror too small ($${collateral.toFixed(2)} collateral < $${RECOMMENDED_MIN_COLLATERAL_USD} floor; raise MAX_FOLLOW_USD/RATIO or accept skipping)`);
      return;
    }
    console.log(`[${stamp}] ${e.kind} ${e.side} ${e.market} — leader Δ$${e.deltaUsd.toFixed(2)} → mirror $${usd.toFixed(2)} (${collateral.toFixed(2)} USDC × ${e.leverage}x) · ${label}`);
    if (!EXECUTE || !followerKeypair || !follower) return console.log("           dry-run: not signed (set FOLLOWER_KEYPAIR + --execute)");
    const built = await flash.openPosition({
      inputTokenSymbol: "USDC", outputTokenSymbol: e.market,
      inputAmountUi: collateral.toFixed(2), leverage: e.leverage,
      tradeType: e.side, orderType: "MARKET", owner: follower, slippagePercentage: "0.8", // wider than leader — you fill later
    });
    if (built.transactionBase64) {
      const { signature, confirmMs } = await signAndSend(flash.network.erRpc, built.transactionBase64, followerKeypair);
      console.log(`           ⛓ mirrored in ${confirmMs}ms → ${signature}`);
    }
  } else {
    // SHRINK/CLOSE: close proportionally. CLOSE sends "0" = full (GOTCHAS §4/§18).
    const closeUsd = e.kind === "CLOSE" ? "0" : usd.toFixed(2);
    console.log(`[${stamp}] ${e.kind} ${e.side} ${e.market} — leader Δ$${e.deltaUsd.toFixed(2)} → close ${closeUsd === "0" ? "ALL" : "$" + closeUsd}`);
    if (!EXECUTE || !followerKeypair || !follower) return console.log("           dry-run: not signed");
    const built = await flash.closePosition({
      marketSymbol: e.market, side: e.side, inputUsdUi: closeUsd,
      withdrawTokenSymbol: "USDC", owner: follower,
    });
    if (built.transactionBase64) {
      const { signature, confirmMs } = await signAndSend(flash.network.erRpc, built.transactionBase64, followerKeypair);
      console.log(`           ⛓ mirrored in ${confirmMs}ms → ${signature}`);
    }
  }
}

// ── Main: stream the leader, diff every basket frame ─────────────────────────
console.log(`copy-trade on ${flash.network.name} — leader ${LEADER}`);
console.log(EXECUTE ? `EXECUTE mode — follower ${follower} signs its own txs (mainnet)` : "DRY-RUN — printing mirror intents only");
console.log("waiting for leader activity (diffing basket frames)…\n");

let prev: BasketSnapshot | undefined;

// RE-ENTRANCY: onUpdate is NOT awaited by the stream — frames can arrive while
// a replay is mid-flight, and two concurrent replay loops would double-mirror.
// We COALESCE instead of dropping: remember only the LATEST basket frame and
// diff against it when the current loop finishes. Intermediate states collapse
// into net deltas, which is exactly what a mirror wants.
let processing = false;
let queued: BasketSnapshot | undefined;

async function onBasketFrame(snap: BasketSnapshot) {
  if (processing) { queued = snap; return; }
  processing = true;
  try {
    let next: BasketSnapshot | undefined = snap;
    while (next) {
      const events = diff(prev, next);
      prev = structuredClone(next);
      for (const e of events) {
        try { await replay(e); } catch (err) { console.log(`! mirror failed: ${(err as Error).message}`); }
      }
      next = queued;
      queued = undefined;
    }
  } finally {
    processing = false;
  }
}

subscribeOwner({
  owner: LEADER,
  network: flash.network,
  onUpdate: (snap, source) => {
    // Only `basket` frames are settlement truth (GOTCHAS §8-9); `metrics`
    // frames re-price the SAME position every second and would spam GROW/SHRINK.
    if (source === "metrics") return;
    void onBasketFrame(snap);
  },
  onStatus: (s) => console.log(`(stream: ${s})`),
});
