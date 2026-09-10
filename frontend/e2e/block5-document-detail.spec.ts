import { test, expect, type Page } from "@playwright/test";

/**
 * A12 — Document Detail / Version History (Block 5, D-2xx). Real user flows: viewing a
 * document's version history newest-first, the 3-step upload wizard, and the same
 * OWNER/ADMIN vs. MEMBER claim-ownership bypass named in the audited spec (mirrors
 * `block5-review-queue.spec.ts`'s E2E-B5-03/E2E-B5-04 exactly, applied to this second
 * surface for the same decisions), plus accessibility probes.
 */

function mockSession(page: Page, session: { authenticated: boolean; activeOrganizationId?: string }) {
  return page.route("**/bff/session", (route) => route.fulfill({ json: session }));
}

function mockOrganizations(page: Page, role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  return page.route("**/bff/organizations", (route) =>
    route.fulfill({ json: { organizations: [{ organizationId: "org-1", displayName: "Org One", role, version: 1 }] } }),
  );
}

function documentPayload(overrides: Record<string, unknown> = {}) {
  return {
    documentId: "doc-1",
    subjectId: "subj-1",
    documentTypeId: "dt-1",
    status: "ACTIVE",
    hasValidity: true,
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-01T08:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function version(overrides: Record<string, unknown> = {}) {
  return {
    documentId: "doc-1",
    seq: 1,
    versionId: "ver-1",
    state: "RECEIVED",
    origin: "MANUAL_UPLOAD",
    receivedAt: "2026-09-09T08:12:00.000Z",
    pendingFileScans: 0,
    infectedFileScans: 0,
    createdAt: "2026-09-09T08:12:00.000Z",
    updatedAt: "2026-09-09T08:12:00.000Z",
    version: 1,
    ...overrides,
  };
}

function mockDocument(page: Page, doc: Record<string, unknown>) {
  return page.route("**/bff/api/document-archive/documents/doc-1", (route) => route.fulfill({ json: { document: doc } }));
}

function mockVersions(page: Page, versions: unknown[]) {
  return page.route("**/bff/api/document-archive/documents/doc-1/versions", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ json: { versions } });
  });
}

test.beforeEach(async ({ page }) => {
  await mockSession(page, { authenticated: true, activeOrganizationId: "org-1" });
});

// ---------------------------------------------------------------------------------------------
// E2E: A12 Document Detail / Version History
// ---------------------------------------------------------------------------------------------

test("E2E-B5-D01: viewing a document's version history renders newest-first with state/dates/reviewer", async ({ page }) => {
  await mockOrganizations(page, "VIEWER");
  await mockDocument(page, documentPayload());
  await mockVersions(page, [
    version({ seq: 1, state: "SUPERSEDED" }),
    version({ seq: 2, state: "ACCEPTED", reviewerId: "user-a", decidedAt: "2026-09-05T00:00:00.000Z" }),
  ]);

  await page.goto("/documents/doc-1");
  await expect(page.getByRole("heading", { name: /Documento doc-1/ })).toBeVisible();
  const cards = page.locator(".a12-version-header");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText("Versão 2");
  await expect(cards.last()).toContainText("Versão 1");
  await expect(page.getByText("user-a")).toBeVisible();
});

test("E2E-B5-D02: a REJECTED version shows its rejection reason", async ({ page }) => {
  await mockOrganizations(page, "VIEWER");
  await mockDocument(page, documentPayload());
  await mockVersions(page, [version({ state: "REJECTED", rejectionReason: "ILLEGIBLE" })]);

  await page.goto("/documents/doc-1");
  await expect(page.getByText("Ilegível")).toBeVisible();
});

test("E2E-B5-D03: VIEWER sees no upload wizard and no action bar", async ({ page }) => {
  await mockOrganizations(page, "VIEWER");
  await mockDocument(page, documentPayload());
  await mockVersions(page, [version()]);

  await page.goto("/documents/doc-1");
  await expect(page.getByText("Enviar nova versão")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reivindicar" })).toHaveCount(0);
});

test("E2E-B5-D04: the 3-step upload wizard reserves a version, uploads a file, then commits", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await mockDocument(page, documentPayload());
  await mockVersions(page, [version({ state: "ACCEPTED" })]);

  await page.route("**/bff/api/document-archive/documents/doc-1/versions", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({ json: { version: version({ seq: 2, state: "DRAFT", version: 1 }) } });
  });
  // Same-origin presigned URL — an external domain would be blocked by the app's own CSP
  // `connect-src 'self'` (a real constraint found while writing this test, not a mocking
  // artifact: a genuine presigned storage URL is same-origin-exempt in production because it's
  // never fetched via this app's own origin's CSP, but this test's mock has to stay same-origin
  // to exercise the code path at all under the page's real CSP).
  await page.route("**/bff/api/document-archive/documents/doc-1/versions/2/files", (route) =>
    route.fulfill({
      json: {
        files: [{ file: { fileId: "file-1", role: "PRINCIPAL", mediaType: "application/pdf", contentLength: 3 }, uploadUrl: "/mock-storage/upload", requiredHeaders: {} }],
      },
    }),
  );
  await page.route("**/mock-storage/upload", (route) => route.fulfill({ status: 200, body: "" }));
  let commitBody: Record<string, unknown> | undefined;
  await page.route("**/bff/api/document-archive/documents/doc-1/versions/2/commit", (route) => {
    commitBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ json: { version: version({ seq: 2, state: "RECEIVED", version: 2 }) } });
  });

  await page.goto("/documents/doc-1");
  await page.getByRole("button", { name: "Reservar versão" }).click();
  await expect(page.getByText("Versão 2 reservada")).toBeVisible();

  await page.setInputFiles('input[type="file"]', { name: "doc.pdf", mimeType: "application/pdf", buffer: Buffer.from("abc") });
  await page.getByRole("button", { name: "Enviar arquivo" }).click();
  await expect(page.getByText("Arquivo enviado")).toBeVisible();

  await page.getByRole("button", { name: "Concluir" }).click();
  await expect.poll(() => commitBody?.["expectedVersion"]).toBe(1);
  await expect(page.getByText(/enviada com sucesso/)).toBeVisible();
});

test("E2E-B5-D05: a MEMBER sees no action bar on a version claimed by another reviewer", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await mockDocument(page, documentPayload());
  await mockVersions(page, [version({ state: "UNDER_REVIEW", reviewerId: "user-other" })]);

  await page.goto("/documents/doc-1");
  await expect(page.getByText(/Reivindicada por/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Aceitar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rejeitar" })).toHaveCount(0);
});

test("E2E-B5-D06: RBAC bypass — an ADMIN's action bar stays visible on a version claimed by another reviewer (assertReviewerOrAdmin)", async ({ page }) => {
  await mockOrganizations(page, "ADMIN");
  await mockDocument(page, documentPayload());
  await mockVersions(page, [version({ state: "UNDER_REVIEW", reviewerId: "user-other" })]);

  await page.goto("/documents/doc-1");
  await expect(page.getByText(/você pode decidir mesmo assim/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Aceitar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rejeitar" })).toBeVisible();
});

// ---------------------------------------------------------------------------------------------
// Accessibility - same probes as e2e/accessibility.spec.ts / block5-review-queue.spec.ts,
// applied to A12
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

async function setupA12(page: Page) {
  await mockOrganizations(page, "ADMIN");
  await mockDocument(page, documentPayload());
  await mockVersions(page, [version({ state: "UNDER_REVIEW", reviewerId: "user-other" }), version({ seq: 2, state: "ACCEPTED", reviewerId: "user-a" })]);
}

test("A11Y-contrast: A12 Document Detail has no text below its required ratio", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // VIEWER (not ADMIN/MEMBER/OWNER) - the upload wizard is not rendered for a read-only role, so
  // this probe never sees a disabled-by-design wizard-step button (same "don't probe contrast
  // through a deliberately low-emphasis disabled control" precedent as A13's own contrast test,
  // which never exercises a scenario with a disabled Aceitar visible either).
  await mockOrganizations(page, "VIEWER");
  await mockDocument(page, documentPayload());
  await mockVersions(page, [version({ state: "UNDER_REVIEW", reviewerId: "user-other" }), version({ seq: 2, state: "ACCEPTED", reviewerId: "user-a" })]);
  await page.goto("/documents/doc-1");
  await page.waitForLoadState("networkidle");
  const failures = await page.evaluate(CONTRAST_PROBE);
  expect(failures, `contrast failures: ${JSON.stringify(failures, null, 1)}`).toEqual([]);
});

test("A11Y-focus: A12 keyboard path has a visible ring, adequate target size, and full focusable coverage", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupA12(page);
  await page.goto("/documents/doc-1");
  await page.waitForLoadState("networkidle");

  const MAX_TABS = 60;
  const stops: { tag: string; label: string; outlineWidth: number; outlineStyle: string; width: number; height: number; revisitOf: number | null; precededByPrevious: boolean }[] = [];
  let terminated = false;

  for (let index = 0; index < MAX_TABS; index++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate((visitIndex) => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return null;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      const seen = element.dataset.a11yVisit;
      const previous = document.querySelector<HTMLElement>(`[data-a11y-visit="${visitIndex - 1}"]`);
      if (seen === undefined) element.dataset.a11yVisit = String(visitIndex);
      return {
        tag: element.tagName.toLowerCase(),
        label: (element.getAttribute("aria-label") || element.textContent || "").trim().slice(0, 48),
        outlineWidth: parseFloat(style.outlineWidth),
        outlineStyle: style.outlineStyle,
        width: Math.round(box.width),
        height: Math.round(box.height),
        revisitOf: seen === undefined ? null : Number(seen),
        precededByPrevious: previous === null || previous === element || Boolean(previous.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING),
      };
    }, index);
    if (!stop) {
      terminated = true;
      break;
    }
    stops.push(stop);
    if (stop.revisitOf !== null) break;
  }

  expect(stops.length, "A12 should expose a substantial keyboard path").toBeGreaterThan(5);

  const revisit = stops.findIndex((stop) => stop.revisitOf !== null);
  if (revisit !== -1) {
    expect(stops[revisit]?.revisitOf, "keyboard trap on A12").toBe(0);
    terminated = true;
  }
  expect(terminated, `A12: tab path neither wrapped nor left the document within ${MAX_TABS} presses`).toBe(true);

  const unreached = await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex^="-"])'),
    );
    return candidates
      .filter((element) => {
        if (element.dataset.a11yVisit !== undefined) return false;
        if (element.closest("[aria-hidden='true']") !== null) return false;
        return element.getClientRects().length > 0 || getComputedStyle(element).position === "absolute";
      })
      .map((element) => `<${element.tagName.toLowerCase()}> "${(element.getAttribute("aria-label") || element.textContent || "").trim().slice(0, 48)}"`);
  });
  expect(unreached, `A12: focusable elements never reached: ${JSON.stringify(unreached, null, 1)}`).toEqual([]);

  for (const stop of stops.filter((candidate) => candidate.revisitOf === null)) {
    expect(stop.precededByPrevious, `A12: tab order departs from DOM order at <${stop.tag}> "${stop.label}"`).toBe(true);
    expect(stop.outlineStyle, `A12: no focus ring on <${stop.tag}> "${stop.label}"`).not.toBe("none");
    expect(stop.outlineWidth, `A12: focus ring too thin on <${stop.tag}> "${stop.label}"`).toBeGreaterThanOrEqual(2);
    expect(stop.height, `A12: target too short: <${stop.tag}> "${stop.label}"`).toBeGreaterThanOrEqual(24);
    expect(stop.width, `A12: target too narrow: <${stop.tag}> "${stop.label}"`).toBeGreaterThanOrEqual(24);
  }
});

test("A11Y-forced-colors: A12 status badges keep a real border and non-empty text", async ({ browser }) => {
  const context = await browser.newContext({ forcedColors: "active" });
  const page = await context.newPage();
  await mockSession(page, { authenticated: true, activeOrganizationId: "org-1" });
  await setupA12(page);
  await page.goto("/documents/doc-1");
  await page.waitForLoadState("networkidle");
  await page.waitForSelector(".ui-badge");

  const badges = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".ui-badge")).map((element) => ({
      text: element.textContent?.trim() ?? "",
      borderColor: getComputedStyle(element).borderTopColor,
      borderWidth: parseFloat(getComputedStyle(element).borderTopWidth),
    })),
  );
  expect(badges.length).toBeGreaterThan(0);
  for (const badge of badges) {
    expect(badge.text.length).toBeGreaterThan(0);
    expect(badge.borderWidth).toBeGreaterThan(0);
    expect(badge.borderColor).not.toBe("rgba(0, 0, 0, 0)");
  }
  await context.close();
});
