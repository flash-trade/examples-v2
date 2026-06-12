// ─────────────────────────────────────────────────────────────────────────────
// app/page.tsx — single route; hands straight off to the client app. All
// state is browser state by design: wallet, session key, rounds cache.
// THE HARD PART: nothing — the client boundary is components/app.tsx.
// GOTCHAS.md → (no API gotchas here) (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────

import { App } from "@/components/app";

export default function Page() {
  return <App />;
}
