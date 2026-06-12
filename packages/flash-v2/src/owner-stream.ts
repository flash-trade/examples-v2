// ─────────────────────────────────────────────────────────────────────────────
// owner-stream.ts — live positions/orders over WebSocket, merged correctly.
// THE HARD PART: the stream sends TWO frame types. `basket` = the full
// snapshot (positions + orders + raw bytes) on real on-chain changes;
// `metrics` = positions-only refreshes on every oracle tick. You must fold
// metrics INTO the last basket or your orders/basketData go stale. Limits:
// 5 connections per owner (HTTP 429) — share one. GOTCHAS.md → "WS frames"
// ─────────────────────────────────────────────────────────────────────────────

import type { NetworkConfig } from "./network.ts";
import { resolveNetwork } from "./network.ts";
import type { BasketSnapshot, OwnerWsMessage, PositionMetrics } from "./types.ts";

export interface OwnerStreamOptions {
  /** Wallet pubkey to stream. */
  owner: string;
  /** Network (defaults to mainnet / env). */
  network?: NetworkConfig;
  /** Metrics refresh cadence, ms (server clamps 100–10000; shared per owner). */
  updateIntervalMs?: number;
  /** Called with the MERGED snapshot on every update (basket or metrics). */
  onUpdate: (snapshot: BasketSnapshot, source: "basket" | "metrics" | "poll") => void;
  /** Optional: connection lifecycle + error visibility. */
  onStatus?: (status: "connecting" | "open" | "reconnecting" | "polling" | "closed", detail?: string) => void;
}

export interface OwnerStream {
  /** Latest merged snapshot (undefined until the first frame). */
  readonly current: BasketSnapshot | undefined;
  /** Stop the stream and any fallback polling. */
  close(): void;
}

/**
 * Subscribe to `/v2/owner/{owner}/ws` with reconnect + polling fallback.
 *
 * Behavior:
 *  1. WS connect → first `basket` frame is your base state.
 *  2. `metrics` frames are FOLDED into that state (positions refresh ~1s).
 *  3. Drops reconnect with backoff (1s/2s/4s). After 3 failures we fall back
 *     to polling GET /v2/owner every 5s and retry the WS every 30s.
 *
 * @example
 * const stream = subscribeOwner({
 *   owner,
 *   onUpdate: (snap, src) => render(snap.positionMetrics, src),
 * });
 * // later: stream.close()
 */
export function subscribeOwner(opts: OwnerStreamOptions): OwnerStream {
  const network = opts.network ?? resolveNetwork();
  const wsBase = network.apiBase.replace(/^http/, "ws");
  const interval = opts.updateIntervalMs ?? 1000;
  const url = `${wsBase}/owner/${opts.owner}/ws?updateIntervalMs=${interval}`;

  let current: BasketSnapshot | undefined;
  let ws: WebSocket | undefined;
  let closed = false;
  let attempts = 0;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let wsRetryTimer: ReturnType<typeof setTimeout> | undefined;

  const emit = (source: "basket" | "metrics" | "poll") => {
    if (current) opts.onUpdate(current, source);
  };

  const mergeMetrics = (metrics: Record<string, PositionMetrics>) => {
    if (!current) return; // metrics before any basket frame — nothing to merge into
    // FOLD metrics INTO the basket's position set — don't replace it. A metrics
    // frame REFRESHES the numbers for positions the latest `basket` frame
    // established; it must NEVER introduce a position the basket doesn't have.
    // The indexer computes metrics from its own basket view, which lags an
    // on-chain close by a tick or two — without this guard a stale metrics frame
    // resurrects a just-closed position (the close → pop-back flicker).
    const live = current.positionMetrics ?? {};
    const refreshed: Record<string, PositionMetrics> = {};
    for (const [key, value] of Object.entries(live)) refreshed[key] = metrics[key] ?? value;
    current = { ...current, positionMetrics: refreshed };
  };

  const stopPolling = () => {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined; }
  };

  const startPolling = () => {
    if (closed) return;
    if (!pollTimer) {
      opts.onStatus?.("polling", "WS unavailable — polling /owner every 5s");
      const poll = async () => {
        try {
          const res = await fetch(`${network.apiBase}/owner/${opts.owner}`);
          if (res.ok) {
            current = (await res.json()) as BasketSnapshot;
            emit("poll");
          }
        } catch { /* keep polling; the WS retry below recovers us */ }
      };
      void poll();
      pollTimer = setInterval(poll, 5_000);
    }
    // ALWAYS re-arm the real-time recovery — a failed retry must schedule the
    // next one, or one bad WS window degrades to polling FOREVER (audit find).
    if (wsRetryTimer) clearTimeout(wsRetryTimer);
    wsRetryTimer = setTimeout(() => { attempts = 0; connect(); }, 30_000);
  };

  const connect = () => {
    if (closed) return;
    opts.onStatus?.(attempts === 0 ? "connecting" : "reconnecting", url);
    ws = new WebSocket(url);

    ws.onopen = () => {
      attempts = 0;
      stopPolling();
      if (wsRetryTimer) { clearTimeout(wsRetryTimer); wsRetryTimer = undefined; }
      opts.onStatus?.("open");
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(String(event.data)) as OwnerWsMessage;
        if (msg.type === "basket") {
          current = msg.data;          // full state — new base
          emit("basket");
        } else if (msg.type === "metrics") {
          mergeMetrics(msg.data);      // positions-only — fold into base
          emit("metrics");
        }
      } catch { /* ignore non-JSON frames */ }
    };

    ws.onclose = () => {
      if (closed) return;
      attempts += 1;
      if (attempts <= 3) {
        setTimeout(connect, 1000 * 2 ** (attempts - 1)); // 1s, 2s, 4s
      } else {
        startPolling();
      }
    };

    ws.onerror = () => { ws?.close(); };
  };

  connect();

  return {
    get current() { return current; },
    close() {
      closed = true;
      stopPolling();
      if (wsRetryTimer) clearTimeout(wsRetryTimer);
      ws?.close();
      opts.onStatus?.("closed");
    },
  };
}
