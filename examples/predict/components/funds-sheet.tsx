// ─────────────────────────────────────────────────────────────────────────────
// components/funds-sheet.tsx — explicit deposit & withdraw. User types the
// amount, sees where money lives, approves that ONE transfer.
// THE HARD PART: withdraw is two phases — request queues settlement off the
// rollup (~30–90s), execute completes it. The wait is polled with UNSIGNED
// simulations (lib/funds.ts), so retries never burn wallet popups.
// GOTCHAS.md → "Withdrawals settle in two phases" · §17 (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useState } from "react";
import type { FundsStep } from "@/lib/funds";
import { fmtUsd } from "@/lib/format";
import { useSheetMount } from "@/lib/use-sheet-mount";

interface Props {
  open: boolean;
  busy: boolean;
  walletUsdc: number | null;
  inBasketUsd: number | null;
  step: FundsStep | null;
  /** A requested withdrawal is waiting for its execute leg. */
  executePending: boolean;
  onDeposit: (amount: string) => void;
  onWithdraw: (amount: string) => void;
  onExecuteWithdraw: () => void;
  onClose: () => void;
}

export function FundsSheet({ open, busy, walletUsdc, inBasketUsd, step, executePending, onDeposit, onWithdraw, onExecuteWithdraw, onClose }: Props) {
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");

  const { mounted, closing } = useSheetMount(open);

  const max = mode === "deposit" ? walletUsdc : inBasketUsd;
  const amt = Number(amount);
  const valid = Number.isFinite(amt) && amt > 0 && (max === null || amt <= max + 1e-9);

  if (!mounted) return null;
  return (
    <div className="fixed inset-0 z-40">
      <div className={`absolute inset-0 bg-bg/70 ${closing ? "backdrop-out" : "backdrop-in"}`} onClick={busy ? undefined : onClose} />
      <div className={`absolute inset-x-0 bottom-0 mx-auto max-w-lg ${closing ? "sheet-out" : "sheet-in"}`} role="dialog" aria-modal="true" aria-label="Move funds">
        <div className="glass m-2">
          <div className="p-6">
            <div className="flex rounded-full border border-edge bg-bg p-1 font-display text-[12px] font-bold">
              {(["deposit", "withdraw"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  disabled={busy}
                  className={`flex-1 cursor-pointer rounded-full py-2 capitalize transition-colors ${mode === m ? "bg-ink text-bg" : "text-dim"}`}
                >
                  {m}
                </button>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between font-mono text-[11px] text-dim">
              <span>wallet {walletUsdc === null ? "…" : fmtUsd(walletUsdc)}</span>
              <span className="text-faint">{mode === "deposit" ? "→" : "←"}</span>
              <span>basket {inBasketUsd === null ? "…" : fmtUsd(inBasketUsd)}</span>
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-2xl border border-edge bg-bg px-4 py-3">
              <span className="font-mono text-sm text-faint">$</span>
              <input
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                disabled={busy}
                aria-label={`Amount to ${mode} in USDC`}
                className="w-full bg-transparent font-mono text-xl text-ink placeholder:text-faint focus:outline-none"
              />
              <button
                type="button"
                onClick={() => max !== null && setAmount(String(Math.floor(max * 100) / 100))}
                disabled={busy || max === null}
                className="cursor-pointer rounded-full border border-edge px-2.5 py-1 font-mono text-[10px] uppercase text-dim"
              >
                max
              </button>
            </div>

            <p className="mt-2 text-[11.5px] leading-snug text-faint">
              {mode === "deposit"
                ? "USDC moves from your wallet into your basket. One wallet approval."
                : "Two approvals by design: request queues settlement off the rollup (~30–90s), execute completes it to your wallet."}
            </p>

            {executePending && (
              <button
                type="button"
                onClick={onExecuteWithdraw}
                disabled={busy}
                className="press mt-3 w-full cursor-pointer rounded-full border border-warn/40 bg-warn/10 py-3 font-display text-[13px] font-bold text-warn disabled:opacity-50"
              >
                Finish pending withdrawal →
              </button>
            )}

            {step && (
              <div className="row-in mt-3 flex items-center gap-2 rounded-xl border border-edge bg-panel px-3 py-2 font-mono text-[11px]">
                <span className={`h-2 w-2 rounded-full ${step.phase === "error" ? "bg-down" : step.phase === "done" ? "bg-up" : "bg-warn soft-pulse"}`} />
                <span className={step.phase === "error" ? "text-down" : "text-dim"}>{step.label}</span>
                {step.note ? <span className="ml-auto text-faint">{step.note}</span> : null}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button type="button" onClick={onClose} disabled={busy} className="press flex-1 cursor-pointer rounded-full border border-edge py-3 text-[13px] text-dim disabled:opacity-40">
                Close
              </button>
              <button
                type="button"
                onClick={() => (mode === "deposit" ? onDeposit(amount) : onWithdraw(amount))}
                disabled={busy || !valid}
                className="press flex-[2] cursor-pointer rounded-full bg-ink py-3 font-display text-[13px] font-bold text-bg disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? "Working…" : mode === "deposit" ? `Deposit ${valid ? fmtUsd(amt) : ""}` : `Withdraw ${valid ? fmtUsd(amt) : ""}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
