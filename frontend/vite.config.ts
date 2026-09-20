/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import basicSsl from "@vitejs/plugin-basic-ssl";

// Frontend Production Foundation - dev server proxies /bff/* to a local/dev BFF endpoint so
// cookies work same-origin during development (production traffic is same-origin via
// CloudFront, see docs/frontend/frontend-production-foundation.md §8). No env-specific
// endpoint is hardcoded here - VITE_BFF_ORIGIN is read from the environment at dev-server
// start time only, never baked into the production build (the production build is always
// same-origin, this proxy exists purely for local development convenience).
const bffProxy = process.env["VITE_BFF_ORIGIN"]
  ? {
      "/bff": {
        target: process.env["VITE_BFF_ORIGIN"],
        changeOrigin: true,
        secure: false,
      },
    }
  : undefined;

export default defineConfig(({ command }) => ({
  plugins: [
    react(),
    // Real finding, 2026-09-20: the BFF's session/PKCE cookies are `__Host-` prefixed (Secure
    // required by the prefix itself, correctly so - see src/modules/bff/domain/cookies.ts).
    // Browsers silently DROP `Secure` cookies on a plain-HTTP response, even one proxied from
    // an HTTPS upstream (VITE_BFF_ORIGIN) - the connection the browser actually sees is
    // `http://localhost`, so the whole authenticated-login loop 401s at `/bff/callback` with
    // no cookie ever stored, no matter how correct the credentials are. `basicSsl()` serves the
    // dev server itself over HTTPS (self-signed - the browser will prompt to trust it once),
    // which is enough for `Secure` cookies to be accepted. Dev-server only (`command ===
    // "serve"`), never applied to `vite build` or `vitest` - production traffic is always
    // real HTTPS via CloudFront already, and the test environment never hits real cookies.
    ...(command === "serve" ? [basicSsl()] : []),
    // PERF-09 (Ciclo B) - bundle analyzer. Only produces `dist/stats.html`, an HTML report file;
    // it does not change what `vite build` emits for the app itself and has no dev-server cost
    // (the plugin's own docs: safe to leave on for every build, only runs at build time -
    // `template: "treemap"` is the plugin's recommended default for spotting large chunks).
    visualizer({
      filename: "dist/stats.html",
      gzipSize: true,
      brotliSize: true,
      template: "treemap",
    }),
  ],
  server: { proxy: bffProxy },
  // Real finding, 2026-09-20: `vite dev`'s HMR CSS injection is inline `<style>` tags added by
  // JS - blocked outright by this app's own CSP (`index.html`: `style-src 'self'`, no
  // `unsafe-inline`), so a screen loaded via `npm run dev` renders with ZERO styling (confirmed
  // via real CSP violation console errors, not a guess) even though every other part of the
  // page (routing, data, icons) works. `vite preview` serves the REAL production build (actual
  // `<link rel="stylesheet">` files, same mechanism as the real deployed app) instead, so CSP
  // never conflicts with it - `preview` reuses the same proxy so it still reaches the real dev
  // BFF for local validation without deploying anything.
  preview: { proxy: bffProxy },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    globals: true,
    exclude: ["**/node_modules/**", "**/e2e/**"],
  },
}));
