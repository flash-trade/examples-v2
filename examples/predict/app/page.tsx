// ─────────────────────────────────────────────────────────────────────────────
// app/page.tsx — THE app: the prediction market (formerly at /markets). All
// state is browser state by design: wallet, session key, rounds cache. Connect
// any installed wallet; browsing is wallet-free.
// ─────────────────────────────────────────────────────────────────────────────

import { MarketsApp } from "@/components/markets-app";

export default function Page() {
  return <MarketsApp />;
}
