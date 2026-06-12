// ─────────────────────────────────────────────────────────────────────────────
// components/action-zone.tsx — the bottom zone is ALWAYS the primary CTA:
// Connect → Enable 1CT → Deposit (empty basket) → SHORT|LONG pair → CLOSE (PnL).
// LONG = price goes up = profit; SHORT = price goes down = profit.
// THE HARD PART: the fill-flash retrigger — React only honors `key` at the
// parent's reconciliation level, so the remount key lives HERE, at the call
// site, never inside the button component itself. NO spinners, ever.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import type { TradeType } from "flash-v2";
import { fmtPnlUsd } from "@/lib/format";

export interface LastFill {
  side: TradeType;
  at: number;
}

export type ZoneState =
  | { kind: "connect" }
  | { kind: "loading" }
  | { kind: "enable" }
  | { kind: "enabling"; headline: string }
  /** Enabled + flat + basket ≈ $0 — the first-run "fund it" moment. */
  | { kind: "deposit" }
  | { kind: "pair" }
  | { kind: "position"; pnlUsd: number | null; side: TradeType };

export type Busy = "long" | "short" | "flatten" | "close-one" | "reverse" | null;

function ReverseIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden focusable="false">
      <path d="M4 7 H14 M11.5 4.5 L14 7 L11.5 9.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 13 H6 M8.5 10.5 L6 13 L8.5 15.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Compact direction mark — a precise filled triangle, ≤16px, beside the label. */
function MarkIcon({ direction, className = "h-2 w-2" }: { direction: "up" | "down"; className?: string }) {
  return (
    <svg viewBox="0 0 8 8" className={className} aria-hidden focusable="false">
      {direction === "up" ? (
        <path d="M4 1.2 L7.1 6.8 H0.9 Z" fill="currentColor" />
      ) : (
        <path d="M4 6.8 L0.9 1.2 H7.1 Z" fill="currentColor" />
      )}
    </svg>
  );
}

/** Keyboard-hint chip — a crisp chevron in a key cap; the taps are bound to
 *  real arrow keys. SVG, not a text glyph, so it reads at 10px. */
function Kbd({ dir }: { dir: "up" | "down" }) {
  return (
    <span
      aria-hidden
      className="inline-grid h-4 w-4 place-items-center rounded-[3px] border border-current/35 opacity-70"
    >
      <svg viewBox="0 0 10 10" className="h-2.5 w-2.5">
        {dir === "up" ? (
          <path d="M2 6.5 L5 3.5 L8 6.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </span>
  );
}

/** One half of the SHORT|LONG pair — flat rectangle, hairline border, side tint.
 *  `configure` = trade params unset: the pair reads dimmed, the sublabel says
 *  so, and the tap opens the trade sheet instead of trading. */
function PairButton({
  side,
  priceText,
  sizeUsd,
  leverage,
  busy,
  disabled,
  flashing,
  configure = false,
  kbdHint,
  onTap,
}: {
  side: TradeType;
  priceText: string | null;
  sizeUsd: string;
  leverage: string;
  busy: boolean;
  disabled: boolean;
  flashing: boolean;
  configure?: boolean;
  /** Show the arrow-key hint (armed pair only — keys really work there). */
  kbdHint?: "up" | "down";
  onTap: () => void;
}) {
  const long = side === "LONG";
  const sizeSet = (Number(sizeUsd) || 0) > 0;
  const levSet = (Number(leverage) || 0) > 0;
  return (
    <button
      onClick={onTap}
      disabled={disabled}
      aria-label={
        configure
          ? "set trade size — open trade setup"
          : long
            ? "buy long (up)"
            : "sell short (down)"
      }
      className={`grid h-16 content-center justify-items-center gap-1 rounded-md border transition-all active:scale-[0.99] disabled:pointer-events-none ${
        flashing ? "fill-flash" : ""
      } ${
        configure
          ? long
            ? "border-long/20 bg-long/[0.04] text-long/60 hover:border-long/40"
            : "border-short/20 bg-short/[0.04] text-short/60 hover:border-short/40"
          : long
            ? "border-long/40 bg-long/[0.07] text-long hover:border-long/70"
            : "border-short/40 bg-short/[0.07] text-short hover:border-short/70"
      } ${disabled && !busy ? "opacity-35" : ""}`}
    >
      {busy ? (
        <span className="soft-pulse font-mono text-[11px]">filling…</span>
      ) : (
        <>
          <span className="flex items-center gap-1.5 font-mono text-[13px] font-bold tracking-[0.1em]">
            {long ? "LONG" : "SHORT"}
            <MarkIcon direction={long ? "up" : "down"} />
          </span>
          <span className="flex items-center gap-1.5 font-mono text-[10px] text-dim">
            {configure ? (
              "set size · tap to configure"
            ) : (
              <>
                tap or press {kbdHint && <Kbd dir={kbdHint} />}
              </>
            )}
          </span>
        </>
      )}
    </button>
  );
}

export default function ActionZone({
  zone,
  busy,
  priceText,
  sizeUsd,
  leverage,
  lastFill,
  lastClose,
  needsSetup,
  onConfigure,
  onConnect,
  onEnable,
  onShowEnable,
  onDeposit,
  onShort,
  onLong,
  onCloseAll,
  onReverse,
}: {
  zone: ZoneState;
  busy: Busy;
  priceText: string | null;
  sizeUsd: string;
  leverage: string;
  lastFill: LastFill | null;
  /** Timestamp of the last confirmed close — retriggers the CLOSE flash. */
  lastClose: number | null;
  /** True until the user explicitly sets size AND leverage — the pair won't arm. */
  needsSetup: boolean;
  /** Opens the trade sheet (the un-armed pair routes its taps here). */
  onConfigure: () => void;
  onConnect: () => void;
  onEnable: () => void;
  /** Tapping the CTA mid-enable reopens the progress sheet. */
  onShowEnable: () => void;
  /** Empty-basket first run — opens the Deposit | Withdraw sheet. */
  onDeposit: () => void;
  onShort: () => void;
  onLong: () => void;
  onCloseAll: () => void;
  onReverse: () => void;
}) {
  // CTA buttons (connect / enable / loading / enabling) are compact and
  // centered — they're prompts, not primary trading controls. The SHORT/LONG
  // pair uses the full zone width intentionally (thumb-zone affordance for
  // both sides).
  const cta =
    "h-12 w-full max-w-xs mx-auto rounded-md text-[13px] font-bold transition-transform active:scale-[0.99] sm:max-w-sm";

  return (
    <div className="relative z-20 flex flex-col items-center gap-3 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-1">
      {/* Disconnected: the pair IS the prompt (no second Connect button — the
          wallet segment top-right owns that). Tapping either side opens the
          wallet sheet, so the tap target always does the right thing. */}
      {zone.kind === "connect" && (
        <div className="grid w-full grid-cols-2 gap-2">
          <PairButton
            side="SHORT"
            priceText={priceText}
            sizeUsd={sizeUsd}
            leverage={leverage}
            busy={false}
            disabled={false}
            flashing={false}
            onTap={onConnect}
          />
          <PairButton
            side="LONG"
            priceText={priceText}
            sizeUsd={sizeUsd}
            leverage={leverage}
            busy={false}
            disabled={false}
            flashing={false}
            onTap={onConnect}
          />
        </div>
      )}

      {zone.kind === "loading" && (
        <button disabled className={`${cta} border border-edge bg-panel text-dim`}>
          <span className="soft-pulse">loading your account…</span>
        </button>
      )}

      {zone.kind === "enable" && (
        <button onClick={onEnable} className={`cta-mint ${cta}`}>
          Enable One-Click Trading
        </button>
      )}

      {zone.kind === "enabling" && (
        <button onClick={onShowEnable} className={`cta-mint ${cta}`}>
          <span className="soft-pulse">{zone.headline}</span>
        </button>
      )}

      {/* Enabled but the basket is empty by design — the zone carries the
          first-run affordance instead of a dead-looking SHORT/LONG pair. */}
      {zone.kind === "deposit" && (
        <button onClick={onDeposit} className={`${cta} bg-long text-bg`}>
          Deposit USDC to start
        </button>
      )}

      {zone.kind === "pair" && (
        <div className="grid w-full grid-cols-2 gap-2">
          {/* key lives HERE (the call site) — remounts retrigger fill-flash.
              While params are unset the pair is un-armed: taps open the trade
              sheet instead of trading (explicit choice before any fill). */}
          <PairButton
            key={lastFill?.side === "SHORT" ? lastFill.at : "short"}
            side="SHORT"
            priceText={priceText}
            sizeUsd={sizeUsd}
            leverage={leverage}
            busy={busy === "short"}
            disabled={!needsSetup && busy !== null}
            flashing={lastFill?.side === "SHORT"}
            configure={needsSetup}
            kbdHint={needsSetup ? undefined : "down"}
            onTap={needsSetup ? onConfigure : onShort}
          />
          <PairButton
            key={lastFill?.side === "LONG" ? lastFill.at : "long"}
            side="LONG"
            priceText={priceText}
            sizeUsd={sizeUsd}
            leverage={leverage}
            busy={busy === "long"}
            disabled={!needsSetup && busy !== null}
            flashing={lastFill?.side === "LONG"}
            configure={needsSetup}
            kbdHint={needsSetup ? undefined : "up"}
            onTap={needsSetup ? onConfigure : onLong}
          />
        </div>
      )}

      {zone.kind === "position" && (
        <div className="grid w-full grid-cols-[auto_1fr] items-center gap-2">
          <button
            onClick={onReverse}
            disabled={busy !== null}
            aria-label={`reverse position to ${zone.side === "LONG" ? "SHORT" : "LONG"}`}
            title={`close this ${zone.side} and open the opposite ${zone.side === "LONG" ? "SHORT" : "LONG"} in one fill (2% size haircut)`}
            className="grid h-16 content-center justify-items-center gap-1 rounded-md border border-edge2 bg-panel px-3 text-dim transition-colors hover:text-ink active:scale-[0.99] disabled:pointer-events-none disabled:opacity-35"
          >
            {busy === "reverse" ? (
              <span className="soft-pulse font-mono text-[10px]">…</span>
            ) : (
              <>
                <span className="flex items-center gap-1.5">
                  <ReverseIcon className="h-4 w-4" />
                  <span className="font-mono text-[11px] font-bold uppercase tracking-[0.08em]">
                    {zone.side === "LONG" ? "short" : "long"}
                  </span>
                </span>
                <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-faint">reverse</span>
              </>
            )}
          </button>
          {/* PnL reads through a hairline border + the colored number itself —
              mint when in profit, red when in loss. No glow. */}
          <button
            key={lastClose ?? "close"}
            onClick={onCloseAll}
            disabled={busy !== null}
            className={`flex h-16 items-center justify-center gap-3 rounded-md border bg-panel text-ink transition-all active:scale-[0.99] disabled:pointer-events-none ${
              lastClose ? "fill-flash" : ""
            } ${busy !== null && busy !== "flatten" && busy !== "close-one" ? "opacity-35" : ""} ${
              (zone.pnlUsd ?? 0) >= 0 ? "border-long/50" : "border-short/50"
            }`}
          >
            <span className="grid justify-items-center gap-0.5">
              <span className="font-mono text-[13px] font-bold uppercase tracking-[0.1em]">
                {busy === "flatten" || busy === "close-one" ? (
                  <span className="soft-pulse">closing…</span>
                ) : (
                  "Close"
                )}
              </span>
              {busy === null && (
                <span className="flex items-center gap-1.5 font-mono text-[10px] normal-case tracking-normal text-dim">
                  tap or press <Kbd dir="down" />
                </span>
              )}
            </span>
            <span
              className={`font-mono text-sm font-semibold tabular-nums ${
                (zone.pnlUsd ?? 0) >= 0 ? "text-long" : "text-short"
              }`}
            >
              {zone.pnlUsd === null ? "—" : fmtPnlUsd(zone.pnlUsd)}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
