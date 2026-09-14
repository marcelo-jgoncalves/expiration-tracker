/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";

// Frontend Production Foundation - dev server proxies /bff/* to a local/dev BFF endpoint so
// cookies work same-origin during development (production traffic is same-origin via
// CloudFront, see docs/frontend/frontend-production-foundation.md §8). No env-specific
// endpoint is hardcoded here - VITE_BFF_ORIGIN is read from the environment at dev-server
// start time only, never baked into the production build (the production build is always
// same-origin, this proxy exists purely for local development convenience).
export default defineConfig({
  plugins: [
    react(),
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
  server: {
    proxy: process.env["VITE_BFF_ORIGIN"]
      ? {
          "/bff": {
            target: process.env["VITE_BFF_ORIGIN"],
            changeOrigin: true,
            secure: false,
          },
        }
      : undefined,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    globals: true,
    exclude: ["**/node_modules/**", "**/e2e/**"],
  },
});
