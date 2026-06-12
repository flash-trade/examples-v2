// ─────────────────────────────────────────────────────────────────────────────
// components/token-icon.tsx — one token glyph, shared by ticket and picker.
// THE HARD PART: the vendored icon set mixes .png and .svg — try png, fall
// back to svg, fall back to a lettered dot. No network beyond /public.
// GOTCHAS.md → (no API gotchas here) (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useEffect, useState } from "react";

export function TokenIcon({ symbol, size = 20 }: { symbol: string; size?: number }) {
  const [ext, setExt] = useState<"png" | "svg" | "none">("png");
  useEffect(() => setExt("png"), [symbol]);
  if (ext === "none")
    return (
      <span
        className="flex items-center justify-center rounded-full bg-edge2 font-mono text-[9px] text-dim"
        style={{ width: size, height: size }}
      >
        {symbol.slice(0, 1)}
      </span>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/token-icons/${symbol.toLowerCase()}.${ext}`}
      alt=""
      width={size}
      height={size}
      className="rounded-full"
      onError={() => setExt(ext === "png" ? "svg" : "none")}
    />
  );
}
