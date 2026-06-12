// ─────────────────────────────────────────────────────────────────────────────
// app/page.tsx — the single route. Hands straight off to the client app:
// everything (wallet, stream, taps) is browser state by design.
// THE HARD PART: none here — see components/app.tsx for the orchestration.
// GOTCHAS.md → (no API gotchas here) (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────

import App from "@/components/app";

export default function Page() {
  return <App />;
}
