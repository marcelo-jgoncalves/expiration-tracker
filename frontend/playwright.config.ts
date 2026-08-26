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
    // Fixed locale/timezone (mission §132) - date formatting and the visual baselines below
    // must not depend on the machine's regional settings.
    locale: "pt-BR",
    timezoneId: "UTC",
  },
  webServer: {
    command: "npm run preview -- --port 4173 --strictPort --host 127.0.0.1",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env["CI"],
    timeout: 60_000,
    // Surfaces the preview server's own output on failure - a silent 30s timeout with no
    // server log gave no signal about why it never became ready in CI.
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    // Functional E2E - runs everywhere, including CI.
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /visual-regression\.spec\.ts/ },
    /**
     * Visual regression baselines (`npm run test:visual`), deliberately a SEPARATE project and
     * deliberately NOT part of `npm run test:e2e`.
     *
     * Why: Playwright screenshot baselines are per-platform (font rasterisation differs), and
     * the committed baselines were recorded on win32 while CI runs on ubuntu-latest. Wiring
     * this project into the CI job today would fail on a missing-baseline, not on a real
     * regression - a red build that teaches nobody anything. The adoption path is written
     * down in docs/frontend/visual-language-and-design-system.md §31 (record linux baselines
     * on a runner, commit them, then add this project to the CI frontend job); until that is
     * done, this suite is a real, reproducible LOCAL gate and CI keeps gating the same
     * surfaces functionally via e2e/expiration-density.spec.ts.
     */
    { name: "visual", use: { ...devices["Desktop Chrome"] }, testMatch: /visual-regression\.spec\.ts/ },
  ],
});
