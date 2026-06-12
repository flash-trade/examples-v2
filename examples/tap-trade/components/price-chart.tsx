// ─────────────────────────────────────────────────────────────────────────────
// components/price-chart.tsx — the full-bleed canvas: + cross grid, mint price
// line (right-anchored, tip at ~88% width), y-axis labels, and the live price
// pill glowing at the tip's Y. THE HARD PART: the tip LERPS between poll ticks
// (raf-driven) so the line drifts instead of jumping — and DPR/resize must
// never smear the 2px stroke. Perpetual raf isolated HERE, with cleanup.
// GOTCHAS.md → (client-side draw; no API gotchas) (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useRef } from "react";

const BG = "#0b0d0c";
const GRID = "#141816";
const LINE = "#34d399";
const SHORT_LINE = "#f43f5e";
const LABEL = "#46504b";
const PILL_TEXT = "#07120d";

const TOP_PAD = 76;   // keep the line clear of the floating top bar
const BOTTOM_PAD = 128; // …and of the action zone
const TIP_X = 0.88;  // latest point sits at 88% width
const GRID_GAP = 48;
const LABEL_GAP_PX = 40;

/** Round a raw step to a "nice" 1/2/5 × 10^k increment. */
function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / pow;
  const nice = unit >= 5 ? 10 : unit >= 2 ? 5 : unit >= 1 ? 2 : 1;
  return nice * pow;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export default function PriceChart({
  points,
  entryPrice = null,
  pnlSign = 0,
}: {
  points: number[];
  /** Open position's entry price — draws the entry line + the PnL shading. */
  entryPrice?: number | null;
  /** Sign of live PnL: 1 = profit (mint), -1 = underwater (red), 0 = flat. */
  pnlSign?: 1 | -1 | 0;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dataRef = useRef<number[]>(points);
  const dispRef = useRef<number | null>(null); // lerped display value of the tip
  const posRef = useRef<{ entry: number | null; sign: 1 | -1 | 0 }>({ entry: entryPrice, sign: pnlSign });

  useEffect(() => {
    dataRef.current = points;
  }, [points]);
  useEffect(() => {
    posRef.current = { entry: entryPrice, sign: pnlSign };
  }, [entryPrice, pnlSign]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let dpr = 1;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      dpr = Math.max(1, window.devicePixelRatio || 1);
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, w, h);

      // ── faint + cross grid, edge to edge ───────────────────────────────────
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = GRID_GAP / 2; gx < w; gx += GRID_GAP) {
        for (let gy = GRID_GAP / 2; gy < h; gy += GRID_GAP) {
          ctx.moveTo(gx - 3, gy);
          ctx.lineTo(gx + 3, gy);
          ctx.moveTo(gx, gy - 3);
          ctx.lineTo(gx, gy + 3);
        }
      }
      ctx.stroke();

      const data = dataRef.current;
      const n = data.length;
      if (n < 2) return; // DOM overlay shows the connecting state

      // ── lerp the tip so it drifts between ticks ────────────────────────────
      const target = data[n - 1] ?? 0;
      const prevDisp = dispRef.current;
      const disp = prevDisp === null ? target : prevDisp + (target - prevDisp) * 0.14;
      dispRef.current = disp;

      // ── y-scale over visible values (tip uses the display value) ───────────
      const pos = posRef.current;
      let min = disp;
      let max = disp;
      for (let i = 0; i < n - 1; i++) {
        const v = data[i] ?? disp;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      // an open position's entry must stay on screen — include it in the scale
      if (pos.entry !== null && Number.isFinite(pos.entry)) {
        if (pos.entry < min) min = pos.entry;
        if (pos.entry > max) max = pos.entry;
      }
      const minSpan = Math.max(Math.abs(target) * 0.0008, 1e-9);
      if (max - min < minSpan) {
        const mid = (max + min) / 2;
        min = mid - minSpan / 2;
        max = mid + minSpan / 2;
      }
      const plotH = Math.max(1, h - TOP_PAD - BOTTOM_PAD);
      const yOf = (v: number) => TOP_PAD + (1 - (v - min) / (max - min)) * plotH;
      const priceAt = (y: number) => min + (1 - (y - TOP_PAD) / plotH) * (max - min);

      // ── right-edge y-axis labels every ~40px, flush to the screen edge ─────
      // (Header chips keep their own pr-[72px] so the top label rows stay clear.)
      const step = niceStep(((max - min) / plotH) * LABEL_GAP_PX);
      const decimals = step >= 1 ? 2 : Math.min(6, Math.max(2, -Math.floor(Math.log10(step))));
      ctx.font = "600 10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillStyle = LABEL;
      // labels live BETWEEN the chrome bands: below the top bar (y≥56) and
      // above the action zone (y ≤ h−BOTTOM_PAD+24) — numbers never sit
      // behind the SHORT/LONG buttons (user-flagged collision).
      const labelFloor = h - BOTTOM_PAD + 24;
      const lo = priceAt(labelFloor);
      const hi = priceAt(56);
      for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
        const y = yOf(v);
        if (y < 56 || y > labelFloor) continue;
        ctx.fillText(`$${v.toFixed(decimals)}`, w - 8, y);
      }

      // ── the line: right-anchored, stretched across the full width ──────────
      // Council verdict: scale spacing by the points we HAVE, not the buffer
      // cap — a young session reads as a full-width line from the first ticks
      // (the bloxwap read) and gently compresses as history accrues, instead
      // of huddling in the right third looking broken for four minutes.
      const tipX = w * TIP_X;
      const spacing = tipX / Math.max(1, n - 1);
      const xOf = (i: number) => tipX - (n - 1 - i) * spacing;

      // ── open position layer: entry line + PnL shading (drawn UNDER the line)
      // The price line itself recolors with the position's PnL: mint in
      // profit, red underwater (user spec) — flat/no-position stays mint.
      const inPosition = pos.entry !== null && Number.isFinite(pos.entry) && pos.sign !== 0;
      const lineColor = inPosition ? (pos.sign > 0 ? LINE : SHORT_LINE) : LINE;
      if (pos.entry !== null && Number.isFinite(pos.entry)) {
        const entryY = yOf(pos.entry);
        // the "fun shadowing": a soft gradient band between entry and the live
        // price — green when the position is winning, red when it's not —
        // fading from the price line back toward the entry line.
        if (inPosition && Math.abs(yOf(disp) - entryY) > 1.5) {
          const curY = yOf(disp);
          const grad = ctx.createLinearGradient(0, curY, 0, entryY);
          const c = pos.sign > 0 ? "52, 211, 153" : "244, 63, 94";
          grad.addColorStop(0, `rgba(${c}, 0.16)`);
          grad.addColorStop(1, `rgba(${c}, 0.02)`);
          ctx.fillStyle = grad;
          ctx.fillRect(0, Math.min(curY, entryY), w, Math.abs(curY - entryY));
        }
        // dashed hairline at entry + a tiny tag on the right edge
        ctx.save();
        ctx.strokeStyle = "rgba(154, 165, 160, 0.55)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, entryY);
        ctx.lineTo(w, entryY);
        ctx.stroke();
        ctx.restore();
        ctx.font = "600 9px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.textAlign = "right";
        ctx.fillStyle = "rgba(154, 165, 160, 0.9)";
        ctx.fillText(`entry $${pos.entry.toFixed(decimals)}`, w - 8, entryY - 6);
      }

      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const v = i === n - 1 ? disp : (data[i] ?? disp);
        const x = xOf(i);
        const y = yOf(v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // ── glow ONLY at the tip (the app's one sanctioned glow) ───────────────
      const tipY = yOf(disp);
      ctx.save();
      ctx.shadowColor = pos.sign < 0 && inPosition ? "rgba(244, 63, 94, 0.55)" : "rgba(52, 211, 153, 0.55)";
      ctx.shadowBlur = 8;
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.arc(tipX, tipY, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // ── live price pill at the tip's Y — a MOVING OVERLAY on the label
      // column, right-aligned to the screen edge (drawn after the labels so it
      // rides on top of them, never pushing them left). The bloxwap read.
      const text = `$${disp.toFixed(2)}`;
      ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
      const tw = ctx.measureText(text).width;
      const pillH = 20;
      const pillW = tw + 16;
      const pillX = w - pillW - 4; // right-anchored, overlaying the y-axis labels
      const pillY = Math.min(Math.max(tipY - pillH / 2, 10), h - pillH - 10);
      ctx.save();
      ctx.shadowColor = "rgba(52, 211, 153, 0.25)";
      ctx.shadowBlur = 4;
      ctx.fillStyle = lineColor;
      roundRect(ctx, pillX, pillY, pillW, pillH, 4);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = PILL_TEXT;
      ctx.textAlign = "center";
      ctx.fillText(text, pillX + pillW / 2, pillY + pillH / 2 + 0.5);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={wrapRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="block h-full w-full" />
      {points.length < 2 && (
        <div className="absolute inset-0 grid place-items-center">
          <span className="soft-pulse font-mono text-xs text-faint">connecting to Pyth Lazer…</span>
        </div>
      )}
    </div>
  );
}
