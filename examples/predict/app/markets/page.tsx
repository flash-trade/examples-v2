// app/markets/page.tsx — the prediction-market app (phase 5).
// Browse markets wallet-free; connect + enable only when you back one. Real bets
// open a capped-loss Flash V2 perp with a bundled take-profit (the YES win).
// Visit /markets.
import { MarketsApp } from "@/components/markets-app";

export default function MarketsPage() {
  return <MarketsApp />;
}
