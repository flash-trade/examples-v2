// ─────────────────────────────────────────────────────────────────────────────
// lib/stream.tsx — ONE owner stream for the whole app, shared via context.
// THE HARD PART: the WS caps at 5 connections per owner (429) — per-component
// subscriptions are how you hit it. One subscribeOwner lives here; everything
// reads through useStream(). flash-v2 merges basket+metrics frames and falls
// back to polling for us. GOTCHAS.md → "WS connection limits are real" ·
// "The WS sends two frame types" (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { subscribeOwner, type BasketSnapshot, type OwnerStream } from "flash-v2";
import { flash } from "./flash";

export type StreamStatus = "connecting" | "open" | "reconnecting" | "polling" | "closed";

export interface StreamCtx {
  snapshot: BasketSnapshot | null;
  loaded: boolean;
  status: StreamStatus;
  refresh(): Promise<void>;
}

const StreamContext = createContext<StreamCtx>({
  snapshot: null,
  loaded: false,
  status: "closed",
  refresh: async () => {},
});

export function StreamProvider({ owner, children }: { owner: string | null; children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<BasketSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<StreamStatus>("closed");
  const streamRef = useRef<OwnerStream | null>(null);

  useEffect(() => {
    setSnapshot(null);
    setLoaded(false);
    if (!owner) {
      setStatus("closed");
      return;
    }
    setStatus("connecting");
    const stream = subscribeOwner({
      owner,
      network: flash.network,
      onUpdate: (snap) => {
        setSnapshot(snap);
        setLoaded(true);
      },
      onStatus: (s) => setStatus(s),
    });
    streamRef.current = stream;
    return () => {
      stream.close();
      streamRef.current = null;
    };
  }, [owner]);

  const value = useMemo<StreamCtx>(
    () => ({
      snapshot,
      loaded,
      status,
      refresh: async () => {
        if (!owner) return;
        const snap = await flash.owner(owner);
        setSnapshot(snap);
        setLoaded(true);
      },
    }),
    [snapshot, loaded, status, owner],
  );

  return <StreamContext.Provider value={value}>{children}</StreamContext.Provider>;
}

export function useStream(): StreamCtx {
  return useContext(StreamContext);
}
