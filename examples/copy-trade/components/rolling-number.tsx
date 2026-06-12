// ─────────────────────────────────────────────────────────────────────────────
// components/rolling-number.tsx — bloxwap's signature slot-reel price: each
// digit is a vertical 0-9 column, translateY'd to the active digit with the
// app's spring-out easing. THE HARD PART: column keys must be stable while the
// string length is constant, or React remounts and the roll never animates.
// GOTCHAS.md → (pure UI; no API gotchas) (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useState } from "react";

const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

function Reel({ digit }: { digit: number }) {
  return (
    <span aria-hidden className="relative inline-block h-[1em] w-[1ch] overflow-hidden">
      <span
        className="reel-col absolute left-0 top-0 flex flex-col"
        style={{ transform: `translateY(${-digit}em)` }}
      >
        {DIGITS.map((d) => (
          <span key={d} className="block h-[1em] w-[1ch] text-center leading-[1em]">
            {d}
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * Renders a pre-formatted numeric string (e.g. "$64.42") with rolling digits.
 * Separators ($ . , −) are static layers. Monospace + tabular so columns
 * never shift horizontally; a length change remounts (acceptable jump).
 */
export default function RollingNumber({
  value,
  className = "",
}: {
  value: string | null;
  className?: string;
}) {
  // HYDRATION GUARD: render plain text until after mount — the reels' inline
  // translateY styles must never participate in hydration (React #418).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (value === null || !mounted) {
    return <span className={`font-mono tabular-nums ${className}`}>{value ?? "$—"}</span>;
  }
  const chars = Array.from(value);
  return (
    // items-start (NOT baseline): every child is an identical h-[1em]
    // leading-[1em] box, so top-aligning the boxes puts separators ($ . ,)
    // and reel digits on the exact same optical baseline. Baseline alignment
    // breaks here because an overflow-hidden inline-block's flex baseline is
    // its box bottom, not its glyph baseline — the $ drifts.
    <span
      aria-label={value}
      className={`inline-flex h-[1em] items-start overflow-hidden font-mono tabular-nums leading-[1em] ${className}`}
    >
      {chars.map((ch, i) =>
        /[0-9]/.test(ch) ? (
          <Reel key={`d-${chars.length}-${i}`} digit={Number(ch)} />
        ) : (
          <span aria-hidden key={`s-${chars.length}-${i}`} className="block h-[1em] leading-[1em]">
            {ch}
          </span>
        ),
      )}
    </span>
  );
}
