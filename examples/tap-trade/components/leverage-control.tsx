// ─────────────────────────────────────────────────────────────────────────────
// components/leverage-control.tsx — Flash Trade's real leverage UX, reusable:
// slider + 25/50/75/100 chips + DEGEN switch (125–500× when the market allows)
// + a free numeric input. THE HUMAN INPUT CONTRACT: type anything, delete to
// empty, nothing fights keystrokes — clamping happens on BLUR only. Bounds come
// LIVE from useMarketLimits (custody config); never a hardcoded max.
// GOTCHAS.md → (UI only; limits semantics in lib/hooks.ts) (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useState } from "react";
import type { MarketLimits } from "@/lib/hooks";

const round1 = (v: number) => Math.round(v * 10) / 10;
const DEGEN_FLOOR = 125;
const NORMAL_CHIPS = [25, 50, 75, 100];
const DEGEN_CHIPS = [125, 250, 375, 500];

export default function LeverageControl({
  value,
  onChange,
  limits,
  onCommit,
}: {
  /** The template's leverage string ("" = unset, the zero-preset rule). */
  value: string;
  onChange: (leverage: string) => void;
  /** LIVE per-market bounds (useMarketLimits) — null while loading. */
  limits: MarketLimits | null;
  /** Enter in the free input (the terminal advances steps on it). */
  onCommit?: () => void;
}) {
  const levNum = Number(value);
  const levSet = Number.isFinite(levNum) && levNum > 0;
  const minL = limits?.minLeverage ?? null;
  const advertisedMax = limits ? Math.round(limits.maxLeverage / 1.1) : null;
  const normalCap = advertisedMax !== null ? Math.min(100, advertisedMax) : null;
  const degenCap = advertisedMax !== null ? Math.min(500, advertisedMax) : null;
  const degenAvailable = advertisedMax !== null && advertisedMax > 100;

  const [degen, setDegen] = useState(false);
  // A value above the normal cap (restored template) implies degen mode.
  useEffect(() => {
    if (levSet && normalCap !== null && levNum > normalCap && !degen) setDegen(true);
  }, [levSet, levNum, normalCap, degen]);

  const modeMin = degen ? DEGEN_FLOOR : (minL ?? 1.1);
  const modeMax = degen ? (degenCap ?? 500) : (normalCap ?? 100);
  const span = Math.max(modeMax - modeMin, 0.1);
  const sliderValue = levSet ? Math.min(modeMax, Math.max(modeMin, levNum)) : modeMin;
  const fillPct = levSet ? ((sliderValue - modeMin) / span) * 100 : 0;

  const setLev = (v: number) => onChange(String(round1(v)));
  const onType = (raw: string) =>
    onChange(raw.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"));
  const clamp = () => {
    if (!limits || value.trim() === "") return; // empty stays empty
    if (!Number.isFinite(levNum) || levNum <= 0) { onChange(""); return; }
    setLev(Math.min(modeMax, Math.max(modeMin, levNum)));
  };
  const toggleDegen = (on: boolean) => {
    setDegen(on);
    if (on) {
      if (!levSet || levNum < DEGEN_FLOOR) setLev(DEGEN_FLOOR);
    } else if (levSet && normalCap !== null && levNum > normalCap) {
      setLev(normalCap);
    }
  };

  const marks = limits
    ? (degen ? DEGEN_CHIPS : NORMAL_CHIPS).filter((m) => m <= modeMax + 1e-9)
    : null;

  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">leverage</span>
        <span className="h-px flex-1 bg-edge" aria-hidden />
        {degenAvailable && (
          <button
            onClick={() => toggleDegen(!degen)}
            aria-pressed={degen}
            title={degen ? "degen mode on — up to 500×" : "unlock 125–500× (degen mode)"}
            className={`flex items-center gap-1.5 rounded-[3px] border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors active:scale-[0.99] ${
              degen ? "border-short/60 bg-short/10 text-short" : "border-edge text-faint hover:border-edge2 hover:text-dim"
            }`}
          >
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${degen ? "bg-short" : "bg-edge2"}`} aria-hidden />
            degen
          </button>
        )}
        <span className="font-mono text-xs tabular-nums text-ink">{levSet ? `${value}×` : "—"}</span>
      </div>
      <div className="mt-3 px-0.5">
        <input
          type="range"
          aria-label="leverage"
          disabled={!limits}
          min={modeMin}
          max={modeMax}
          step={0.1}
          value={sliderValue}
          onChange={(e) => setLev(Number(e.target.value))}
          className="lev-range w-full"
          style={{
            background: `linear-gradient(to right, ${degen ? "var(--color-short)" : "var(--color-long)"} ${fillPct}%, var(--color-edge2) ${fillPct}%)`,
          }}
        />
        <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-faint">
          <span>{limits ? `${round1(modeMin)}×` : "—"}</span>
          <span>{limits ? `${round1(modeMax)}×` : "—"}</span>
        </div>
      </div>
      {marks ? (
        <div className="mt-1.5 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.max(marks.length, 1)}, minmax(0, 1fr))` }}>
          {marks.map((m) => (
            <button
              key={m}
              onClick={() => setLev(m)}
              aria-pressed={levSet && Math.abs(levNum - m) < 1e-9}
              className={`rounded-[3px] border py-2 font-mono text-sm tabular-nums transition-colors active:scale-[0.99] ${
                levSet && Math.abs(levNum - m) < 1e-9
                  ? degen
                    ? "border-short/60 bg-short/10 text-short"
                    : "border-long/60 bg-long/10 text-long"
                  : "border-edge bg-panel text-dim hover:border-edge2"
              }`}
            >
              {m}×
            </button>
          ))}
        </div>
      ) : (
        <p className="soft-pulse mt-2 font-mono text-[11px] text-faint">loading limits…</p>
      )}
      <div className="mt-1.5">
        <label className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-[3px] border border-edge bg-panel px-3.5 py-2.5 transition-colors focus-within:border-long/45">
          <span className="text-xs text-dim">custom leverage</span>
          <span className="flex items-center gap-1">
            <input
              value={value}
              onChange={(e) => onType(e.target.value)}
              onBlur={clamp}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  clamp();
                  onCommit?.();
                }
              }}
              placeholder="0"
              inputMode="decimal"
              disabled={!limits}
              className="w-16 bg-transparent text-right font-mono text-sm tabular-nums text-ink outline-none placeholder:text-faint disabled:opacity-35"
            />
            <span className="font-mono text-xs text-faint">×</span>
          </span>
        </label>
      </div>
    </div>
  );
}
