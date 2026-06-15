// ─────────────────────────────────────────────────────────────────────────────
// lib/funds.ts — EXPLICIT deposit & withdraw. THE PRODUCTION RULE THIS FILE
// EXISTS TO TEACH: user funds move ONLY on a user-initiated action with a
// user-chosen amount and its own wallet approval — never bundled into a
// convenience flow like "Enable". Withdraw is the API's two-step dance:
// request-withdrawal → execute-withdrawal (both signed by the OWNER wallet,
// both on the BASE chain; execute can be re-run alone to recover).
// GOTCHAS.md → "Funds move on consent only" · "Two chains, one flow"
// ─────────────────────────────────────────────────────────────────────────────

import { decodeTransaction } from "flash-v2";
import { baseConnection, flash } from "./flash";
import { classifyTxError, submitAndConfirm, type EnableWalletCtx } from "./enable";
import type { LatencyEntry } from "./hooks";

export interface FundsStep {
  /** "building" → "approve" → "submitting" → "done" | "error" */
  phase: "building" | "approve" | "submitting" | "done" | "error";
  label: string;
  note?: string;
  signature?: string;
  ms?: number;
}

type OnStep = (step: FundsStep) => void;
type OnLog = (e: Omit<LatencyEntry, "id" | "at">) => void;

async function signSubmit(
  wallet: EnableWalletCtx,
  txBase64: string,
  label: string,
  onStep: OnStep,
  onLog: OnLog,
): Promise<{ signature: string; ms: number }> {
  onStep({ phase: "approve", label, note: "approve in your wallet…" });
  // NEVER touch the blockhash — builder txs arrive partially signed server-side.
  const signed = await wallet.signTransaction(decodeTransaction(txBase64));
  onStep({ phase: "submitting", label, note: "submitting to the base chain…" });
  const { signature, ms } = await submitAndConfirm(signed);
  onLog({ action: label, chain: "base", ms, signature });
  return { signature, ms };
}

/**
 * Deposit ANY pool token into the basket — the user typed `amount`, the user
 * approves the single transfer. Tradable once the deposit confirms on the ER.
 */
export async function depositToken(args: {
  wallet: EnableWalletCtx;
  tokenMint: string;
  symbol: string;
  amount: string; // UI units, user-chosen
  onStep: OnStep;
  onLog: OnLog;
}): Promise<{ ok: boolean; error?: string }> {
  const { wallet, tokenMint, symbol, amount, onStep, onLog } = args;
  const owner = wallet.publicKey.toBase58();
  const label = `deposit ${amount} ${symbol}`;
  try {
    onStep({ phase: "building", label, note: "building the transaction…" });
    const built = await flash.depositDirect({ owner, tokenMint, amount });
    const { signature, ms } = await signSubmit(wallet, built.transactionBase64, label, onStep, onLog);
    onStep({ phase: "done", label, note: "deposited — tradable once it confirms on the rollup", signature, ms });
    return { ok: true };
  } catch (e) {
    const c = classifyTxError(e);
    onStep({ phase: "error", label, note: c.message });
    return { ok: false, error: c.message };
  }
}

/** USDC compat wrapper (existing callers). */
export async function depositUsdc(args: {
  wallet: EnableWalletCtx;
  usdcMint: string;
  amount: string;
  onStep: OnStep;
  onLog: OnLog;
}): Promise<{ ok: boolean; error?: string }> {
  return depositToken({ wallet: args.wallet, tokenMint: args.usdcMint, symbol: "USDC", amount: args.amount, onStep: args.onStep, onLog: args.onLog });
}

// The receipt the execute step consumes is written when the rollup's validator
// CROSSES the settlement to base chain (~30-90s after request). Until then the
// program answers 0xbc4 AccountNotInitialized on `settlement_receipt` — a
// timing state, never an error worth showing raw logs for.
const RE_SETTLEMENT_PENDING = /settlement_receipt|AccountNotInitialized|0xbc4|3012/i;

/**
 * Withdraw USDC back to the wallet. Two explicit steps, two approvals:
 *  1) request-withdrawal (queues settlement out of the rollup)
 *  2) execute-withdrawal — AUTO-RETRIED while the rollup crosses the
 *     settlement receipt to base (~30-90s), with a countdown the sheet shows.
 */
export async function withdrawToken(args: {
  wallet: EnableWalletCtx;
  tokenMint: string;
  symbol: string;
  amount: string; // UI units, user-chosen
  onStep: OnStep;
  onLog: OnLog;
}): Promise<{ ok: boolean; error?: string; executePending?: boolean }> {
  const { wallet, tokenMint, symbol, amount, onStep, onLog } = args;
  const owner = wallet.publicKey.toBase58();
  try {
    onStep({ phase: "building", label: `request withdrawal of ${amount} ${symbol}`, note: "building…" });
    const req = await flash.requestWithdrawal({ owner, tokenMint, amount });
    await signSubmit(wallet, req.transactionBase64, `request-withdrawal ${amount} ${symbol}`, onStep, onLog);
  } catch (e) {
    const c = classifyTxError(e);
    onStep({ phase: "error", label: "request withdrawal", note: c.message });
    return { ok: false, error: c.message };
  }
  // Settlement crossing: poll UNSIGNED simulations (zero popups) until the
  // receipt exists on base, then ask for the ONE execute signature.
  const ready = await waitForSettlementReceipt({ owner, tokenMint, onStep, maxSeconds: 120 });
  if (!ready) {
    onStep({
      phase: "error",
      label: "execute withdrawal",
      note: "settlement is taking longer than usual — your funds are queued safely; tap \"Execute again\" in a minute.",
    });
    return { ok: false, error: "settlement still crossing", executePending: true };
  }
  return executeWithdrawalToken({ wallet, tokenMint, symbol, onStep, onLog });
}

/** USDC compat wrapper (existing callers). */
export async function withdrawUsdc(args: {
  wallet: EnableWalletCtx;
  usdcMint: string;
  amount: string;
  onStep: OnStep;
  onLog: OnLog;
}): Promise<{ ok: boolean; error?: string; executePending?: boolean }> {
  return withdrawToken({ wallet: args.wallet, tokenMint: args.usdcMint, symbol: "USDC", amount: args.amount, onStep: args.onStep, onLog: args.onLog });
}

/**
 * Poll an UNSIGNED simulation of execute-withdrawal until the settlement
 * receipt exists (no wallet popups while waiting). True = ready to sign.
 */
async function waitForSettlementReceipt(args: {
  owner: string;
  tokenMint: string;
  onStep: OnStep;
  maxSeconds: number;
}): Promise<boolean> {
  const { owner, tokenMint, onStep, maxSeconds } = args;
  const started = Date.now();
  for (;;) {
    const waited = Math.round((Date.now() - started) / 1000);
    if (waited > maxSeconds) return false;
    try {
      const exec = await flash.executeWithdrawal({ owner, tokenMint });
      const tx = decodeTransaction(exec.transactionBase64);
      const sim = await baseConnection.simulateTransaction(tx, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });
      const err = sim.value.err ? JSON.stringify(sim.value.err) + (sim.value.logs ?? []).join(" ") : "";
      if (!sim.value.err) return true; // receipt landed — execute will pass
      if (!RE_SETTLEMENT_PENDING.test(err)) return true; // different state — let the real attempt surface it
    } catch { /* builder/RPC hiccup — keep polling */ }
    onStep({
      phase: "submitting",
      label: "settlement crossing from the rollup",
      note: `the rollup writes the receipt to base chain (~30–90s) — waiting ${waited}s, no action needed`,
    });
    await new Promise((r) => setTimeout(r, 8000));
  }
}

/** Step 2 alone — also the recovery path when settlement needed more time. */
export async function executeWithdrawalToken(args: {
  wallet: EnableWalletCtx;
  tokenMint: string;
  symbol: string;
  onStep: OnStep;
  onLog: OnLog;
  attempt?: number;
}): Promise<{ ok: boolean; error?: string; executePending?: boolean }> {
  const { wallet, tokenMint, onStep, onLog, attempt } = args;
  const owner = wallet.publicKey.toBase58();
  const tag = attempt ? ` (attempt ${attempt}/4)` : "";
  try {
    onStep({ phase: "building", label: "execute withdrawal", note: `building…${tag}` });
    const exec = await flash.executeWithdrawal({ owner, tokenMint });
    const { signature, ms } = await signSubmit(wallet, exec.transactionBase64, "execute-withdrawal", onStep, onLog);
    onStep({ phase: "done", label: "execute withdrawal", note: "funds are back in your wallet", signature, ms });
    return { ok: true };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    if (RE_SETTLEMENT_PENDING.test(raw)) {
      // Timing, not failure — the caller's retry loop (or the button) handles it.
      onStep({
        phase: "submitting",
        label: "settlement crossing from the rollup",
        note: `receipt not on base chain yet${tag} — retrying shortly`,
      });
      return { ok: false, error: "settlement pending", executePending: true };
    }
    const c = classifyTxError(e);
    onStep({ phase: "error", label: "execute withdrawal", note: c.message });
    return { ok: false, error: c.message, executePending: c.rejected ? false : true };
  }
}

/** USDC compat wrapper (existing callers). */
export async function executeWithdrawalStep(args: {
  wallet: EnableWalletCtx;
  usdcMint: string;
  onStep: OnStep;
  onLog: OnLog;
  attempt?: number;
}): Promise<{ ok: boolean; error?: string; executePending?: boolean }> {
  return executeWithdrawalToken({ wallet: args.wallet, tokenMint: args.usdcMint, symbol: "USDC", onStep: args.onStep, onLog: args.onLog, ...(args.attempt !== undefined ? { attempt: args.attempt } : {}) });
}
