// app/markets/page.tsx — the prediction-market browser (phase 2/3 preview).
// Public + wallet-free: browse live markets, see the YES/NO odds. Tapping a card
// will open the detail + buy ticket (phase 4). Visit /markets.
import { Discover } from "@/components/discover";

export default function MarketsPage() {
  return (
    <main className="relative z-[1] min-h-[100dvh]">
      <Discover />
    </main>
  );
}
