// ─────────────────────────────────────────────────────────────────────────────
// components/funds-sheet.tsx — the EXPLICIT money controls: Deposit | Withdraw,
// per asset. THE POINT: amounts are typed by the user, every transfer is its
// own wallet approval, balances live in a labeled mini-table showing BOTH
// sides of EVERY asset — a nonzero rollup balance must never hide behind the
// selector (orphan prevention). Withdraw renders its two approvals as step-dot
// rows (request → execute) with a visible recovery path ("Execute again").
// GOTCHAS.md → "Funds move on consent only"
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useState } from "react";
import Sheet from "@/components/sheet";
import { depositToken, executeWithdrawalToken, withdrawToken, type FundsStep } from "@/lib/funds";
import type { EnableWalletCtx } from "@/lib/enable";
import { explorerTx } from "@/lib/flash";
import { fmtMs, shortKey } from "@/lib/format";
import type { BasketAsset, LatencyEntry } from "@/lib/hooks";

type Tab = "deposit" | "withdraw";

/** Selectable transfer assets. USDC always; SOL arms once its mint is known
 *  (from the rollup-side assets array — the same source that proves a balance
 *  exists to withdraw). */
type Asset = "USDC" | "SOL";

type DotStatus = "idle" | "active" | "done" | "error";

/** Same dot language as the enable sheet's per-step rows. */
function StepDot({ status }: { status: DotStatus }) {
  const cls =
    status === "done"
      ? "bg-long"
      : status === "active"
        ? "soft-pulse bg-long"
        : status === "error"
          ? "bg-short"
          : "bg-edge";
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${cls}`} />;
}

export default function FundsSheet({
  open,
  onClose,
  walletCtx,
  usdcMint,
  walletUsdc,
  walletSol,
  inBasketUsd,
  rollupAssets = null,
  onLog,
  onMoved,
}: {
  open: boolean;
  onClose: () => void;
  /** null while disconnected — the sheet renders a connect hint. */
  walletCtx: EnableWalletCtx | null;
  usdcMint: string | null;
  walletUsdc: number | null;
  /** Wallet SOL (base chain) — both sides of every asset stay visible. */
  walletSol: number | null;
  inBasketUsd: number | null;
  /** EVERY asset with rollup-side availability (useBasketBalance().assets) —
   *  rendered even when unselected so nothing orphans invisibly. */
  rollupAssets?: BasketAsset[] | null;
  onLog: (e: Omit<LatencyEntry, "id" | "at">) => void;
  /** Called after any confirmed transfer — refresh balances + snapshot. */
  onMoved: () => void;
}) {
  const [tab, setTab] = useState<Tab>("deposit");
  const [asset, setAsset] = useState<Asset>("USDC");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<FundsStep | null>(null);
  const [execPending, setExecPending] = useState(false);
  /** The mint/symbol mid-withdrawal — "Execute again" must never switch assets. */
  const [execAsset, setExecAsset] = useState<{ mint: string; symbol: string } | null>(null);

  // Rollup-side figures per asset. USDC has its own calibrated figure
  // (inBasketUsd); everything else reads from the assets array.
  const solAsset = rollupAssets?.find((a) => a.symbol.toUpperCase() === "SOL") ?? null;
  const otherAssets = (rollupAssets ?? []).filter(
    (a) => a.symbol.toUpperCase() !== "USDC" && a.symbol.toUpperCase() !== "SOL",
  );
  const solLive = solAsset !== null; // mint known → SOL transfers are routable
  const activeMint = asset === "USDC" ? usdcMint : (solAsset?.mint ?? null);

  const walletBal = asset === "USDC" ? walletUsdc : walletSol;
  const rollupBal = asset === "USDC" ? inBasketUsd : (solAsset?.amountUi ?? 0);
  const max = tab === "deposit" ? walletBal : rollupBal;
  const dp = asset === "USDC" ? 2 : 4; // display/“max” precision per asset
  const parsed = Number(amount);
  const valid = Number.isFinite(parsed) && parsed > 0 && (max === null || parsed <= max + 1e-9);
  const locked = busy; // mid-approval — don't let the sheet close under the wallet popup

  const switchTab = (t: Tab) => {
    if (busy) return;
    setTab(t);
    setAmount("");
    setStep(null);
  };
  const switchAsset = (a: Asset) => {
    if (busy || (a === "SOL" && !solLive)) return;
    setAsset(a);
    setAmount("");
    setStep(null);
  };

  const run = async () => {
    if (!walletCtx || !activeMint || !valid || busy) return;
    setBusy(true);
    setExecPending(false);
    setStep(null);
    if (tab === "withdraw") setExecAsset({ mint: activeMint, symbol: asset });
    const args = {
      wallet: walletCtx,
      tokenMint: activeMint,
      symbol: asset,
      amount: String(parsed),
      onStep: setStep,
      onLog,
    };
    const res = tab === "deposit" ? await depositToken(args) : await withdrawToken(args);
    if (res.ok) {
      setAmount("");
      onMoved();
    } else if ("executePending" in res && res.executePending) {
      setExecPending(true);
    }
    setBusy(false);
  };

  const retryExecute = async () => {
    const target = execAsset ?? (usdcMint ? { mint: usdcMint, symbol: "USDC" } : null);
    if (!walletCtx || !target || busy) return;
    setBusy(true);
    const res = await executeWithdrawalToken({
      wallet: walletCtx,
      tokenMint: target.mint,
      symbol: target.symbol,
      onStep: setStep,
      onLog,
    });
    if (res.ok) {
      setExecPending(false);
      onMoved();
    }
    setBusy(false);
  };

  return (
    <Sheet open={open} onClose={onClose} label="deposit or withdraw" locked={locked}>
      <p className="font-display text-[15px] font-semibold text-ink">Funds</p>
      <p className="mt-1 text-xs leading-relaxed text-dim">
        Your money moves only here — your amount, your approval, one transfer at a time.
      </p>

      {/* segmented tab */}
      <div className="mt-4 grid grid-cols-2 gap-1 rounded-[3px] border border-edge bg-panel p-1">
        {(["deposit", "withdraw"] as const).map((t) => (
          <button
            key={t}
            onClick={() => switchTab(t)}
            aria-pressed={tab === t}
            disabled={busy}
            className={`h-9 rounded-[2px] border font-mono text-xs uppercase tracking-[0.1em] transition-colors active:scale-[0.99] disabled:opacity-35 ${
              tab === t
                ? "border-edge2 bg-panel2 text-ink"
                : "border-transparent text-dim hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* asset selector — explicit choice of WHAT moves. SOL arms once its
          rollup-side mint is known (it appears in the assets array). */}
      <div className="mt-3 flex items-center gap-2.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">asset</span>
        <span className="h-px flex-1 bg-edge" aria-hidden />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        {(["USDC", "SOL"] as const).map((a) => {
          const enabled = a === "USDC" || solLive;
          return (
            <button
              key={a}
              onClick={() => switchAsset(a)}
              aria-pressed={asset === a}
              disabled={busy || !enabled}
              title={enabled ? undefined : "SOL becomes selectable once a rollup-side balance is detected"}
              className={`flex items-center justify-center gap-1.5 rounded-[3px] border py-2 font-mono text-xs transition-colors active:scale-[0.99] disabled:opacity-35 ${
                asset === a
                  ? "border-long/60 bg-long/10 text-long"
                  : "border-edge bg-panel text-dim hover:border-edge2"
              }`}
            >
              {a}
            </button>
          );
        })}
      </div>

      {/* balances as a mini-table — BOTH sides of EVERY asset stay visible
          (a nonzero rollup balance must never hide behind the selector); the
          row money moves FROM under the active tab carries the "from" tag */}
      <div className="mt-3 overflow-hidden rounded-[3px] border border-edge bg-panel">
        {([
          ["wallet USDC (base chain)", walletUsdc === null ? "—" : `$${walletUsdc.toFixed(2)}`, tab === "deposit" && asset === "USDC"],
          ["wallet SOL (base chain)", walletSol === null ? "—" : `${walletSol.toFixed(4)} SOL`, tab === "deposit" && asset === "SOL"],
          ["in basket USDC (tradable)", inBasketUsd === null ? "—" : `$${inBasketUsd.toFixed(2)}`, tab === "withdraw" && asset === "USDC"],
          ["in basket SOL", solAsset === null ? "—" : `${solAsset.amountUi.toFixed(4)} SOL`, tab === "withdraw" && asset === "SOL"],
          ...otherAssets.map(
            (a): [string, string, boolean] => [
              `in basket ${a.symbol}`,
              `${a.amountUi.toFixed(Math.min(a.decimals, 4))} ${a.symbol}`,
              false,
            ],
          ),
        ] as Array<[string, string, boolean]>).map(([label, v, isSource], i) => (
          <div
            key={label}
            className={`flex items-baseline justify-between gap-3 px-3.5 py-2.5 ${i > 0 ? "border-t border-edge" : ""}`}
          >
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
              {label}
              {isSource && <span className="ml-1.5 text-long/80">· from</span>}
            </span>
            <span className={`font-mono text-xs tabular-nums ${isSource ? "text-ink" : "text-dim"}`}>
              {v}
            </span>
          </div>
        ))}
      </div>

      {/* amount */}
      <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
        <input
          inputMode="decimal"
          placeholder={tab === "deposit" ? `amount to deposit (${asset})` : `amount to withdraw (${asset})`}
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          disabled={busy}
          className="h-11 rounded-[3px] border border-edge bg-panel px-3.5 font-mono text-sm tabular-nums text-ink outline-none transition-colors placeholder:text-faint focus:border-long/45 disabled:opacity-35"
        />
        <button
          onClick={() => max !== null && setAmount(String(Math.floor(max * 10 ** dp) / 10 ** dp))}
          disabled={busy || max === null}
          className="h-11 rounded-[3px] border border-edge bg-panel px-3.5 font-mono text-xs uppercase tracking-[0.1em] text-dim transition-colors hover:text-ink active:scale-[0.99] disabled:opacity-35"
        >
          max
        </button>
      </div>

      {!walletCtx ? (
        <p className="mt-3 font-mono text-[11px] text-faint">connect a wallet first (top right)</p>
      ) : (
        <button
          onClick={() => void run()}
          disabled={!valid || busy || !activeMint}
          className="mt-4 h-12 w-full rounded-md bg-long text-[13px] font-bold text-bg transition-transform active:scale-[0.99] disabled:opacity-35"
        >
          {busy ? (
            <span className="soft-pulse">{step?.note ?? "working…"}</span>
          ) : tab === "deposit" ? (
            `Deposit${valid ? (asset === "USDC" ? ` $${parsed}` : ` ${parsed}`) : ""} ${asset}`
          ) : (
            `Withdraw${valid ? (asset === "USDC" ? ` $${parsed}` : ` ${parsed}`) : ""} ${asset}`
          )}
        </button>
      )}

      {/* withdraw = two approvals — same step-dot rows as the enable sheet.
          Statuses derive from the live FundsStep (request… labels = stage 1). */}
      {tab === "withdraw" && (
        <ol className="mt-3 grid gap-2">
          {(
            [
              ["request", "queues settlement off the rollup", "approval 1"],
              ["execute", "funds land back in your wallet", "approval 2"],
            ] as const
          ).map(([name, note, tag], i) => {
            const stage = step === null ? null : /request/i.test(step.label) ? 0 : 1;
            const status: DotStatus =
              stage === null || stage < i
                ? "idle"
                : stage > i
                  ? "done"
                  : step!.phase === "error"
                    ? "error"
                    : step!.phase === "done"
                      ? "done"
                      : "active";
            return (
              <li key={name} className="flex items-center gap-2.5">
                <StepDot status={status} />
                <span className={`font-mono text-[11px] ${status === "idle" ? "text-faint" : "text-ink"}`}>
                  {name}
                </span>
                <span className="min-w-0 truncate font-mono text-[10px] text-faint">— {note}</span>
                <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.14em] text-faint">{tag}</span>
              </li>
            );
          })}
        </ol>
      )}

      {/* live step status */}
      {step && (
        <div
          className={`mt-3 rounded-[3px] border px-3.5 py-2.5 ${
            step.phase === "error" ? "border-short/40 bg-short/5" : "border-edge bg-panel"
          }`}
        >
          <p
            className={`break-words font-mono text-[11px] leading-relaxed ${
              step.phase === "error" ? "text-short" : step.phase === "done" ? "text-long" : "text-dim"
            }`}
          >
            {step.label}
            {step.note ? ` — ${step.note}` : ""}
          </p>
          {step.signature && step.ms !== undefined && (
            <a
              href={explorerTx(step.signature)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[10px] tabular-nums text-dim underline-offset-2 hover:text-ink hover:underline"
            >
              {fmtMs(step.ms)} · {shortKey(step.signature)}
            </a>
          )}
          {execPending && !busy && (
            <button
              onClick={() => void retryExecute()}
              className="mt-2 rounded-[3px] border border-edge px-3 py-1.5 font-mono text-xs text-ink transition-colors hover:border-edge2 active:scale-[0.99]"
            >
              Execute again
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}
