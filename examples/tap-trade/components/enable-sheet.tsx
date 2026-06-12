// ─────────────────────────────────────────────────────────────────────────────
// components/enable-sheet.tsx — the Enable One-Click Trading progress: per-step
// rows (dot · name · note · ms · explorer) and the calming upstream-break
// message. THE HARD PART: always escapable EXCEPT mid-signing — a blocked
// step must never strand the user; the flow keeps running behind a dismissed
// sheet. GOTCHAS.md → "The lifecycle has a strict order" (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useState } from "react";
import Sheet from "@/components/sheet";
import { explorerTx } from "@/lib/flash";
import type { EnableState, EnableStepRow } from "@/lib/enable";
import { fmtMs, shortKey } from "@/lib/format";

function CopyIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" className={className} aria-hidden focusable="false">
      <rect x="4.5" y="4.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M9.5 4.5 V3.5 A1.5 1.5 0 0 0 8 2 H3.5 A1.5 1.5 0 0 0 2 3.5 V8 A1.5 1.5 0 0 0 3.5 9.5 H4.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function StepDot({ status }: { status: EnableStepRow["status"] }) {
  const cls =
    status === "done"
      ? "bg-long"
      : status === "active"
        ? "soft-pulse bg-long"
        : status === "error"
          ? "bg-short"
          : status === "skipped"
            ? "bg-edge2"
            : "bg-edge";
  return <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${cls}`} />;
}

export default function EnableSheet({
  open,
  onClose,
  state,
  enabling,
  address,
  walletSol,
  onRetry,
  onOpenFunds,
}: {
  open: boolean;
  onClose: () => void;
  state: EnableState | null;
  enabling: boolean;
  /** Connected wallet address — shown truncated, copied in full. Display only. */
  address: string | null;
  /** Wallet SOL balance (base chain) — concrete numbers for the funding stop. */
  walletSol: number | null;
  onRetry: () => void;
  /** Opens the explicit Deposit | Withdraw sheet (consent rule: funds move there only). */
  onOpenFunds: () => void;
}) {
  const locked = state?.phase === "signing";
  const stopped = state?.phase === "stopped";
  const done = state?.phase === "done";
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard denied — the truncated key still shows */
    }
  };

  // ── plain-language stop states ──────────────────────────────────────────────
  // The lib reports stops in dev terms (state.error / state.fundingHint, which
  // embeds a full 58-char address). The sheet re-presents every stop as: a
  // short human title, ONE sentence with concrete numbers, a copy-address
  // affordance (truncated — the full string is never prose), Retry, and the
  // "nothing has been sent" reassurance. lib strings are never edited, only
  // restructured here.
  const err = state?.error ?? "";
  const funding = Boolean(state?.fundingHint);
  const stopKind = funding
    ? "funding"
    : state?.upstream
      ? "upstream"
      : /declin|reject|cancel/i.test(err)
        ? "declined"
        : /expired|took too long/i.test(err)
          ? "expired"
          : "generic";
  const solText =
    walletSol === null ? null : walletSol >= 0.01 || walletSol === 0 ? walletSol.toFixed(2) : walletSol.toFixed(4);
  const stopTitle =
    stopKind === "funding"
      ? "Add a little SOL to continue"
      : stopKind === "upstream"
        ? "Flash is mid-redeploy — retry shortly"
        : stopKind === "declined"
          ? "Approval declined"
          : stopKind === "expired"
            ? "Approval timed out"
            : "Setup stopped";
  const stopSentence =
    stopKind === "funding"
      ? (state?.fundingHint ??
        `This wallet needs a little SOL for setup rent — it has ${solText ?? "less than that"}.`)
      : err;

  return (
    <Sheet open={open} onClose={onClose} label="enable one-click trading" locked={locked}>
      <p className="font-display text-[15px] font-semibold text-ink">Enable One-Click Trading</p>
      <p className="mt-1 text-xs leading-relaxed text-dim">
        One approval, account setup only: session key + basket + deposit ledger + delegation — all
        on Solana L1. <span className="text-ink">No funds move here.</span> Depositing is a separate,
        explicit step where you choose the amount. After setup, every tap fills on the Ephemeral
        Rollup with zero popups.
      </p>
      {(
        <p className="mt-2 rounded-[3px] border border-long/30 bg-long/5 px-3 py-2 font-mono text-[11px] leading-relaxed text-long">
          mainnet: the only transfer in this batch is 0.01 SOL to your own session key (it covers the
          session account rent; recoverable when you revoke). No USDC moves during Enable.
        </p>
      )}

      {/* per-step rows */}
      {state && state.steps.length > 0 && (
        <ol className="mt-4 grid gap-2.5">
          {state.steps.map((s) => (
            <li key={s.id} className="row-in grid grid-cols-[auto_1fr] gap-2.5">
              <StepDot status={s.status} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className={`font-mono text-xs ${s.status === "skipped" ? "text-faint" : "text-ink"}`}>
                    {s.label}
                  </span>
                  {s.signature && s.ms !== undefined && (
                    <a
                      href={explorerTx(s.signature)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[11px] tabular-nums text-dim underline-offset-2 hover:text-ink hover:underline"
                    >
                      {fmtMs(s.ms)} · {shortKey(s.signature)}
                    </a>
                  )}
                </div>
                {s.note && (
                  <p
                    className={`mt-0.5 break-words font-mono text-[11px] leading-relaxed ${
                      s.status === "error" ? "text-short" : "text-faint"
                    }`}
                  >
                    {s.note}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* every stop, re-presented for humans: title · one sentence · copy
          address · Retry · reassurance. Calm tone unless the cause is unknown. */}
      {stopped && state?.error && (
        <div
          className={`mt-4 rounded-[3px] border px-3.5 py-3 ${
            stopKind === "generic" ? "border-short/40 bg-short/5" : "border-edge2 bg-panel2"
          }`}
        >
          <p className="text-[13px] font-semibold text-ink">{stopTitle}</p>
          <p
            className={`mt-1 break-words text-xs leading-relaxed ${
              stopKind === "generic" ? "text-short" : "text-dim"
            }`}
          >
            {stopSentence}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {!enabling && (
              <button
                onClick={onRetry}
                className="h-9 rounded-md bg-long px-5 text-[13px] font-bold text-bg transition-transform active:scale-[0.99]"
              >
                Retry
              </button>
            )}
            {address && (
              <button
                onClick={() => void copyAddress()}
                className="flex h-9 items-center gap-2 rounded-[3px] border border-edge px-3 font-mono text-[11px] text-dim transition-colors hover:border-edge2 hover:text-ink active:scale-[0.99]"
              >
                <CopyIcon className="h-3.5 w-3.5" />
                {copied ? "copied" : `copy address · ${shortKey(address)}`}
              </button>
            )}
          </div>
          <p className="mt-2.5 font-mono text-[11px] leading-relaxed text-faint">
            No wallet approval will appear until this is resolved — nothing has been sent.
          </p>
        </div>
      )}

      {/* fresh basket = empty by design — deposit is the user's explicit move */}
      {state?.needsUsdc && (
        <div className="mt-3 rounded-[3px] border border-edge bg-panel px-3.5 py-2.5">
          <p className="font-mono text-[11px] leading-relaxed text-dim">
            your basket is set up and <span className="text-ink">empty by design</span> — no funds
            moved during Enable. Deposit the amount you choose to start trading.
          </p>
          <button
            onClick={onOpenFunds}
            className="mt-2.5 h-9 rounded-md bg-long px-4 text-xs font-bold text-bg transition-transform active:scale-[0.99]"
          >
            Deposit USDC
          </button>
        </div>
      )}

      {done && !state?.needsUsdc && (
        <p className="mt-4 font-mono text-xs text-long">
          one-click trading enabled — tap SHORT or LONG
        </p>
      )}
    </Sheet>
  );
}
