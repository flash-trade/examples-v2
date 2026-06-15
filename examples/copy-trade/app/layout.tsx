// ─────────────────────────────────────────────────────────────────────────────
// app/layout.tsx — root shell for the Liquid Glass copy-trade app. Loads the
// Space Grotesk display face and frames everything on the lit OLED surface
// (the glow mesh + grain live in globals.css). All live logic is client-side.
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
  title: "copy-trade — mirror the best, on the rollup",
  description:
    "Rank real Flash V2 leaders by win rate, follow one, and mirror their trades onto your own account with collateral-ratio sizing — manual or capped auto-copy, non-custodial. Liquid Glass UI on a MagicBlock Ephemeral Rollup.",
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
