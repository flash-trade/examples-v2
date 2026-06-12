// ─────────────────────────────────────────────────────────────────────────────
// app/layout.tsx — root shell: dark canvas, system sans UI face with Space
// Grotesk reserved for display moments, metadata. THE HARD PART: none — all
// live logic is client-side (no DB, no server state); this file frames it in
// green-tinted near-black and loads the display font.
// GOTCHAS.md → (no API gotchas here) (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────

import type { Metadata, Viewport } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: "tap-trade — tap. trade. ~30 ms.",
  description:
    "Connect a wallet, Enable One-Click Trading once, then tap SHORT/LONG on a live chart — fills confirm on a MagicBlock Ephemeral Rollup in ~30-50 ms. Flash V2 mainnet demo.",
};

export const viewport: Viewport = {
  themeColor: "#0b0d0c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={grotesk.variable}>
      <body className="min-h-[100dvh] bg-bg font-sans text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
