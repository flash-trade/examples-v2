// ─────────────────────────────────────────────────────────────────────────────
// postcss.config.mjs — Tailwind v4 enters through PostCSS; no tailwind.config.
// THE HARD PART: nothing — v4 reads design tokens from @theme in globals.css,
// so the entire look lives in one CSS file instead of a JS config.
// GOTCHAS.md → (no API gotchas here) (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────

const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
