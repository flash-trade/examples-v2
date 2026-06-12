// ─────────────────────────────────────────────────────────────────────────────
// lib/copy-engine.ts — the copy loop, browser-side and non-custodial.
//
// THE HARD PARTS (all carried over from the CLI, now live in a hook):
//  1. There is NO "trades feed" — you DIFF consecutive `basket` frames of the
//     leader's owner stream into events: OPEN / GROW / SHRINK / CLOSE.
//  2. You size by COLLATERAL RATIO (follower collateral ÷ leader collateral),
//     never raw size — that is how a small follower copying a whale gets
//     instantly liquidated. Then a hard per-trade cap and a budget ceiling.
//  3. The follower signs their OWN mirror txs with their OWN session key — the
//     app never holds keys and never moves funds outside an explicit trade.
//  4. metrics frames re-price the SAME position every ~250ms; only `basket`
//     frames are settlement truth, so we diff ONLY basket frames (GOTCHAS §9).
//  5. The $11-after-fees floor (GOTCHAS §16): a mirror whose collateral lands
//     below the floor is SKIPPED and SAID SO — never silently up-sized.
//
// Default mode is MANUAL: every event becomes a one-tap "mirror this?" card.
// AUTO is opt-in, armed, and bounded by the budget + per-trade cap + kill switch.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  subscribeOwner,
  RECOMMENDED_MIN_COLLATERAL_USD,
  type BasketSnapshot,
  type PositionMetrics,
  type TradeType,
} from "flash-v2";
import { flash } from "./flash";
import type { ActiveSigner } from "./signer";

// ── events ─────────────────────────────────────────────────────────────────
export type MirrorKind = "OPEN" | "GROW" | "SHRINK" | "CLOSE";

export interface MirrorEvent {
  id: string;
  at: number;
  kind: MirrorKind;
  market: string;
  side: TradeType;
  /** leader size change, USD notional */
  deltaUsd: number;
  /** leader's current leverage (OPEN/GROW) */
  leverage: number;
  leaderCollateralUsd: number;
}

/** A position is keyed market+side (V2 allows one long + one short per market). */
const keyOf = (p: PositionMetrics): string => `${p.marketSymbol}:${p.sideUi.toUpperCase()}`;

/** Diff two leader snapshots into mirror events. Pure — also unit-testable. */
export function diffPositions(prev: BasketSnapshot | undefined, next: BasketSnapshot): Omit<MirrorEvent, "id" | "at">[] {
  const out: Omit<MirrorEvent, "id" | "at">[] = [];
  const before = new Map(Object.values(prev?.positionMetrics ?? {}).map((p) => [keyOf(p), p]));
  const after = new Map(Object.values(next.positionMetrics ?? {}).map((p) => [keyOf(p), p]));

  for (const [k, now] of after) {
    const was = before.get(k);
    const side = now.sideUi.toUpperCase() as TradeType;
    const sizeNow = Number(now.sizeUsdUi);
    const lev = Number.parseFloat(now.leverageUi) || 1;
    const col = Number(now.collateralUsdUi);
    if (!was) {
      out.push({ kind: "OPEN", market: now.marketSymbol, side, deltaUsd: sizeNow, leverage: lev, leaderCollateralUsd: col });
    } else {
      const delta = sizeNow - Number(was.sizeUsdUi);
      if (Math.abs(delta) > 0.01) {
        out.push({
          kind: delta > 0 ? "GROW" : "SHRINK",
          market: now.marketSymbol, side, deltaUsd: Math.abs(delta), leverage: lev, leaderCollateralUsd: col,
        });
      }
    }
  }
  for (const [k, was] of before) {
    if (!after.has(k)) {
      out.push({
        kind: "CLOSE", market: was.marketSymbol, side: was.sideUi.toUpperCase() as TradeType,
        deltaUsd: Number(was.sizeUsdUi), leverage: 1, leaderCollateralUsd: Number(was.collateralUsdUi),
      });
    }
  }
  return out;
}

// ── sizing ───────────────────────────────────────────────────────────────────
export interface CopyConfig {
  /** manual = surface a card per event; auto = execute when armed + in budget. */
  mode: "manual" | "auto";
  /** auto is only live while this is true (the arm toggle). */
  armed: boolean;
  /** total USD the copier may ever deploy this session (budget ceiling). */
  budgetUsd: number;
  /** hard cap on any single mirror's notional. */
  maxPerTradeUsd: number;
  /** optional fixed ratio override; otherwise collateral ratio is used. */
  ratioOverride?: number;
}

export interface SizedMirror {
  /** follower collateral to post (USDC), null if this is a close. */
  collateralUsd: number | null;
  /** mirror notional USD (size). */
  sizeUsd: number;
  /** "0" full close, a USD string for partial, or null for opens. */
  closeUsdUi: string | null;
  ratio: number;
  /** present when the mirror can't be placed honestly — show, don't execute. */
  skip?: string;
}

/** Size one event. Identical math for the preview card and the executed trade. */
export function sizeMirror(
  e: Pick<MirrorEvent, "kind" | "deltaUsd" | "leverage" | "leaderCollateralUsd">,
  cfg: CopyConfig,
  followerCollateralUsd: number,
  spentUsd: number,
): SizedMirror {
  const ratio =
    cfg.ratioOverride ??
    (e.leaderCollateralUsd > 0 && followerCollateralUsd > 0 ? followerCollateralUsd / e.leaderCollateralUsd : 0);

  if (e.kind === "CLOSE") {
    return { collateralUsd: null, sizeUsd: e.deltaUsd * ratio, closeUsdUi: "0", ratio };
  }
  if (e.kind === "SHRINK") {
    const usd = Math.min(e.deltaUsd * ratio, cfg.maxPerTradeUsd);
    return { collateralUsd: null, sizeUsd: usd, closeUsdUi: usd.toFixed(2), ratio };
  }

  // OPEN / GROW
  const budgetLeft = Math.max(0, cfg.budgetUsd - spentUsd);
  const sizeUsd = Math.min(e.deltaUsd * ratio, cfg.maxPerTradeUsd, budgetLeft * e.leverage);
  const collateralUsd = sizeUsd / (e.leverage || 1);
  if (ratio <= 0) return { collateralUsd, sizeUsd, closeUsdUi: null, ratio, skip: "deposit USDC to copy" };
  if (budgetLeft <= 0) return { collateralUsd, sizeUsd, closeUsdUi: null, ratio, skip: "budget used up" };
  // FLOORING collateral while keeping leader leverage would inflate the mirror
  // (a $4 copy becoming $44) — too small to mirror honestly, so skip + say so.
  if (collateralUsd < RECOMMENDED_MIN_COLLATERAL_USD) {
    return { collateralUsd, sizeUsd, closeUsdUi: null, ratio, skip: `too small to copy (min $${RECOMMENDED_MIN_COLLATERAL_USD})` };
  }
  return { collateralUsd, sizeUsd, closeUsdUi: null, ratio };
}

// ── live fills ────────────────────────────────────────────────────────────────
export interface MirrorFill {
  id: string;
  at: number;
  event: MirrorEvent;
  sized: SizedMirror;
  status: "executing" | "done" | "skipped" | "error";
  signature?: string;
  confirmMs?: number;
  note?: string;
}

export type EngineStatus = "idle" | "connecting" | "live" | "reconnecting" | "polling" | "stopped";

export interface CopyEngineState {
  status: EngineStatus;
  /** the leader's current live positions (rendered as their open book). */
  leaderPositions: PositionMetrics[];
  /** newest first — every event we surfaced (pending manual cards + history). */
  pending: { event: MirrorEvent; sized: SizedMirror }[];
  fills: MirrorFill[];
  spentUsd: number;
}

let _seq = 0;
const uid = () => `${++_seq}`;

/**
 * The copy engine. Streams `leader`, diffs basket frames, and either queues a
 * one-tap mirror (manual) or executes it with the follower's session signer
 * (auto, armed, in budget). `kill()` stops the stream and clears the queue.
 */
export function useCopyEngine(args: {
  leader: string | null;
  signer: ActiveSigner | null;
  followerCollateralUsd: number;
  config: CopyConfig;
}): CopyEngineState & {
  confirm: (eventId: string) => void;
  dismiss: (eventId: string) => void;
} {
  const { leader, signer, followerCollateralUsd, config } = args;
  const [state, setState] = useState<CopyEngineState>({
    status: "idle",
    leaderPositions: [],
    pending: [],
    fills: [],
    spentUsd: 0,
  });

  // refs so the stream callback always sees the latest config/signer/collateral
  const cfgRef = useRef(config);
  cfgRef.current = config;
  const signerRef = useRef(signer);
  signerRef.current = signer;
  const colRef = useRef(followerCollateralUsd);
  colRef.current = followerCollateralUsd;
  const spentRef = useRef(0);

  // ── execute one sized mirror against the follower's account ────────────────
  const execute = useCallback(async (event: MirrorEvent, sized: SizedMirror) => {
    const sg = signerRef.current;
    const fillId = uid();
    if (!sg) return;
    const startFill: MirrorFill = { id: fillId, at: Date.now(), event, sized, status: "executing" };
    setState((s) => ({ ...s, fills: [startFill, ...s.fills].slice(0, 60) }));
    const patch = (p: Partial<MirrorFill>) =>
      setState((s) => ({ ...s, fills: s.fills.map((f) => (f.id === fillId ? { ...f, ...p } : f)) }));
    try {
      if (event.kind === "OPEN" || event.kind === "GROW") {
        const built = await flash.openPosition({
          inputTokenSymbol: "USDC", outputTokenSymbol: event.market,
          inputAmountUi: (sized.collateralUsd ?? 0).toFixed(2), leverage: event.leverage,
          tradeType: event.side, orderType: "MARKET", owner: sg.owner,
          slippagePercentage: "0.8", // wider than the leader — you fill a beat later
          ...sg.tradeFields,
        });
        if (!built.transactionBase64) throw new Error("no transaction from open-position");
        const { signature, confirmMs } = await sg.sendTrade(built.transactionBase64);
        spentRef.current += sized.collateralUsd ?? 0;
        setState((s) => ({ ...s, spentUsd: spentRef.current }));
        patch({ status: "done", signature, confirmMs });
      } else {
        const built = await flash.closePosition({
          marketSymbol: event.market, side: event.side,
          inputUsdUi: sized.closeUsdUi ?? "0", withdrawTokenSymbol: "USDC", owner: sg.owner,
          ...sg.tradeFields,
        });
        if (!built.transactionBase64) throw new Error("no transaction from close-position");
        const { signature, confirmMs } = await sg.sendTrade(built.transactionBase64);
        patch({ status: "done", signature, confirmMs });
      }
    } catch (e) {
      patch({ status: "error", note: (e as Error).message });
    }
  }, []);

  // ── route an event: skip · auto-execute · or queue for manual confirm ──────
  const routeEvent = useCallback((raw: Omit<MirrorEvent, "id" | "at">) => {
    const event: MirrorEvent = { ...raw, id: uid(), at: Date.now() };
    const sized = sizeMirror(event, cfgRef.current, colRef.current, spentRef.current);
    if (sized.skip && event.kind !== "CLOSE" && event.kind !== "SHRINK") {
      const skipFill: MirrorFill = { id: uid(), at: Date.now(), event, sized, status: "skipped", note: sized.skip };
      setState((s) => ({ ...s, fills: [skipFill, ...s.fills].slice(0, 60) }));
      return;
    }
    const cfg = cfgRef.current;
    if (cfg.mode === "auto" && cfg.armed && signerRef.current) {
      void execute(event, sized);
    } else {
      setState((s) => ({ ...s, pending: [{ event, sized }, ...s.pending].slice(0, 24) }));
    }
  }, [execute]);

  // ── confirm / dismiss a queued manual mirror ───────────────────────────────
  const confirm = useCallback((eventId: string) => {
    setState((s) => {
      const hit = s.pending.find((p) => p.event.id === eventId);
      if (hit) void execute(hit.event, hit.sized);
      return { ...s, pending: s.pending.filter((p) => p.event.id !== eventId) };
    });
  }, [execute]);
  const dismiss = useCallback((eventId: string) => {
    setState((s) => ({ ...s, pending: s.pending.filter((p) => p.event.id !== eventId) }));
  }, []);

  // ── the leader stream: diff basket frames, coalescing re-entrant frames ────
  useEffect(() => {
    spentRef.current = 0;
    setState({ status: leader ? "connecting" : "idle", leaderPositions: [], pending: [], fills: [], spentUsd: 0 });
    if (!leader) return;

    let prev: BasketSnapshot | undefined;
    let baselined = false;
    let processing = false;
    let queued: BasketSnapshot | undefined;
    let dead = false;

    const onBasket = (snap: BasketSnapshot) => {
      if (dead) return;
      setState((s) => ({ ...s, leaderPositions: Object.values(snap.positionMetrics ?? {}) }));
      if (processing) { queued = snap; return; }
      processing = true;
      let next: BasketSnapshot | undefined = snap;
      while (next) {
        if (!baselined) {
          // Baseline: adopt the leader's CURRENT book without copying it — you
          // don't want to buy a position they're already mid-way through. Copy
          // only their NEXT move from here.
          prev = structuredClone(next);
          baselined = true;
        } else {
          for (const raw of diffPositions(prev, next)) routeEvent(raw);
          prev = structuredClone(next);
        }
        next = queued;
        queued = undefined;
      }
      processing = false;
    };

    const stream = subscribeOwner({
      owner: leader,
      network: flash.network,
      onUpdate: (snap, source) => {
        if (source === "metrics") {
          // refresh the rendered book (live PnL) but never diff metrics frames
          if (!dead) setState((s) => ({ ...s, leaderPositions: Object.values(snap.positionMetrics ?? {}) }));
          return;
        }
        onBasket(snap);
      },
      onStatus: (st) => {
        if (dead) return;
        const map: Record<string, EngineStatus> = { open: "live", connecting: "connecting", reconnecting: "reconnecting", polling: "polling", closed: "stopped" };
        setState((s) => ({ ...s, status: map[st] ?? s.status }));
      },
    });

    return () => { dead = true; stream.close(); };
  }, [leader, routeEvent]);

  return { ...state, confirm, dismiss };
}
