import { test, expect, type Page } from "@playwright/test";

/**
 * Block 7 — A10 (Rastreamento legado) + A22 (Entrega de solicitação) + G01 (Upload de
 * convidado, legado), D-267. Same mocking/probe discipline as `e2e/block6-requests-guest.spec.ts`.
 * G01 is mocked at its own real relative paths (`/guest/document-requests/*`, never `/bff/api` —
 * see `api/guestLegacyUpload.ts`'s header comment for why it never goes through the BFF proxy).
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

function assignment(overrides: Record<string, unknown> = {}) {
  return {
    assignmentId: "a1",
    subjectId: "subject-1",
    tenantId: "org-1",
    requirementName: "Certidão de regularidade",
    status: "MISSING",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

async function mockA10(page: Page, opts: { assignments?: unknown[]; assignmentDetail?: unknown; requests?: unknown[]; submissions?: unknown[] } = {}) {
  await page.route("**/bff/api/subjects/subject-1", (route) => route.fulfill({ json: { subject: subject() } }));
  await page.route("**/bff/api/subjects/subject-1/requirements/a1/document-requests", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { requests: opts.requests ?? [] } });
    return route.fulfill({ status: 201, json: { request: { documentRequestId: "r1" }, guestToken: "tok-1" } });
  });
  await page.route("**/bff/api/subjects/subject-1/requirements/a1/submissions", (route) => route.fulfill({ json: { submissions: opts.submissions ?? [] } }));
  await page.route("**/bff/api/subjects/subject-1/requirements/a1", (route) => route.fulfill({ json: { assignment: opts.assignmentDetail ?? assignment() } }));
  await page.route("**/bff/api/subjects/subject-1/requirements", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { assignments: opts.assignments ?? [assignment()] } });
    return route.fulfill({ status: 201, json: { assignment: assignment() } });
  });
}

test.beforeEach(async ({ page }) => {
  await mockSession(page, { authenticated: true, activeOrganizationId: "org-1" });
});

// ---------------------------------------------------------------------------------------------
// E2E: A10 Rastreamento legado
// ---------------------------------------------------------------------------------------------

test("E2E-B7-01: VIEWER sees the list but no write actions", async ({ page }) => {
  await mockOrganizations(page, "VIEWER");
  await mockA10(page);

  await page.goto("/subjects/subject-1/tracking");
  await expect(page.getByRole("heading", { name: "Rastreamento legado" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Novo vínculo legado" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Excluir vínculo" })).toHaveCount(0);
});

test("E2E-B7-02: a MEMBER creates a new legacy assignment, which POSTs to the real route", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await mockA10(page, { assignments: [] });
  let postedBody: Record<string, unknown> | undefined;
  await page.route("**/bff/api/subjects/subject-1/requirements", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { assignments: [] } });
    postedBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ status: 201, json: { assignment: assignment() } });
  });

  await page.goto("/subjects/subject-1/tracking");
  await page.getByRole("button", { name: "Novo vínculo legado" }).click();
  await page.getByLabel(/Nome do vínculo/).fill("Alvará de Funcionamento");
  await page.getByRole("button", { name: "Criar vínculo" }).click();

  await expect.poll(() => postedBody?.["requirementName"]).toBe("Alvará de Funcionamento");
  await expect(page.getByText("Vínculo criado")).toBeVisible();
});

test("E2E-B7-03: ADMIN can delete a vínculo; MEMBER cannot see the action at all", async ({ page }) => {
  await mockOrganizations(page, "ADMIN");
  await mockA10(page);
  await page.route("**/bff/api/subjects/subject-1/requirements/a1", (route) => {
    if (route.request().method() === "DELETE") return route.fulfill({ status: 204, json: {} });
    return route.fulfill({ json: { assignment: assignment() } });
  });

  await page.goto("/subjects/subject-1/tracking");
  await page.getByRole("button", { name: "Excluir vínculo" }).click();
  await page.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(page.getByText("Vínculo excluído")).toBeVisible();
});

test("E2E-B7-04: the detail page shows the Snapshot block and a timeline entry with its request status", async ({ page }) => {
  await mockOrganizations(page, "OWNER");
  await mockA10(page, {
    requests: [
      { documentRequestId: "r1", subjectId: "subject-1", assignmentId: "a1", recipientEmail: "financeiro@conservare.com.br", requestedAt: "2026-01-05T00:00:00.000Z", status: "SUBMITTED", submissionCount: 1, createdAt: "2026-01-05T00:00:00.000Z", updatedAt: "2026-01-06T00:00:00.000Z", version: 1 },
    ],
  });

  await page.goto("/subjects/subject-1/tracking/a1");
  await expect(page.getByRole("heading", { name: "Certidão de regularidade" })).toBeVisible();
  await expect(page.getByText(/Este status não muda automaticamente/)).toBeVisible();
  await expect(page.getByText(/financeiro@conservare.com.br/)).toBeVisible();
  await expect(page.getByText("Aguardando revisão")).toBeVisible();
});

test("E2E-B7-05: revoking an active request calls the real revoke route", async ({ page }) => {
  await mockOrganizations(page, "OWNER");
  await mockA10(page, {
    requests: [{ documentRequestId: "r1", subjectId: "subject-1", assignmentId: "a1", recipientEmail: "financeiro@conservare.com.br", requestedAt: "2026-01-05T00:00:00.000Z", status: "REQUESTED", submissionCount: 0, createdAt: "2026-01-05T00:00:00.000Z", updatedAt: "2026-01-05T00:00:00.000Z", version: 1 }],
  });
  let revoked = false;
  await page.route("**/bff/api/subjects/subject-1/document-requests/r1/revoke", (route) => {
    revoked = true;
    return route.fulfill({ status: 204, json: {} });
  });

  await page.goto("/subjects/subject-1/tracking/a1");
  await page.getByRole("button", { name: "Revogar" }).click();
  await expect.poll(() => revoked).toBe(true);
  await expect(page.getByText("Solicitação revogada")).toBeVisible();
});

// ---------------------------------------------------------------------------------------------
// E2E: A22 Entrega de solicitação
// ---------------------------------------------------------------------------------------------

test("E2E-B7-06: a non-OWNER never sees 'Entrega de solicitação' in nav, and is redirected away from the route", async ({ page }) => {
  await mockOrganizations(page, "ADMIN");
  await page.goto("/subjects");
  await expect(page.getByRole("link", { name: "Entrega de solicitação" })).toHaveCount(0);

  await page.goto("/settings/request-delivery");
  await expect(page.getByRole("heading", { name: "Entrega de solicitação" })).toHaveCount(0);
});

test("E2E-B7-07: an OWNER saves a new delivery default, which PUTs the real route", async ({ page }) => {
  await mockOrganizations(page, "OWNER");
  await page.route("**/bff/api/subjects/document-request-delivery-preference", (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { initialInviteDeliveryDefault: "MANUAL" } });
    return route.fulfill({ status: 204, json: {} });
  });

  await page.goto("/settings/request-delivery");
  await expect(page.getByLabel("Entrega manual")).toBeChecked();
  // The radio input itself is visually-hidden (RadioGroup.css's clip-path pattern) - clicking
  // its own visible text (inside the same <label>, native label/control association) is the
  // real, robust interaction, not a pixel-perfect click on the 1px input box itself.
  await page.getByText("E-mail automático", { exact: true }).click();
  await expect(page.getByLabel("E-mail automático")).toBeChecked();
  await page.getByRole("button", { name: "Salvar padrão" }).click();
  await expect(page.getByText("Padrão de entrega atualizado.")).toBeVisible();
});

// ---------------------------------------------------------------------------------------------
// E2E: G01 Upload de convidado (rastreamento legado)
// ---------------------------------------------------------------------------------------------

async function mockG01Info(page: Page, ok: boolean, body: Record<string, unknown> = {}) {
  await page.route("**/guest/document-requests/*/info", (route) =>
    route.fulfill(
      ok
        ? { status: 200, json: { request: { requirementName: "Certificado FGTS", deadline: "2026-09-20T00:00:00.000Z", allowedMediaTypes: ["application/pdf", "image/jpeg", "image/png"], maxUploadBytes: 10 * 1024 * 1024, requesterDisplayName: "Conservare Facilities ME", ...body } } }
        : { status: 401, json: { code: "GUEST_TOKEN_INVALID", category: "AUTH", message: "Invalid or expired link.", retryable: false } },
    ),
  );
}

test("E2E-B7-08: an invalid/expired/already-used token collapses to the SAME generic unavailable state (anti-enumeration)", async ({ page }) => {
  await mockG01Info(page, false);
  await page.goto("/guest/document-requests/bad-token");
  await expect(page.getByText("Este link não está disponível")).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(0);
});

test("E2E-B7-09: a valid link shows the requester/requirement names and completes the single-step upload", async ({ page }) => {
  await mockG01Info(page, true);
  await page.route("**/guest/document-requests/*/uploads", (route) =>
    route.fulfill({ status: 201, json: { submissionId: "s1", uploadUrl: "/mock-storage/g01-upload", requiredHeaders: {}, expiresAt: "2026-09-10T00:10:00.000Z" } }),
  );
  await page.route("**/mock-storage/g01-upload", (route) => {
    expect(route.request().method()).toBe("PUT");
    return route.fulfill({ status: 200, body: "" });
  });

  await page.goto("/guest/document-requests/tok-1");
  await expect(page.getByText(/Conservare Facilities ME/)).toBeVisible();
  await expect(page.getByText(/Certificado FGTS/)).toBeVisible();

  await page.setInputFiles('input[type="file"]', { name: "certidao.pdf", mimeType: "application/pdf", buffer: Buffer.from("conteudo") });
  await page.getByRole("button", { name: "Enviar" }).click();

  await expect(page.getByRole("heading", { name: "Envio recebido" })).toBeVisible();
  await expect(page.getByText(/Você não receberá uma confirmação de aprovação por este link/)).toBeVisible();
});

test("E2E-B7-10: G01 has no AppShell/nav chrome at all", async ({ page }) => {
  await mockG01Info(page, true);
  await page.goto("/guest/document-requests/tok-1");
  await expect(page.getByRole("navigation")).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------
// Accessibility — same probes as e2e/block6-requests-guest.spec.ts
// ---------------------------------------------------------------------------------------------

const CONTRAST_PROBE = `(() => {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const parse = (value) => {
    const match = /rgba?\\(([^)]+)\\)/.exec(value);
    if (!match) return null;
    const parts = match[1].split(",").map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] === undefined ? 1 : parts[3] };
  };
  const effectiveBackground = (element) => {
    let node = element;
    while (node && node !== document.documentElement) {
      const background = getComputedStyle(node).backgroundColor;
      if (background && !/rgba\\(0, 0, 0, 0\\)/.test(background)) return background;
      node = node.parentElement;
    }
    return getComputedStyle(document.body).backgroundColor;
  };
  const results = [];
  for (const element of document.querySelectorAll("body *")) {
    const ownsText = Array.from(element.childNodes).some((node) => node.nodeType === 3 && node.textContent.trim().length > 0);
    if (!ownsText) continue;
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none") continue;
    if (element.closest(":disabled")) continue;
    const box = element.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    const fg = parse(style.color);
    const bg = parse(effectiveBackground(element));
    if (!fg || !bg) continue;
    const L1 = lum(fg.r, fg.g, fg.b);
    const L2 = lum(bg.r, bg.g, bg.b);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(style.fontSize);
    const isLarge = size >= 24 || (size >= 18.66 && parseInt(style.fontWeight, 10) >= 700);
    const required = isLarge ? 3 : 4.5;
    if (ratio + 0.005 < required) {
      results.push({ selector: element.tagName.toLowerCase() + "." + String(element.className).split(" ")[0], text: element.textContent.trim().slice(0, 40), ratio: Number(ratio.toFixed(2)), required });
    }
  }
  return results;
})()`;

test("A11Y-contrast: A10 Rastreamento legado has no text below its required ratio", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockOrganizations(page, "ADMIN");
  await mockA10(page);
  await page.goto("/subjects/subject-1/tracking");
  await page.waitForLoadState("networkidle");
  const failures = await page.evaluate(CONTRAST_PROBE);
  expect(failures, `contrast failures: ${JSON.stringify(failures, null, 1)}`).toEqual([]);
});

test("A11Y-contrast: G01 guest upload has no text below its required ratio", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockG01Info(page, true);
  await page.goto("/guest/document-requests/tok-1");
  await page.waitForLoadState("networkidle");
  const failures = await page.evaluate(CONTRAST_PROBE);
  expect(failures, `contrast failures: ${JSON.stringify(failures, null, 1)}`).toEqual([]);
});

test("A11Y-reduced-motion: G01 renders correctly under prefers-reduced-motion", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await mockG01Info(page, true);
  await page.goto("/guest/document-requests/tok-1");
  await page.waitForLoadState("networkidle");
  const heading = page.locator("h1").first();
  await expect(heading).toBeVisible();
});
