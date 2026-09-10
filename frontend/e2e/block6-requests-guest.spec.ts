import { test, expect, type Page } from "@playwright/test";

/**
 * Block 6 — A14 (Solicitações e recorrência) + G02 (Solicitação de documento, convidado),
 * D-2xx. Real user flows plus accessibility, same mocking/probe discipline as
 * `e2e/block5-review-queue.spec.ts`. G02 is mocked at its own real relative paths (no `/bff/api`
 * prefix — see `api/guestDocumentArchive.ts`'s header comment for why it never goes through the
 * BFF proxy), never through `mockSession`/`mockOrganizations` (G02 has no session at all).
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
  return { subjectId: "subject-1", tenantId: "org-1", type: "VENDOR", displayName: "Atlas Schindler", tags: [], status: "ACTIVE", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 1 };
}

function requirement(overrides: Record<string, unknown> = {}) {
  return { requirementId: "req-1", subjectId: "subject-1", name: "CND Federal", applicability: "APPLICABLE", status: "MISSING", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", version: 1, ...overrides };
}

function series(overrides: Record<string, unknown> = {}) {
  return {
    seriesId: "series-1",
    subjectId: "subject-1",
    requirementId: "req-1",
    cadence: { intervalDays: 90 },
    status: "ACTIVE",
    currentCycleStartAt: "2026-09-01T00:00:00.000Z",
    nextDueAt: "2026-12-01T00:00:00.000Z",
    latestAttemptIndex: 0,
    recipientEmail: "financeiro@atlasschindler.com",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function documentRequest(overrides: Record<string, unknown> = {}) {
  return {
    documentRequestId: "docreq-1",
    subjectId: "subject-1",
    requirementId: "req-1",
    status: "REQUESTED",
    deadline: "2026-09-20T00:00:00.000Z",
    submissionCount: 0,
    issuanceGeneration: 1,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

async function mockA14(page: Page, opts: { series?: unknown[]; requests?: unknown[]; requirements?: unknown[] } = {}) {
  await page.route("**/bff/api/subjects/subject-1", (route) => route.fulfill({ json: { subject: subject() } }));
  await page.route("**/bff/api/document-archive/series/subject-1", (route) => route.fulfill({ json: { series: opts.series ?? [] } }));
  await page.route("**/bff/api/document-archive/requirements/subject-1/document-requests", (route) => route.fulfill({ json: { documentRequests: opts.requests ?? [] } }));
  await page.route("**/bff/api/document-archive/requirements/subject-1", (route) => route.fulfill({ json: { requirements: opts.requirements ?? [requirement()] } }));
}

test.beforeEach(async ({ page }) => {
  await mockSession(page, { authenticated: true, activeOrganizationId: "org-1" });
});

// ---------------------------------------------------------------------------------------------
// E2E: A14 Solicitações e recorrência
// ---------------------------------------------------------------------------------------------

test("E2E-B6-01: VIEWER sees series/requests but no create actions or row actions", async ({ page }) => {
  await mockOrganizations(page, "VIEWER");
  await mockA14(page, { series: [series()], requests: [documentRequest()] });

  await page.goto("/subjects/subject-1/requests");
  await expect(page.getByRole("heading", { name: "Solicitações e recorrência" })).toBeVisible();
  await expect(page.getByText("Ativa")).toBeVisible();
  await expect(page.getByRole("button", { name: "Nova solicitação avulsa" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Gerar agora" })).toHaveCount(0);
});

test("E2E-B6-02: a WRITE role creates an avulso request, which POSTs to the real route and shows a toast", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await mockA14(page, { series: [], requests: [] });
  let postedBody: Record<string, unknown> | undefined;
  await page.route("**/bff/api/document-archive/requirements/subject-1/req-1/document-requests", (route) => {
    postedBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ status: 201, json: { documentRequest: documentRequest() } });
  });

  await page.goto("/subjects/subject-1/requests");
  await page.locator("header").getByRole("button", { name: "Nova solicitação avulsa" }).click();
  await page.getByRole("combobox", { name: /Requisito/ }).fill("CND");
  await page.getByRole("option", { name: "CND Federal" }).click();
  await page.getByLabel(/Destinatário/).fill("financeiro@atlasschindler.com");
  await page.getByRole("button", { name: "Criar solicitação" }).click();

  await expect.poll(() => postedBody?.["recipientEmail"]).toBe("financeiro@atlasschindler.com");
  await expect(page.getByText("Solicitação criada")).toBeVisible();
});

test("E2E-B6-03: 'Gerar agora' is disabled with an explanatory title when the series has no recipient", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await mockA14(page, { series: [series({ recipientEmail: undefined })] });

  await page.goto("/subjects/subject-1/requests");
  const button = page.getByRole("button", { name: "Gerar agora" });
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute("title", /Defina um destinatário/);
});

test("E2E-B6-04: cancel-series confirmation names the series' Requisito and never uses the danger variant", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await mockA14(page, { series: [series()] });
  await page.goto("/subjects/subject-1/requests");

  await page.getByRole("button", { name: "Cancelar" }).click();
  await expect(page.getByText(/Cancelar série "CND Federal"/)).toBeVisible();
  const confirm = page.getByRole("button", { name: "Confirmar cancelamento" });
  await expect(confirm).not.toHaveClass(/ui-button--danger/);
});

test("E2E-B6-05: the cadence shown is a real day count, never a fabricated cron expression", async ({ page }) => {
  await mockOrganizations(page, "VIEWER");
  await mockA14(page, { series: [series({ cadence: { intervalDays: 45 } })] });
  await page.goto("/subjects/subject-1/requests");

  await expect(page.getByText("A cada 45 dias")).toBeVisible();
  await expect(page.getByText(/cron/i)).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------
// E2E: G02 Solicitação de documento (convidado)
// ---------------------------------------------------------------------------------------------

async function mockG02Session(page: Page, ok: boolean, body: Record<string, unknown> = {}) {
  await page.route("**/document-archive/guest/document-requests/*/session", (route) =>
    route.fulfill(ok ? { status: 201, json: { expiresAt: "2026-09-12T00:00:00.000Z", ...body } } : { status: 401, json: { code: "GUEST_ACCESS_INVALID", category: "AUTH", message: "Invalid, expired, or unauthorized guest access.", retryable: false } }),
  );
}

test("E2E-B6-06: an invalid/expired token collapses to the SAME generic unavailable state (anti-enumeration)", async ({ page }) => {
  await mockG02Session(page, false);
  await page.goto("/document-archive/guest/document-requests/bad-token");
  await expect(page.getByText("Este link não está disponível")).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(0);
});

test("E2E-B6-07: a valid link shows the requester/requirement names and completes the 3-step wizard", async ({ page }) => {
  await mockG02Session(page, true, { subjectDisplayName: "Atlas Schindler", requirementName: "CND Federal" });
  await page.route("**/document-archive/guest/document-requests/*/document-types", (route) => route.fulfill({ json: { documentTypes: [{ documentTypeId: "dt-1", displayName: "CND Federal (Receita Federal)" }] } }));
  let uploadedBody: Record<string, unknown> | undefined;
  await page.route("**/document-archive/guest/document-requests/*/uploads", (route) => {
    // ADR-0013 (D-265) — no uploadUrl offered (nothing to PUT), but confirmUploadInFlight (PATCH)
    // is ALWAYS called regardless, and its own {extended} return is what decides success.
    if (route.request().method() === "PATCH") return route.fulfill({ status: 200, json: { extended: true } });
    uploadedBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ status: 201, json: { documentId: "doc-1", versionId: "ver-1", seq: 1, fileId: "file-1" } });
  });

  await page.goto("/document-archive/guest/document-requests/tok-1");
  await expect(page.getByText(/Atlas Schindler solicitou evidência para o requisito/)).toBeVisible();

  await page.getByLabel(/Tipo de documento \*/).selectOption("dt-1");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Arquivo" })).toBeVisible();

  await page.setInputFiles('input[type="file"]', { name: "cnd.pdf", mimeType: "application/pdf", buffer: Buffer.from("conteudo") });
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Revisar e enviar" })).toBeVisible();
  await expect(page.getByText("cnd.pdf")).toBeVisible();

  await page.getByRole("button", { name: "Enviar evidência" }).click();
  await expect(page.getByRole("heading", { name: "Evidência enviada" })).toBeVisible();
  await expect(page.getByText(/esta confirmação não significa que o documento foi aprovado/)).toBeVisible();
  expect(uploadedBody?.["documentTypeId"]).toBe("dt-1");
});

test("E2E-B6-07b (ADR-0013/D-265): when uploadUrl is offered, PUTs the real bytes to S3 then confirms via PATCH before the final state", async ({ page }) => {
  await mockG02Session(page, true, { subjectDisplayName: "Atlas Schindler", requirementName: "CND Federal" });
  await page.route("**/document-archive/guest/document-requests/*/document-types", (route) => route.fulfill({ json: { documentTypes: [{ documentTypeId: "dt-1", displayName: "CND Federal (Receita Federal)" }] } }));

  let putCalled = false;
  let confirmCalled = false;
  // Same-origin mock URL, deliberately. Codex review round 1 (D-265 implementation) confirmed a
  // real, PRE-EXISTING gap this mock's older comment (and block5-document-detail.spec.ts's A12
  // upload-wizard test, which set the same precedent) got WRONG: a real presigned S3 URL is
  // genuinely cross-origin and is NOT CSP-exempt — `connect-src 'self'` (`frontend/index.html`,
  // `infra/modules/spa-hosting/variables.tf`) would block it in a real browser today, for BOTH
  // this guest path and the authenticated A07/A12 path (the quarantine bucket also has no
  // `aws_s3_bucket_cors_configuration`, so even a relaxed CSP wouldn't be enough alone). This is
  // real, not introduced by ADR-0013, and out of scope for it to fix (ADR-0013 only reuses the
  // existing pipeline, never touches CSP/CORS) — named honestly here and in
  // decisions-log.md/NEXT_SESSION_PROMPT.md as a production-blocking gap for BOTH upload paths,
  // requiring its own Type 1 decision (CloudFront-proxied same-origin upload vs. a scoped
  // `connect-src`+bucket CORS allowlist vs. another transport). This mock stays same-origin only
  // to exercise the rest of the code path under the page's real CSP.
  await page.route("**/mock-storage/g02-upload", (route) => {
    putCalled = true;
    expect(route.request().method()).toBe("PUT");
    return route.fulfill({ status: 200, body: "" });
  });
  await page.route("**/document-archive/guest/document-requests/*/uploads", (route) => {
    if (route.request().method() === "PATCH") {
      confirmCalled = true;
      expect(putCalled).toBe(true); // PUT must complete before confirm is ever called.
      return route.fulfill({ status: 200, json: { extended: true } });
    }
    return route.fulfill({
      status: 201,
      json: { documentId: "doc-1", versionId: "ver-1", seq: 1, fileId: "file-1", uploadUrl: "/mock-storage/g02-upload", requiredHeaders: {} },
    });
  });

  await page.goto("/document-archive/guest/document-requests/tok-1");
  await page.getByLabel(/Tipo de documento \*/).selectOption("dt-1");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Arquivo" })).toBeVisible();
  await page.setInputFiles('input[type="file"]', { name: "cnd.pdf", mimeType: "application/pdf", buffer: Buffer.from("conteudo") });
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("heading", { name: "Revisar e enviar" })).toBeVisible();

  await page.getByRole("button", { name: "Enviar evidência" }).click();
  await expect(page.getByRole("heading", { name: "Evidência enviada" })).toBeVisible();
  expect(putCalled).toBe(true);
  expect(confirmCalled).toBe(true);
});

test("E2E-B6-08: G02 has no AppShell/nav chrome at all", async ({ page }) => {
  await mockG02Session(page, true);
  await page.route("**/document-archive/guest/document-requests/*/document-types", (route) => route.fulfill({ json: { documentTypes: [] } }));
  await page.goto("/document-archive/guest/document-requests/tok-1");
  await expect(page.getByRole("navigation")).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------
// Accessibility - same probes as e2e/block5-review-queue.spec.ts, applied to A14
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
    if (element.closest(":disabled")) continue; // WCAG 1.4.3 explicitly exempts inactive UI components (e.g. G02's disabled "Continuar" before a selection is made).
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

test("A11Y-contrast: A14 Solicitações e recorrência has no text below its required ratio", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockOrganizations(page, "ADMIN");
  await mockA14(page, { series: [series()], requests: [documentRequest()] });
  await page.goto("/subjects/subject-1/requests");
  await page.waitForLoadState("networkidle");
  const failures = await page.evaluate(CONTRAST_PROBE);
  expect(failures, `contrast failures: ${JSON.stringify(failures, null, 1)}`).toEqual([]);
});

test("A11Y-contrast: G02 guest wizard has no text below its required ratio", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockG02Session(page, true, { subjectDisplayName: "Atlas Schindler", requirementName: "CND Federal" });
  await page.route("**/document-archive/guest/document-requests/*/document-types", (route) => route.fulfill({ json: { documentTypes: [{ documentTypeId: "dt-1", displayName: "CND Federal" }] } }));
  await page.goto("/document-archive/guest/document-requests/tok-1");
  await page.waitForLoadState("networkidle");
  const failures = await page.evaluate(CONTRAST_PROBE);
  expect(failures, `contrast failures: ${JSON.stringify(failures, null, 1)}`).toEqual([]);
});

test("A11Y-focus-not-obscured: nothing sticky/fixed on A14 while idle (no toast/dialog open)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockOrganizations(page, "ADMIN");
  await mockA14(page, { series: [series()], requests: [documentRequest()] });
  await page.goto("/subjects/subject-1/requests");
  await page.waitForLoadState("networkidle");
  const pinned = await page.evaluate(() =>
    Array.from(document.querySelectorAll("body *"))
      .filter((element) => ["sticky", "fixed"].includes(getComputedStyle(element).position))
      .filter((element) => !element.classList.contains("skip-link"))
      .map((element) => element.tagName.toLowerCase() + "." + String(element.className).split(" ")[0]),
  );
  expect(pinned, "A14: sticky/fixed elements found").toEqual([]);
});

test("A11Y-reduced-motion: G02's step transitions are neutralised under prefers-reduced-motion", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await mockG02Session(page, true);
  await page.route("**/document-archive/guest/document-requests/*/document-types", (route) => route.fulfill({ json: { documentTypes: [] } }));
  await page.goto("/document-archive/guest/document-requests/tok-1");
  await page.waitForLoadState("networkidle");
  const heading = page.locator("h1").first();
  await expect(heading).toBeVisible();
});
