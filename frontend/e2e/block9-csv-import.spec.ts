import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Block 9 — A15 (Importação em massa / CSV). Same mocking/probe discipline as
 * `e2e/block7-tracking-delivery-guest.spec.ts`. The presigned-upload PUT is mocked at its own
 * absolute URL (never `/bff/api/*`, per `api/documents.ts`'s two-phase model reused here — see
 * `ImportWizard.tsx`'s header comment for the real backend contract this mirrors).
 */

// Same-origin path — an external domain would be blocked by the app's own CSP `connect-src
// 'self'` (`frontend/index.html`) — the real presigned S3 URL is genuinely cross-origin and
// CSP-exempt only via the deployed CSP's explicit storage-domain allowlist, not reproducible
// here; this mock stays same-origin only to exercise the rest of the code path under the page's
// real CSP, matching `block5-document-detail.spec.ts`/`block6-requests-guest.spec.ts`'s own
// documented convention for the same constraint.
const UPLOAD_URL = "/mock-storage/import-upload";

function mockSession(page: Page, session: { authenticated: boolean; activeOrganizationId?: string }) {
  return page.route("**/bff/session", (route) => route.fulfill({ json: session }));
}

function mockOrganizations(page: Page, role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  return page.route("**/bff/organizations", (route) =>
    route.fulfill({ json: { organizations: [{ organizationId: "org-1", displayName: "Org One", role, version: 1 }] } }),
  );
}

function importJob(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job-1",
    tenantId: "org-1",
    targetEntityType: "TrackedSubject",
    status: "PARSING",
    columnMapping: { schemaVersion: 1, targetKind: "TrackedSubject", columns: { displayName: "displayName", type: "type" } },
    columnMappingSha256: "abc",
    expiresAt: "2026-02-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

test.beforeEach(async ({ page }) => {
  await mockSession(page, { authenticated: true, activeOrganizationId: "org-1" });
});

test("E2E-B9-01: OWNER runs the full upload -> processing -> preview -> commit flow end to end, real partial-success counts shown honestly", async ({ page }) => {
  await mockOrganizations(page, "OWNER");
  await page.route("**/bff/api/imports", (route: Route) =>
    route.fulfill({ status: 201, json: { jobId: "job-1", uploadUrl: UPLOAD_URL, requiredHeaders: { "x-amz-meta": "x" }, expiresAt: "2026-01-01T00:10:00.000Z" } }),
  );
  await page.route(UPLOAD_URL, (route: Route) => route.fulfill({ status: 200 }));

  let getCalls = 0;
  await page.route("**/bff/api/imports/job-1", (route: Route) => {
    getCalls += 1;
    // First read still parsing (the real async wait); every read after that is the finished
    // preview with a genuine partial-success shape (10 total, only 7 accepted).
    if (getCalls === 1) return route.fulfill({ json: { job: importJob({ status: "PARSING" }) } });
    return route.fulfill({
      json: { job: importJob({ status: "PREVIEW_READY", totalRows: 10, acceptedRows: 7, rejectedRows: 1, duplicateRows: 2, version: 2 }) },
    });
  });

  let commitCalled = false;
  await page.route("**/bff/api/imports/job-1/commit", (route: Route) => {
    commitCalled = true;
    return route.fulfill({ status: 202, json: {} });
  });

  await page.goto("/imports/new");
  await expect(page.getByRole("heading", { name: "Enviar arquivo" })).toBeVisible();

  await page.getByLabel("Selecionar arquivo").setInputFiles({ name: "fornecedores.csv", mimeType: "text/csv", buffer: Buffer.from("displayName,type\nAcme,VENDOR") });
  await page.getByRole("button", { name: "Enviar e continuar" }).click();

  // Real navigation to the persistent per-job URL (P0.2 resumability), then the real async wait.
  await expect(page).toHaveURL(/\/imports\/job-1$/);
  await expect(page.getByText("Analisando o arquivo…")).toBeVisible();

  // Never all-or-nothing: 7 accepted / 1 rejected / 2 duplicates, all reported plainly.
  await expect(page.getByText(/7 de 10 linhas válidas/)).toBeVisible();
  await expect(page.getByText(/2 linhas correspondem a um Fornecedor já existente/)).toBeVisible();
  await expect(page.getByText(/1 linha com erro de validação será ignorada/)).toBeVisible();

  await page.getByRole("button", { name: "Confirmar importação" }).click();
  await expect.poll(() => commitCalled).toBe(true);
});

test("E2E-B9-02: a job that already reached COMMITTED (resumed from its persistent URL) shows the final aggregate result, never re-offers Confirmar", async ({ page }) => {
  await mockOrganizations(page, "OWNER");
  await page.route("**/bff/api/imports/job-1", (route: Route) =>
    route.fulfill({ json: { job: importJob({ status: "COMMITTED", totalRows: 5, acceptedRows: 4, rejectedRows: 1, duplicateRows: 0 }) } }),
  );

  await page.goto("/imports/job-1");
  await expect(page.getByText(/Importação concluída/)).toBeVisible();
  await expect(page.getByText(/4 fornecedores processados/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar importação" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Ver Fornecedores" })).toBeVisible();
});

test("E2E-B9-03 (denial): a VIEWER has no nav entry point and cannot start or act on an import - read-only status only", async ({ page }) => {
  await mockOrganizations(page, "VIEWER");
  await page.route("**/bff/api/imports/job-1", (route: Route) =>
    route.fulfill({ json: { job: importJob({ status: "PREVIEW_READY", totalRows: 5, acceptedRows: 5, rejectedRows: 0, duplicateRows: 0 }) } }),
  );

  await page.goto("/overview");
  await expect(page.getByRole("link", { name: "Importar CSV" })).toHaveCount(0);

  await page.goto("/imports/new");
  await expect(page.getByText("Você não tem permissão para iniciar uma importação.")).toBeVisible();
  await expect(page.getByLabel("Selecionar arquivo")).toHaveCount(0);

  await page.goto("/imports/job-1");
  await expect(page.getByText("Pré-visualizar e deduplicar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar importação" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Voltar" })).toHaveCount(0);
});

test("E2E-B9-04 (accessibility): focus moves to the new step's own heading on every real step transition, announced via a live region", async ({ page }) => {
  await mockOrganizations(page, "OWNER");
  let commitCalled = false;
  await page.route("**/bff/api/imports/job-1", (route: Route) => {
    const status = commitCalled ? "COMMITTED" : "PREVIEW_READY";
    return route.fulfill({ json: { job: importJob({ status, totalRows: 3, acceptedRows: 3, rejectedRows: 0, duplicateRows: 0, version: 4 }) } });
  });
  await page.route("**/bff/api/imports/job-1/commit", (route: Route) => {
    commitCalled = true;
    return route.fulfill({ status: 202, json: {} });
  });

  await page.goto("/imports/job-1");
  await expect(page.getByRole("heading", { name: "Pré-visualizar e deduplicar" })).toBeVisible();

  await page.getByRole("button", { name: "Confirmar importação" }).click();
  await expect.poll(() => commitCalled).toBe(true);

  const heading = page.getByRole("heading", { name: "Confirmar" });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.getByText("Etapa atual: 5. Confirmar")).toBeVisible();
});
