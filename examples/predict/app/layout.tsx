// ─────────────────────────────────────────────────────────────────────────────
// app/layout.tsx — root shell: void canvas, three faces loaded once here —
// Unbounded (display moments), Sora (UI copy), JetBrains Mono (every number,
// tabular). THE HARD PART: numbers must never reflow — the mono face +
// "tnum" on <body> (globals.css) keep timers and prices width-stable.
// GOTCHAS.md → (no API gotchas here) (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Sora, Unbounded } from "next/font/google";
import "./globals.css";

const unbounded = Unbounded({ subsets: ["latin"], weight: ["500", "700", "900"], variable: "--font-unbounded" });
const sora = Sora({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sora" });
const jbMono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-jbmono" });

export const metadata: Metadata = {
  title: "predict — what happens next?",
  description:
    "Pick a side. Cents are the odds. Your stake is the most you can lose. Markets backed by real Flash Trade V2 positions on Solana mainnet.",
};

export const viewport: Viewport = {
  themeColor: "#07080f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${unbounded.variable} ${sora.variable} ${jbMono.variable}`}>
      <body className="min-h-[100dvh] bg-bg font-sans text-ink antialiased">
        <div className="ambient" aria-hidden />
        {children}
      </body>
    </html>
  );
}
