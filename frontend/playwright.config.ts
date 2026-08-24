import { defineConfig, devices } from "@playwright/test";

/**
 * Browser smoke baseline (Frontend Production Foundation mission §64) - covers the auth/
 * session/routing/error surface that actually exists (Overview, ProtectedRoute, AuthContext),
 * never a full E2E suite against a live BFF/backend (none is reachable from this sandbox).
 * Every scenario mocks the BFF via page.route() - see e2e/smoke.spec.ts's header comment for
 * why OCC/idempotency are deliberately NOT covered here (no mutation UI exists yet).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run preview -- --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env["CI"],
    timeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
