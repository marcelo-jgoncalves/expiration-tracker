import { test, expect, type Page } from "@playwright/test";

/**
 * Core Expiration Vertical Slice E2E baseline (mission §65-67). Same mocking discipline as
 * e2e/smoke.spec.ts: every scenario mocks the BFF via page.route(), preserving the REAL
 * response shapes/status codes the frontend actually contracts against - never a fake success
 * that would misrepresent a real backend guarantee. There is no live BFF/backend reachable
 * from this sandbox (see e2e/smoke.spec.ts's header comment).
 */

// Wave B2B-10: real GET /bff/session shape since B2B-6/D-102, never tenantId/userId.
function mockSession(page: Page, session: { authenticated: boolean; activeOrganizationId?: string }) {
  return page.route("**/bff/session", (route) => route.fulfill({ json: session }));
}

function mockLoginRedirect(page: Page) {
  return page.route("**/bff/login**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>mock hosted UI</body></html>" }));
}

function mockDashboard(page: Page, items: unknown[]) {
  return page.route("**/bff/api/items/dashboard**", (route) => route.fulfill({ json: { items } }));
}

function activeItem(overrides: Record<string, unknown> = {}) {
  return {
    itemId: "item-1",
    tenantId: "tenant-1",
    name: "Apólice de Seguro",
    category: "Financeiro",
    dueDate: "2026-09-01T00:00:00.000Z",
    tags: [],
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

test.beforeEach(async ({ page }) => {
  await mockSession(page, { authenticated: true, activeOrganizationId: "org-1" });
});

test("E2E-01: login -> collection -> open detail", async ({ page }) => {
  await mockDashboard(page, [activeItem()]);
  await page.route("**/bff/api/items/item-1", (route) => route.fulfill({ json: { item: activeItem() } }));

  await page.goto("/items");
  await expect(page.getByRole("heading", { name: "Vencimentos" })).toBeVisible();
  await page.getByRole("link", { name: "Apólice de Seguro" }).click();

  await expect(page).toHaveURL(/\/items\/item-1$/);
  await expect(page.getByRole("heading", { name: "Apólice de Seguro" })).toBeVisible();
  await expect(page.getByText("Financeiro")).toBeVisible();
  // Focus management on route transitions (mission §56): client-side navigation doesn't reset
  // focus the way a full page load would - #surface-content (AppShell.tsx) must receive it
  // explicitly so a screen reader user is actually told the page changed.
  await expect(page.locator("#surface-content")).toBeFocused();
});

test("E2E-02: create expiration -> success -> item visible", async ({ page }) => {
  await mockDashboard(page, []);
  let createBody: Record<string, unknown> | undefined;
  await page.route("**/bff/api/items", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    createBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ status: 201, json: { item: activeItem({ itemId: "new-item", name: createBody["name"] }) } });
  });
  await page.route("**/bff/api/items/new-item", (route) => route.fulfill({ json: { item: activeItem({ itemId: "new-item", name: "Novo Alvará" }) } }));

  await page.goto("/items/new");
  await page.getByLabel(/^Nome/).fill("Novo Alvará");
  await page.getByLabel(/^Categoria/).fill("Licenças");
  await page.getByLabel(/^Data de vencimento/).fill("2026-10-15");
  await page.getByRole("button", { name: "Criar vencimento" }).click();

  await expect(page).toHaveURL(/\/items\/new-item$/);
  await expect(page.getByText("Vencimento criado com sucesso.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Novo Alvará" })).toBeVisible();
  expect(createBody?.["name"]).toBe("Novo Alvará");
});

test("E2E-03: create validation error -> correct -> success", async ({ page }) => {
  let callCount = 0;
  await page.route("**/bff/api/items", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    callCount += 1;
    if (callCount === 1) {
      return route.fulfill({
        status: 400,
        json: { code: "VALIDATION_FAILED", category: "VALIDATION", message: "Request body failed schema validation.", retryable: false, details: { errors: ["/category must NOT have fewer than 1 characters"] } },
      });
    }
    return route.fulfill({ status: 201, json: { item: activeItem({ itemId: "new-item" }) } });
  });
  await page.route("**/bff/api/items/new-item", (route) => route.fulfill({ json: { item: activeItem({ itemId: "new-item" }) } }));

  await page.goto("/items/new");
  await page.getByLabel(/^Nome/).fill("Contrato");
  await page.getByLabel(/^Data de vencimento/).fill("2026-10-15");
  // Categoria deliberately left blank to trigger client-side validation first...
  await page.getByRole("button", { name: "Criar vencimento" }).click();
  // The message now appears twice on purpose: once next to the field, once as a link in the
  // ErrorSummary at the top of the form (mission §40). Both must be the SAME string, which is
  // exactly what this pair of assertions pins down.
  await expect(page.locator("p.ui-field__error", { hasText: "Informe uma categoria." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Categoria: Informe uma categoria." })).toHaveAttribute("href", "#create-item-category");
  expect(callCount).toBe(0); // client-side validation blocked the request entirely

  // ...then filled in, simulating a value the client accepts but the backend still rejects.
  await page.getByLabel(/^Categoria/).fill("x");
  await page.getByRole("button", { name: "Criar vencimento" }).click();
  await expect(page.locator("p.ui-field__error", { hasText: "must NOT have fewer than 1 characters" })).toBeVisible();
  await expect(page.getByLabel(/^Nome/)).toHaveValue("Contrato"); // preserved across the error

  await page.getByLabel(/^Categoria/).fill("Contratos");
  await page.getByRole("button", { name: "Criar vencimento" }).click();
  await expect(page).toHaveURL(/\/items\/new-item$/);
  expect(callCount).toBe(2);
});

test("E2E-04: renew -> new cycle visible", async ({ page }) => {
  await page.route("**/bff/api/items/item-1", (route) => route.fulfill({ json: { item: activeItem({ version: 3 }) } }));
  await page.route("**/bff/api/items/item-1/renew", (route) => route.fulfill({ status: 201, json: { item: activeItem({ itemId: "item-2", dueDate: "2027-09-01T00:00:00.000Z", renewedFromId: "item-1" }) } }));
  await page.route("**/bff/api/items/item-2", (route) => route.fulfill({ json: { item: activeItem({ itemId: "item-2", dueDate: "2027-09-01T00:00:00.000Z", renewedFromId: "item-1" }) } }));

  await page.goto("/items/item-1/renew");
  await expect(page.getByText(/não é o mesmo que editar a data/)).toBeVisible();
  await page.getByLabel(/^Nova data de vencimento/).fill("2027-09-01");
  await page.getByRole("button", { name: "Confirmar renovação" }).click();

  await expect(page).toHaveURL(/\/items\/item-2$/);
  await expect(page.getByText("Renovação concluída - este é o novo ciclo.")).toBeVisible();
  await expect(page.getByText(/Ciclo anterior/)).toBeVisible();
});

test("E2E-05: OCC conflict -> recovery", async ({ page }) => {
  let renewCallCount = 0;
  await page.route("**/bff/api/items/item-1", (route) => {
    const version = renewCallCount === 0 ? 3 : 4;
    return route.fulfill({ json: { item: activeItem({ version }) } });
  });
  await page.route("**/bff/api/items/item-1/renew", (route) => {
    renewCallCount += 1;
    if (renewCallCount === 1) {
      return route.fulfill({ status: 409, json: { code: "CONFLICT", category: "CONFLICT", message: "VERSION_CONFLICT", retryable: false } });
    }
    return route.fulfill({ status: 201, json: { item: activeItem({ itemId: "item-2" }) } });
  });
  await page.route("**/bff/api/items/item-2", (route) => route.fulfill({ json: { item: activeItem({ itemId: "item-2" }) } }));

  await page.goto("/items/item-1/renew");
  await page.getByLabel(/^Nova data de vencimento/).fill("2027-09-01");
  await page.getByRole("button", { name: "Confirmar renovação" }).click();

  await expect(page.getByText("Este vencimento mudou desde que você o abriu")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar renovação" })).toBeDisabled();

  await page.getByRole("button", { name: "Recarregar" }).click();
  await expect(page.getByRole("button", { name: "Confirmar renovação" })).toBeEnabled();
  await page.getByRole("button", { name: "Confirmar renovação" }).click();

  await expect(page).toHaveURL(/\/items\/item-2$/);
  expect(renewCallCount).toBe(2);
});

test("E2E-06: session interruption during create -> reauthentication -> draft and idempotency key recovered", async ({ page }) => {
  await mockLoginRedirect(page);
  const idempotencyKeysSeen: string[] = [];
  let firstCreateInterrupted = false;
  await page.route("**/bff/api/items", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const key = route.request().headers()["idempotency-key"] ?? "";
    idempotencyKeysSeen.push(key);
    if (!firstCreateInterrupted) {
      firstCreateInterrupted = true;
      return route.fulfill({ status: 401, json: { code: "AUTH_REQUIRED", category: "AUTH", message: "sessão expirada", retryable: false } });
    }
    return route.fulfill({ status: 201, json: { item: activeItem({ itemId: "new-item" }) } });
  });
  await page.route("**/bff/api/items/new-item", (route) => route.fulfill({ json: { item: activeItem({ itemId: "new-item" }) } }));

  await page.goto("/items/new");
  await page.getByLabel(/^Nome/).fill("Alvará resiliente");
  await page.getByLabel(/^Categoria/).fill("Licenças");
  await page.getByLabel(/^Data de vencimento/).fill("2026-11-01");

  const loginRequest = page.waitForRequest((req) => req.url().includes("/bff/login"));
  await page.getByRole("button", { name: "Criar vencimento" }).click();
  await loginRequest; // the 401 mid-submission triggered AuthContext's SESSION_EXPIRED -> ProtectedRoute's reauthenticate()

  // Simulate returning from the BFF/Cognito round trip authenticated again, landing back on
  // the same route the whole time (returnTo carries the path, mission §23) - sessionStorage
  // (draft + idempotency key) survives this real in-page navigation, same tab, same origin.
  await page.goto("/items/new");

  await expect(page.getByLabel(/^Nome/)).toHaveValue("Alvará resiliente");
  await expect(page.getByLabel(/^Categoria/)).toHaveValue("Licenças");

  await page.getByRole("button", { name: "Criar vencimento" }).click();
  await expect(page).toHaveURL(/\/items\/new-item$/);

  expect(idempotencyKeysSeen).toHaveLength(2);
  expect(idempotencyKeysSeen[0]).toBe(idempotencyKeysSeen[1]); // same logical submission, same key (mission §29)
});
