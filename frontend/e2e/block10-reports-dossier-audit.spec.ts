import { test, expect, type Page } from "@playwright/test";

/**
 * Block 10 — A16 (Relatórios e exportações) + A17 (Exportar dossiê do fornecedor) + A23 (Log de
 * auditoria, convergence pass), D-2xx. Same mocking discipline as `block7-tracking-delivery-guest.spec.ts`.
 */

function mockSession(page: Page, session: { authenticated: boolean; activeOrganizationId?: string }) {
  return page.route("**/bff/session", (route) => route.fulfill({ json: session }));
}

function mockOrganizations(page: Page, role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  return page.route("**/bff/organizations", (route) =>
    route.fulfill({ json: { organizations: [{ organizationId: "org-1", displayName: "Org One", role, version: 1 }] } }),
  );
}

function subject() {
  return { subjectId: "subject-1", tenantId: "org-1", type: "VENDOR", displayName: "Conservare Facilities ME", tags: [], status: "ACTIVE", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 1 };
}

test.beforeEach(async ({ page }) => {
  await mockSession(page, { authenticated: true, activeOrganizationId: "org-1" });
});

// ---------------------------------------------------------------------------------------------
// E2E: A16 Relatórios e exportações
// ---------------------------------------------------------------------------------------------

test("E2E-B10-01: MEMBER sees a permission-limited EmptyState, never the catalog", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await page.goto("/reports");
  await expect(page.getByText(/administrados por OWNER\/ADMIN/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Baixar CSV" })).toHaveCount(0);
});

test("E2E-B10-02: ADMIN downloads a report CSV via the real BFF-proxied route", async ({ page }) => {
  await mockOrganizations(page, "ADMIN");
  await page.route("**/bff/api/reports/subscriptions", (route) => route.fulfill({ json: { subscriptions: [] } }));
  await page.route("**/bff/api/reports/expired-items", (route) =>
    route.fulfill({ status: 200, contentType: "text/csv", headers: { "content-disposition": 'attachment; filename="expired-items.csv"' }, body: "id,name\n1,Alvara" }),
  );

  await page.goto("/reports");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar CSV" }).first().click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("expired-items.csv");
});

test("E2E-B10-03: ADMIN creates a weekly subscription selecting real report types and a real member recipient", async ({ page }) => {
  await mockOrganizations(page, "ADMIN");
  await page.route("**/bff/api/organizations/members", (route) => route.fulfill({ json: { members: [{ userId: "user-1", role: "MEMBER", status: "ACTIVE", joinedAt: "2026-01-01T00:00:00.000Z", version: 1 }] } }));
  let postedBody: Record<string, unknown> | undefined;
  await page.route("**/bff/api/reports/subscriptions", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { subscriptions: [] } });
    postedBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ status: 201, json: { subscription: { subscriptionId: "sub-1", reportTypes: ["MISSING_REQUIREMENTS"], dayOfWeek: 1, localTime: "08:00", timeZone: "America/Sao_Paulo", recipientUserIds: ["user-1"], nextRunAt: "2026-09-15T11:00:00.000Z", version: 1, createdAt: "x", updatedAt: "x" } } });
  });

  await page.goto("/reports");
  // Two "Nova assinatura" buttons exist when the list is empty (the panel header's + the empty
  // state's own action) - the header one is first in DOM order.
  await page.getByRole("button", { name: "Nova assinatura" }).first().click();
  // The checkbox input itself is visually-hidden (Checkbox.css's clip pattern, same discipline
  // as RadioGroup.css) - clicking the label text is what a real mouse user does, and is what
  // actually reaches the input (native label click-forwarding), unlike Playwright resolving
  // straight to the intentionally non-hit-testable input via getByLabel(...).check(). Scoped to
  // the dialog since "Requisitos em falta" is also a static catalog card title on the same page.
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Requisitos em falta", { exact: true }).click();
  await dialog.getByText("user-1", { exact: true }).click();
  await expect(page.getByLabel("Requisitos em falta")).toBeChecked();
  await page.getByRole("button", { name: "Salvar" }).click();

  await expect.poll(() => postedBody?.["reportTypes"]).toEqual(["MISSING_REQUIREMENTS"]);
  await expect(page.getByText("Assinatura criada")).toBeVisible();
});

// ---------------------------------------------------------------------------------------------
// E2E: A17 Exportar dossiê do fornecedor
// ---------------------------------------------------------------------------------------------

test("E2E-B10-04: MEMBER sees a permission-limited EmptyState on the dossier route, never the wizard", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await page.route("**/bff/api/subjects/subject-1", (route) => route.fulfill({ json: { subject: subject() } }));
  await page.goto("/subjects/subject-1/dossier");
  await expect(page.getByText(/restrito a OWNER e ADMIN/)).toBeVisible();
});

test("E2E-B10-05: ADMIN previews, confirms, and downloads a dossier once the poll reports READY", async ({ page }) => {
  await mockOrganizations(page, "ADMIN");
  await page.route("**/bff/api/subjects/subject-1", (route) => route.fulfill({ json: { subject: subject() } }));
  await page.route("**/bff/api/document-archive/subjects/subject-1/dossier", (route) =>
    route.fulfill({ status: 201, json: { run: { runId: "run-1", subjectId: "subject-1", status: "PREVIEW_READY", scopeHash: "scope_abc", createdAt: "x", updatedAt: "x" }, rows: [{ requirementId: "r1", name: "Alvará", status: "SATISFIED" }] } }),
  );
  await page.route("**/bff/api/document-archive/subjects/subject-1/dossier/run-1/confirm", (route) =>
    route.fulfill({ json: { run: { runId: "run-1", subjectId: "subject-1", status: "CONFIRMED", scopeHash: "scope_abc", createdAt: "x", updatedAt: "x" } } }),
  );
  let pollCount = 0;
  await page.route("**/bff/api/document-archive/subjects/subject-1/dossier/run-1/download**", (route) => {
    pollCount += 1;
    if (pollCount < 2) return route.fulfill({ status: 409, json: { code: "CONFLICT", category: "CONFLICT", message: "not ready", retryable: false, details: { status: "GENERATING" } } });
    return route.fulfill({ json: { downloadUrl: "https://s3.example/dossier.pdf", expiresInSeconds: 300 } });
  });

  await page.goto("/subjects/subject-1/dossier");
  await expect(page.getByText(/Requisitos incluídos: 1/)).toBeVisible();
  await page.getByRole("button", { name: "Confirmar e gerar" }).click();
  await expect(page.getByText("Gerando dossiê…")).toBeVisible();
  await expect(page.getByRole("button", { name: "Baixar dossiê" })).toBeVisible({ timeout: 10_000 });
  await expect(page).toHaveURL(/runId=run-1/);
});

// ---------------------------------------------------------------------------------------------
// E2E: A23 Log de auditoria (convergence)
// ---------------------------------------------------------------------------------------------

function activityEntry(overrides: Record<string, unknown> = {}) {
  return {
    auditEventId: "evt-1",
    partition: "expiration",
    occurredAt: "2026-09-10T12:00:00.000Z",
    actor: { type: "USER", userId: "user-1" },
    action: "item:renew",
    resourceType: "ExpirationItem",
    resourceId: "item-1",
    changes: {},
    ...overrides,
  };
}

test("E2E-B10-06: ADMIN sees the activity feed as a real DataTable with the action in <code>, and 'Todos os eventos foram carregados.' once exhausted", async ({ page }) => {
  await mockOrganizations(page, "ADMIN");
  await page.route("**/bff/api/activity**", (route) => route.fulfill({ json: { entries: [activityEntry()], cursor: null, hasMore: false } }));

  await page.goto("/activity");
  await expect(page.locator("code", { hasText: "item:renew" })).toBeVisible();
  await expect(page.getByText("Todos os eventos foram carregados.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Carregar mais" })).toHaveCount(0);
});

test("E2E-B10-07: VIEWER never sees 'Relatórios' in the nav, and a direct URL to /reports shows the permission-limited state, not a 404", async ({ page }) => {
  await mockOrganizations(page, "VIEWER");
  await page.goto("/overview");
  await expect(page.getByRole("link", { name: "Relatórios" })).toHaveCount(0);

  await page.goto("/reports");
  await expect(page.getByText(/administrados por OWNER\/ADMIN/)).toBeVisible();
});
