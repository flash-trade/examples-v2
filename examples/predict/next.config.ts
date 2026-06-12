// ─────────────────────────────────────────────────────────────────────────────
// next.config.ts — Next.js wiring for a workspace that ships raw TypeScript.
// THE HARD PART: flash-v2's entry point IS src/index.ts (no build step), so it
// must be transpiled by the app; anchor/gum-sdk pull Node-ish deps that need
// browser fallbacks. GOTCHAS.md → "Two chains, one flow" (../../GOTCHAS.md)
// ─────────────────────────────────────────────────────────────────────────────

import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The monorepo root (bun workspaces) — keeps Next from guessing wrong.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // flash-v2 is consumed straight from packages/flash-v2/src/*.ts — compile it.
  transpilePackages: ["flash-v2"],
  // Browsers auto-request /favicon.ico; we only ship app/icon.svg — redirect
  // instead of 404ing the console on every load.
  async redirects() {
    return [{ source: "/favicon.ico", destination: "/icon.svg", permanent: true }];
  },
  webpack: (config) => {
    // @coral-xyz/anchor (via @magicblock-labs/gum-sdk) probes Node built-ins;
    // none are needed in the browser paths this app uses.
    config.resolve.fallback = { ...config.resolve.fallback, fs: false, os: false, path: false };
    return config;
  },
};

export default nextConfig;
