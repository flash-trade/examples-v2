// ─────────────────────────────────────────────────────────────────────────────
// lib/enable.ts — "Enable One-Click Trading": session + basket + ledger +
// delegate behind ONE wallet approval sheet (signAllTransactions).
// CONSENT RULE: NO USER FUNDS MOVE HERE. Enable is account setup only — the
// sole transfer is the disclosed 0.01 SOL rent top-up to the session key
// (recoverable on revoke). Deposits/withdrawals are EXPLICIT, amount-chosen,
// separately-approved actions in lib/funds.ts. Never bundle a deposit into a
// convenience flow in a production app.
// THE HARD PART: build EVERYTHING first (API txs arrive partially signed with
// their own blockhashes — never touch them), sign once, then submit in strict
// lifecycle order on the BASE chain.
// GOTCHAS.md → "The lifecycle has a strict order"
// ─────────────────────────────────────────────────────────────────────────────

import type { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { decodeTransaction, type BasketSnapshot } from "flash-v2";
import { baseConnection, flash } from "./flash";
import type { LatencyEntry } from "./hooks";
import {
  buildSessionTransaction,
  loadSession,
  persistSession,
  type BuiltSessionTransaction,
  type LoadedSession,
  type SessionWallet,
} from "./session";

// ── public shapes ─────────────────────────────────────────────────────────────

export type EnableStepId = "fund" | "session" | "basket" | "ledger" | "delegate";
export type EnableStepStatus = "idle" | "active" | "done" | "skipped" | "error";

export interface EnableStepRow {
  id: EnableStepId;
  label: string;
  status: EnableStepStatus;
  note?: string;
  ms?: number;
  signature?: string;
}

export interface EnableState {
  phase: "precheck" | "building" | "signing" | "submitting" | "done" | "stopped";
  /** Live text for the action-zone pill ("approve in wallet…", "init-basket…"). */
  headline: string;
  steps: EnableStepRow[];
  /** Set when the wallet can't pay setup rent. */
  fundingHint: string | null;
  /** Fresh basket has no funds yet — surface the EXPLICIT Deposit affordance.
   *  (Funds never move during Enable; see lib/funds.ts.) */
  needsUsdc: boolean;
  /** Fatal step error (already phrased for humans; calming when upstream). */
  error: string | null;
  /** True when `error` is a known transient upstream-deploy situation. */
  upstream: boolean;
}

export interface EnableResult {
  ok: boolean;
  /** Minted (and persisted) even when a later step failed — partial progress counts. */
  session: LoadedSession | null;
  needsUsdc: boolean;
}

/** The narrow slice of wallet-adapter's useWallet() that enable needs. */
export interface EnableWalletCtx {
  publicKey: PublicKey;
  signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>;
  signAllTransactions?: (<T extends Transaction | VersionedTransaction>(txs: T[]) => Promise<T[]>) | undefined;
}

// ── error classification (per-step) ──────────────────────────────────────────

const RE_ALREADY = /already in use|already exists|custom program error: 0x0\b/i;
const RE_UPSTREAM = /Access violation in heap|ProgramFailedToComplete/i;
const RE_REJECTED = /reject|declin|cancel/i;
const RE_STALE = /blockhash not found|block height exceeded|expired/i;
const RE_NO_SIGNALL = /signAllTransactions|not.{0,4}supported/i;

export const UPSTREAM_MESSAGE =
  "known upstream issue: the magic-trade program is temporarily unavailable (Flash may be redeploying) — your setup is fine; retry after the fix.";

export function errText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const logs = (e as { logs?: unknown })?.logs;
  return Array.isArray(logs) ? `${msg} ${logs.join(" ")}` : msg;
}

/** Shared per-tx error classification — also used by the explicit funds flows. */
export function classifyTxError(e: unknown): {
  message: string;
  upstream: boolean;
  stale: boolean;
  rejected: boolean;
} {
  const raw = errText(e);
  if (RE_UPSTREAM.test(raw)) return { message: UPSTREAM_MESSAGE, upstream: true, stale: false, rejected: false };
  if (RE_REJECTED.test(raw))
    return { message: "approval declined in the wallet — nothing was sent", upstream: false, stale: false, rejected: true };
  if (RE_STALE.test(raw))
    return { message: "the approval took too long and the transaction expired — try again", upstream: false, stale: true, rejected: false };
  return { message: raw, upstream: false, stale: false, rejected: false };
}

// ── confirmation (the confirmAirdrop pattern: poll signature statuses) ───────

export async function submitAndConfirm(
  tx: Transaction | VersionedTransaction,
  timeoutMs = 45_000,
): Promise<{ signature: string; ms: number }> {
  const raw = tx.serialize();
  const started = Date.now();
  const signature = await baseConnection.sendRawTransaction(raw, { maxRetries: 3 });
  for (;;) {
    try {
      const status = (await baseConnection.getSignatureStatuses([signature])).value[0];
      if (status) {
        if (status.err) throw new Error(`on-chain error (${signature}): ${JSON.stringify(status.err)}`);
        const level = status.confirmationStatus;
        if (level === "confirmed" || level === "finalized") {
          return { signature, ms: Date.now() - started };
        }
      }
    } catch (e) {
      // A real on-chain error must surface; transient 429s while polling must not.
      if (e instanceof Error && e.message.startsWith("on-chain error")) throw e;
    }
    if (Date.now() - started > timeoutMs) throw new Error(`confirmation timeout (${signature})`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

// ── the flow ──────────────────────────────────────────────────────────────────

export async function enableOneClickTrading(args: {
  wallet: EnableWalletCtx;
  anchorWallet: SessionWallet;
  snapshot: BasketSnapshot | null;
  usdcMint: string | null;
  balances: { sol: number | null; usdc: number | null };
  onStep: (state: EnableState) => void;
  onLog: (e: Omit<LatencyEntry, "id" | "at">) => void;
}): Promise<EnableResult> {
  const { wallet, anchorWallet, snapshot, usdcMint, balances, onStep, onLog } = args;
  const owner = wallet.publicKey.toBase58();

  // 1 ── what does this account still need?
  const basketExists = Boolean(snapshot?.basketPubkey);
  const freshSession = loadSession(owner);
  const needs = {
    session: !freshSession,
    basket: !basketExists,
    ledger: !basketExists, // basket unknown → ledger unknown → init it (idempotent-ish)
    delegate: !basketExists, // a fresh basket must be handed to the MagicBlock validator
    // NO deposit here — funds move only via the explicit Deposit flow (lib/funds.ts).
  };

  const state: EnableState = {
    phase: "precheck",
    headline: "checking wallet…",
    steps: [],
    fundingHint: null,
    needsUsdc: false,
    error: null,
    upstream: false,
  };
  const rows = new Map<EnableStepId, EnableStepRow>();
  const emit = () => {
    state.steps = [...rows.values()];
    onStep({ ...state, steps: state.steps.map((s) => ({ ...s })) });
  };
  const row = (id: EnableStepId, label: string, patch: Partial<EnableStepRow>) => {
    rows.set(id, { ...(rows.get(id) ?? { id, label, status: "idle" }), label, ...patch });
    emit();
  };
  const stop = (error: string, upstream = false): EnableResult => {
    state.phase = "stopped";
    state.error = error;
    state.upstream = upstream;
    state.headline = upstream ? "program unavailable upstream" : "setup stopped";
    emit();
    return { ok: false, session: mintedSession, needsUsdc: state.needsUsdc };
  };
  let mintedSession: LoadedSession | null = freshSession;
  /** Freshly built session pieces (set in step 3, persisted in step 5 once its tx confirms). */
  let sessionParts: BuiltSessionTransaction | null = null;

  // 2 ── funding pre-check: compute the real SOL needed at runtime — mostly
  //      recoverable account rent (basket + deposit-ledger + session-token),
  //      plus the recoverable 0.01 SOL session top-up and a small fee buffer.
  //      No hardcoded gate: getMinimumBalanceForRentExemption is the source of truth.
  const sol = balances.sol ?? 0;
  emit();
  let rentLamports = 0;
  if (needs.basket) rentLamports += await baseConnection.getMinimumBalanceForRentExemption(256);
  if (needs.ledger) rentLamports += await baseConnection.getMinimumBalanceForRentExemption(852);
  if (needs.session) rentLamports += await baseConnection.getMinimumBalanceForRentExemption(144);
  const requiredSol = rentLamports / 1e9 + (needs.session ? 0.01 : 0) + 0.002; // top-up + fee buffer
  if (sol < requiredSol) {
    const need = requiredSol.toFixed(4);
    state.fundingHint =
      `this wallet needs ~${need} SOL for setup — mostly recoverable account rent plus a ` +
      `0.01 SOL session top-up (recoverable on revoke), not fees. Fund ${owner} and tap Enable again.`;
    return stop(`wallet needs ~${need} SOL for setup (recoverable rent + top-up)`);
  }
  // 3 ── BUILD everything first (no signatures yet).
  state.phase = "building";
  state.headline = "preparing transactions…";
  emit();

  type Planned = { id: EnableStepId; label: string; action: string; tx: Transaction | VersionedTransaction };
  const plan: Planned[] = [];
  try {
    if (needs.session) {
      row("session", "create session key", { status: "active", note: "building…" });
      const built = await buildSessionTransaction(anchorWallet, baseConnection, {
      });
      plan.push({ id: "session", label: "create session key", action: "create-session", tx: built.tx });
      // Persisted only after its tx confirms (step 5 below).
      sessionParts = built;
      row("session", "create session key", { status: "active", note: "ready to sign" });
    } else {
      row("session", "create session key", { status: "skipped", note: "session still valid" });
    }

    const builders: Array<{ id: EnableStepId; label: string; action: string; build: () => Promise<{ transactionBase64: string }> }> = [];
    if (needs.basket) builders.push({ id: "basket", label: "init-basket", action: "init-basket", build: () => flash.initBasket({ owner }) });
    else row("basket", "init-basket", { status: "skipped", note: "basket already on-chain" });
    if (needs.ledger) builders.push({ id: "ledger", label: "init-deposit-ledger", action: "init-deposit-ledger", build: () => flash.initDepositLedger({ owner }) });
    else row("ledger", "init-deposit-ledger", { status: "skipped", note: "already set up" });
    if (needs.delegate) builders.push({ id: "delegate", label: "delegate-basket", action: "delegate-basket", build: () => flash.delegateBasket({ payer: owner, owner }) });
    else row("delegate", "delegate-basket", { status: "skipped", note: "already delegated" });

    // CONSENT RULE: no deposit in this batch — a fresh basket starts EMPTY and
    // the user funds it via the explicit Deposit sheet (their amount, their
    // separate approval). needsUsdc just surfaces that affordance.
    if (!basketExists) state.needsUsdc = true;

    for (const b of builders) {
      row(b.id, b.label, { status: "active", note: "building…" });
      const built = await b.build();
      // NEVER touch the blockhash — these arrive partially signed server-side.
      plan.push({ id: b.id, label: b.label, action: b.action, tx: decodeTransaction(built.transactionBase64) });
      row(b.id, b.label, { status: "active", note: "ready to sign" });
    }
  } catch (e) {
    const raw = errText(e);
    return stop(RE_UPSTREAM.test(raw) ? UPSTREAM_MESSAGE : raw, RE_UPSTREAM.test(raw));
  }

  if (plan.length === 0) {
    state.phase = "done";
    state.headline = "already set up";
    emit();
    return { ok: true, session: mintedSession, needsUsdc: state.needsUsdc };
  }

  // 4 ── ONE approval for the whole bundle (fallback: sequential popups).
  state.phase = "signing";
  state.headline = "approve in wallet…";
  for (const p of plan) row(p.id, p.label, { status: "active", note: "waiting for your approval…" });
  let signed: (Transaction | VersionedTransaction)[];
  try {
    const toSign = plan.map((p) => p.tx);
    const signAll = wallet.signAllTransactions;
    if (typeof signAll === "function") {
      try {
        signed = await signAll(toSign);
      } catch (e) {
        const raw = errText(e);
        if (RE_REJECTED.test(raw)) throw e;
        if (!RE_NO_SIGNALL.test(raw)) throw e;
        signed = await signSequentially();
      }
    } else {
      signed = await signSequentially();
    }
    async function signSequentially(): Promise<(Transaction | VersionedTransaction)[]> {
      const out: (Transaction | VersionedTransaction)[] = [];
      for (let i = 0; i < plan.length; i++) {
        const p = plan[i];
        if (!p) continue;
        state.headline = `approve in wallet (${i + 1}/${plan.length})…`;
        row(p.id, p.label, { status: "active", note: `approve in wallet (${i + 1}/${plan.length})…` });
        out.push(await wallet.signTransaction(p.tx));
      }
      return out;
    }
  } catch (e) {
    const raw = errText(e);
    const friendly = RE_REJECTED.test(raw) ? "approval declined in the wallet — nothing was sent" : raw;
    for (const p of plan) row(p.id, p.label, { status: "error", note: friendly });
    return stop(friendly);
  }

  // 5 ── submit sequentially with confirmation, strict lifecycle order.
  state.phase = "submitting";
  for (const p of plan) row(p.id, p.label, { status: "active", note: "queued…" });
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    const tx = signed[i];
    if (!p || !tx) continue;
    state.headline = `${p.action}…`;
    row(p.id, p.label, { status: "active", note: "submitting to the base chain…" });
    try {
      const { signature, ms } = await submitAndConfirm(tx);
      row(p.id, p.label, { status: "done", note: undefined, ms, signature });
      onLog({ action: p.action, chain: "base", ms, signature });
      if (p.id === "session" && sessionParts) {
        mintedSession = persistSession({
          sessionSigner: sessionParts.sessionSigner,
          sessionToken: sessionParts.sessionToken,
          authority: owner,
          validUntil: sessionParts.validUntil,
        });
      }
    } catch (e) {
      const raw = errText(e);
      if (RE_ALREADY.test(raw)) {
        row(p.id, p.label, { status: "done", note: "already set up" });
        continue;
      }
      if (RE_UPSTREAM.test(raw)) {
        row(p.id, p.label, { status: "error", note: UPSTREAM_MESSAGE });
        return stop(UPSTREAM_MESSAGE, true);
      }
      const friendly = RE_STALE.test(raw)
        ? "the approval took too long and the transaction expired — tap Enable again to rebuild"
        : raw;
      row(p.id, p.label, { status: "error", note: friendly });
      return stop(friendly);
    }
  }

  state.phase = "done";
  state.headline = "one-click trading enabled";
  emit();
  return { ok: true, session: mintedSession, needsUsdc: state.needsUsdc };
}
