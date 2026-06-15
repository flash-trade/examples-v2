// app/markets/page.tsx — the prediction market moved to the root route (/).
// Redirect any old /markets links there so there is one canonical home.
import { redirect } from "next/navigation";

export default function MarketsPage() {
  redirect("/");
}
