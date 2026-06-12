// ─────────────────────────────────────────────────────────────────────────────
// components/trade-sheet.tsx — the trade template: size presets + a leverage
// control that mirrors Flash Trade's real product: slider + free numeric input
// + quarter-mark chips, all clamped to the LIVE per-market limits from the
// custody config (useMarketLimits via app.tsx — never a hardcoded max).
// No silent presets: size and leverage start EMPTY; the SHORT/LONG pair stays
// un-armed until the user explicitly sets both.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useState } from "react";
import Sheet from "@/components/sheet";
import { fmtUsd } from "@/lib/format";
import type { MarketLimits } from "@/lib/hooks";

export interface TradeTemplate {
  sizeUsd: string;
  leverage: string;
  slippage: string;
  // TP/SL kept in shape for backward compat with signer.ts — always off
  tpOn: boolean;
  tpPct: string;
  slOn: boolean;
  slPct: string;
}

// No silent presets: size and leverage start EMPTY — the user explicitly
// chooses both in this sheet before the SHORT/LONG pair arms. Preset chips
// below still set a value in one tap; the point is explicit choice, not friction.
export const DEFAULT_TEMPLATE: TradeTemplate = {
  sizeUsd: "",
  leverage: "",
  slippage: "0.5",
  tpOn: false,
  tpPct: "10",
  slOn: false,
  slPct: "5",
};

const SIZE_CHIPS = ["11", "25", "50", "100"];

export function leverageOf(t: TradeTemplate): number {
  const n = Number(t.leverage);
  // 0 = unset (the zero-preset rule) — callers gate on it; no phantom 5×.
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

function Field({
  label,
  value,
  suffix,
  onChange,
}: {
  label: string;
  value: string;
  suffix?: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-[3px] border border-edge bg-panel px-3.5 py-2.5 transition-colors focus-within:border-long/45">
      <span className="text-xs text-dim">{label}</span>
      <span className="flex items-center gap-1">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1"))}
          placeholder="0"
          inputMode="decimal"
          className="w-16 bg-transparent text-right font-mono text-sm tabular-nums text-ink outline-none placeholder:text-faint"
        />
        {suffix && <span className="font-mono text-xs text-faint">{suffix}</span>}
      </span>
    </label>
  );
}

export default function TradeSheet({
  open,
  onClose,
  template,
  onTemplate,
  feeUsd,
  limits,
}: {
  open: boolean;
  onClose: () => void;
  template: TradeTemplate;
  onTemplate: (t: TradeTemplate) => void;
  /** Live entry-fee preview (UI USD string) — null until the quote lands. */
  feeUsd: string | null;
  /** LIVE per-market leverage bounds (useMarketLimits) — null while loading. */
  limits: MarketLimits | null;
}) {
  const set = (patch: Partial<TradeTemplate>) => onTemplate({ ...template, ...patch });

  // ── leverage: Flash Trade's real UX — 25/50/75/100 chips + a DEGEN switch ───
  // Normal mode covers 1.1→100×; Degen (when the market allows >100×) covers
  // 125→500×, exactly like Flash's UI. Custody maxInitialLeverage carries a
  // ×1.1 buffer over the advertised cap (550 raw → 500 advertised).
  const levNum = Number(template.leverage);
  const levSet = Number.isFinite(levNum) && levNum > 0;
  const minL = limits?.minLeverage ?? null;
  const advertisedMax = limits ? Math.round(limits.maxLeverage / 1.1) : null;
  const normalCap = advertisedMax !== null ? Math.min(100, advertisedMax) : null;
  const degenCap = advertisedMax !== null ? Math.min(500, advertisedMax) : null;
  const degenAvailable = advertisedMax !== null && advertisedMax > 100;

  const [degen, setDegen] = useState(false);
  // A value above the normal cap (e.g. restored template) implies degen mode.
  useEffect(() => {
    if (levSet && normalCap !== null && levNum > normalCap && !degen) setDegen(true);
  }, [levSet, levNum, normalCap, degen]);

  const DEGEN_FLOOR = 125;
  const modeMin = degen ? DEGEN_FLOOR : (minL ?? 1.1);
  const modeMax = degen ? (degenCap ?? 500) : (normalCap ?? 100);
  const span = Math.max(modeMax - modeMin, 0.1);
  const sliderValue = levSet ? Math.min(modeMax, Math.max(modeMin, levNum)) : modeMin;
  const fillPct = levSet ? ((sliderValue - modeMin) / span) * 100 : 0;

  const setLev = (v: number) => set({ leverage: String(round1(v)) });

  // The HUMAN input contract: type anything, delete to empty, nothing fights
  // your keystrokes — the value clamps to the active mode's range ON BLUR only.
  const onLevType = (raw: string) => {
    const cleaned = raw.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
    set({ leverage: cleaned });
  };
  const clampLev = () => {
    if (!limits) return;
    if (template.leverage.trim() === "") return; // empty stays empty (zero-preset rule)
    if (!Number.isFinite(levNum) || levNum <= 0) {
      set({ leverage: "" });
      return;
    }
    setLev(Math.min(modeMax, Math.max(modeMin, levNum)));
  };

  const toggleDegen = (on: boolean) => {
    setDegen(on);
    if (on) {
      // Degen starts at 125× (Flash's floor for the mode); empty stays a choice.
      if (!levSet || levNum < DEGEN_FLOOR) setLev(DEGEN_FLOOR);
    } else if (levSet && normalCap !== null && levNum > normalCap) {
      setLev(normalCap);
    }
  };

  // Flash's own chip ladder per mode (filtered to what this market allows).
  const NORMAL_CHIPS = [25, 50, 75, 100];
  const DEGEN_CHIPS = [125, 250, 375, 500];
  const marks = limits
    ? (degen ? DEGEN_CHIPS : NORMAL_CHIPS).filter((m) => m <= modeMax + 1e-9)
    : null;

  return (
    <Sheet open={open} onClose={onClose} label="trade setup">
      <div className="grid grid-cols-[1fr_auto] items-baseline">
        <p className="font-display text-[15px] font-semibold text-ink">Trade setup</p>
        <p className="font-mono text-[11px] tabular-nums text-dim">
          fee {feeUsd === null ? "—" : fmtUsd(feeUsd)}
        </p>
      </div>

      {/* size — presets and the free input are equal citizens */}
      <div className="mt-4 flex items-center gap-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">size</span>
        <span className="h-px flex-1 bg-edge" aria-hidden />
        <span className="font-mono text-xs tabular-nums text-ink">
          {(Number(template.sizeUsd) || 0) > 0 ? `$${template.sizeUsd}` : "—"}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {SIZE_CHIPS.map((s) => (
          <button
            key={s}
            onClick={() => set({ sizeUsd: s })}
            aria-pressed={template.sizeUsd === s}
            className={`rounded-[3px] border py-2.5 font-mono text-sm tabular-nums transition-colors active:scale-[0.99] ${
              template.sizeUsd === s
                ? "border-long/60 bg-long/10 text-long"
                : "border-edge bg-panel text-dim hover:border-edge2"
            }`}
          >
            ${s}
          </button>
        ))}
      </div>
      <div className="mt-1.5">
        <Field label="custom size" value={template.sizeUsd} suffix="USDC" onChange={(v) => set({ sizeUsd: v })} />
      </div>

      {/* leverage — Flash's UX: slider + 25/50/75/100 chips + degen switch */}
      <div className="mt-4 flex items-center gap-2.5">
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
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${degen ? "bg-short" : "bg-edge2"}`}
              aria-hidden
            />
            degen
          </button>
        )}
        <span className="font-mono text-xs tabular-nums text-ink">{levSet ? `${template.leverage}×` : "—"}</span>
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
              className={`rounded-[3px] border py-2.5 font-mono text-sm tabular-nums transition-colors active:scale-[0.99] ${
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
              value={template.leverage}
              onChange={(e) => onLevType(e.target.value)}
              onBlur={clampLev}
              placeholder="0"
              inputMode="decimal"
              disabled={!limits}
              className="w-16 bg-transparent text-right font-mono text-sm tabular-nums text-ink outline-none placeholder:text-faint disabled:opacity-35"
            />
            <span className="font-mono text-xs text-faint">×</span>
          </span>
        </label>
      </div>

      <button
        onClick={onClose}
        className="mt-5 h-11 w-full rounded-md bg-long text-[13px] font-bold text-bg transition-transform active:scale-[0.99]"
      >
        Set
      </button>
    </Sheet>
  );
}
