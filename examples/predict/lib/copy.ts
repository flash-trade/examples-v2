// ─────────────────────────────────────────────────────────────────────────────
// lib/copy.ts — every user-facing sentence that carries risk, in one place.
// THE HARD PART: honesty without jargon. The disclosure NEGATES the
// prediction-market mental model (fixed odds) and states what this is: a
// short-term leveraged position with loss capped at your stake. Failure
// modes map to calm copy, never raw logs. GOTCHAS.md → "Withdrawals settle
// in two phases" · "err arrives inside HTTP 200" (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────

export const APP_NAME = "Updown";
export const TAGLINE = "Pick up or down. Your stake is the most you can lose.";

export const DISCLOSURE = {
  title: "How Updown actually works",
  paragraphs: [
    "This isn't a Polymarket-style prediction market — there are no fixed odds and no shared pot. When you call a direction, you open a real, short-term leveraged position on Flash Trade, sized by your stake.",
    "Your payoff is linear: for every 1% the price moves your way, you win your stake × leverage × 1%. Move against you and you lose the same way — but never more than your stake. If the price falls past your knockout level before time runs out, the round ends early and your stake is gone.",
    "Your numbers lock when you commit. The entry price, fees, and knockout level on the confirm screen are the ones you settle with — they don't drift afterward.",
    "Settlement happens from this browser with your session key. If you close the tab mid-round, the position simply stays open on-chain — come back any time and settle it. Nothing expires, nothing is lost.",
  ],
  checkbox: "I understand each round is a real leveraged position on Solana mainnet, with real money.",
} as const;

export const CONNECT_WARNING = "Mainnet. Real funds — every round is a real position. Start small.";

export const ENABLE_EXPLAINER = {
  title: "Enable one-tap rounds",
  body: "This sets up your trading account — it never moves your money. The only transfer is a 0.01 SOL top-up to your own session key for rent, returned when you revoke.",
  steps: ["Create session key (lives in this browser)", "Create basket + deposit ledger", "Delegate to the rollup"],
} as const;

/** Calm-copy mapping for everything that can go wrong. Raw details stay in
 *  the console for debugging; the user sees the human line. */
export function calmError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/429|rate.?limit/i.test(msg)) return "Your RPC is rate-limiting. Add a free RPC key in .env.local and reload.";
  if (/blockhash|expired|block height/i.test(msg)) return "That transaction went stale. Nothing was sent — try again.";
  if (/reject|declin|cancel/i.test(msg)) return "You declined in the wallet. Nothing was sent.";
  if (/settlement_receipt|AccountNotInitialized|0xbc4/i.test(msg))
    return "Your withdrawal is crossing from the rollup — usually 30–90 seconds. We'll keep checking.";
  if (/Position is empty/i.test(msg)) return "That position is already closed — refreshing your rounds.";
  if (/insufficient|not enough/i.test(msg)) return "Not enough balance for that. Lower the amount or deposit first.";
  if (/session|signer/i.test(msg)) return "Your session key needs a refresh — re-enable one-tap rounds to continue.";
  if (/fetch|network|ECONN|timeout/i.test(msg)) return "Network hiccup talking to the API. Check your connection and try again.";
  return "Something went wrong on the venue side. Your funds are safe — try again in a moment.";
}

export function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtDuration(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m} min`;
  return `${m / 60} hour${m === 60 ? "" : "s"}`;
}

export const explorerTxUrl = (signature: string) => `https://solscan.io/tx/${signature}`;

/** One price formatter for every surface — kills the scattered `>=1000`
 *  digit branches. "main" = focal numbers; "compact" = grid/axis hints. */
export function fmtPrice(v: number | null | undefined, mode: "main" | "compact" = "main"): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const digits = mode === "main" ? (v >= 1000 ? 2 : 4) : v >= 1000 ? 0 : 2;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
