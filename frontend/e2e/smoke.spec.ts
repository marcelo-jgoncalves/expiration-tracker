import { test, expect, type Page } from "@playwright/test";

/**
 * Browser smoke baseline (mission §64). Every scenario mocks the BFF via page.route() - there
 * is no live BFF/backend reachable from this sandbox, and mocking preserves the REAL response
 * shapes/status codes the frontend actually contracts against (never a fake success that would
 * silently claim BLOCKER-A/B/C solved - mission's "mocks devem preservar semântica real").
 *
 * OCC (409) and idempotent-create are deliberately NOT covered here: this foundation stage has
 * no Create/Renew mutation UI (mission's explicit non-goal), so there is no real DOM flow to
 * drive a mutation through. Those behaviors are covered where the real logic actually lives -
 * test/hooks/useOccMutation.test.tsx and test/hooks/useIdempotentMutation.test.tsx - rather
 * than faked here against UI that doesn't exist yet.
 */

function mockSession(page: Page, session: { authenticated: boolean; tenantId?: string; userId?: string }) {
  return page.route("**/bff/session", (route) => route.fulfill({ json: session }));
}

function mockDashboard(page: Page, response: unknown, status = 200) {
  return page.route("**/bff/api/items/dashboard**", (route) => route.fulfill({ status, json: response }));
}

test("an unauthenticated visit is redirected to the BFF login, carrying the originally requested path as returnTo", async ({ page }) => {
  await mockSession(page, { authenticated: false });
  const loginRequest = page.waitForRequest((req) => req.url().includes("/bff/login"));
  await page.route("**/bff/login**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>mock hosted UI</body></html>" }));

  await page.goto("/items");

  const request = await loginRequest;
  const url = new URL(request.url());
  expect(url.searchParams.get("returnTo")).toBe("/items");
});

test("an authenticated session renders the dashboard sorted by due date ascending (most urgent first)", async ({ page }) => {
  await mockSession(page, { authenticated: true, tenantId: "tenant-1", userId: "user-1" });
  await mockDashboard(page, {
    items: [
      { itemId: "b", tenantId: "tenant-1", name: "Later", category: "x", dueDate: "2026-12-01", tags: [], status: "ACTIVE", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", version: 1 },
      { itemId: "a", tenantId: "tenant-1", name: "Sooner", category: "x", dueDate: "2026-09-01", tags: [], status: "ACTIVE", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", version: 1 },
    ],
  });

  await page.goto("/overview");

  // Overview is a semantic table since the Visual Language milestone (it was a <ul>), so the
  // ordering assertion moved from <li> to data rows - same property, correct primitive.
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Sooner");
  await expect(rows.last()).toContainText("Later");
});

test("a true-empty dashboard shows the true-empty state, distinct copy from a filtered/unavailable state", async ({ page }) => {
  await mockSession(page, { authenticated: true, tenantId: "tenant-1", userId: "user-1" });
  await mockDashboard(page, { items: [] });

  await page.goto("/overview");

  await expect(page.getByText("Nenhum vencimento cadastrado ainda.")).toBeVisible();
});

test("a backend failure on the dashboard call shows the error state with a working retry", async ({ page }) => {
  await mockSession(page, { authenticated: true, tenantId: "tenant-1", userId: "user-1" });
  let callCount = 0;
  await page.route("**/bff/api/items/dashboard**", (route) => {
    callCount += 1;
    if (callCount === 1) {
      // retryable: false - a definitive backend failure, never auto-retried by
      // retryPolicyFor("safe-read"). A *retryable* transient failure is deliberately NOT
      // exercised here: the query layer would auto-recover from that before the user ever
      // sees an error, which is correct behavior and is covered by
      // test/api/retryPolicy.test.ts instead of faked against this UI.
      return route.fulfill({ status: 500, json: { code: "INTERNAL", category: "INTERNAL", message: "erro interno", retryable: false } });
    }
    return route.fulfill({ json: { items: [] } });
  });

  await page.goto("/overview");

  await expect(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByText("Nenhum vencimento cadastrado ainda.")).toBeVisible();
  expect(callCount).toBe(2);
});

test("a 401 mid-session (session expired) triggers a redirect back to the BFF login", async ({ page }) => {
  await mockSession(page, { authenticated: true, tenantId: "tenant-1", userId: "user-1" });
  await page.route("**/bff/api/items/dashboard**", (route) => route.fulfill({ status: 401, json: { code: "AUTH_REQUIRED", category: "AUTH", message: "sessão expirada", retryable: false } }));
  const loginRequest = page.waitForRequest((req) => req.url().includes("/bff/login"));
  await page.route("**/bff/login**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>mock hosted UI</body></html>" }));

  await page.goto("/overview");

  const request = await loginRequest;
  const url = new URL(request.url());
  expect(url.searchParams.get("returnTo")).toBe("/overview");
});

test("logout calls the BFF's logout endpoint and returns to the login redirect", async ({ page }) => {
  await mockSession(page, { authenticated: true, tenantId: "tenant-1", userId: "user-1" });
  await mockDashboard(page, { items: [] });
  const logoutRequest = page.waitForRequest((req) => req.url().includes("/bff/session/logout") && req.method() === "POST");
  await page.route("**/bff/session/logout", (route) => route.fulfill({ status: 204, body: "" }));
  const loginRequest = page.waitForRequest((req) => req.url().includes("/bff/login"));
  await page.route("**/bff/login**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>mock hosted UI</body></html>" }));

  await page.goto("/overview");
  await expect(page.getByText("Nenhum vencimento cadastrado ainda.")).toBeVisible();
  await page.getByRole("button", { name: "Sair" }).click();

  await logoutRequest;
  await loginRequest;
});
