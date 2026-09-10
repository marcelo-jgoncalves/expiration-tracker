import { test, expect, type Page } from "@playwright/test";

/**
 * A13 — Fila de revisão (Block 5, D-2xx). Real user flows (RBAC-gated tabs/action bar, the
 * OWNER/ADMIN vs. MEMBER claim-ownership bypass named in the audited spec, claim/accept/reject,
 * OCC conflict, scan-pending/infected states) plus accessibility, same mocking and probe
 * discipline as `e2e/block3-subjects-requirements.spec.ts`.
 */

function mockSession(page: Page, session: { authenticated: boolean; activeOrganizationId?: string }) {
  return page.route("**/bff/session", (route) => route.fulfill({ json: session }));
}

function mockOrganizations(page: Page, role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  return page.route("**/bff/organizations", (route) =>
    route.fulfill({ json: { organizations: [{ organizationId: "org-1", displayName: "Org One", role, version: 1 }] } }),
  );
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

function hit(versionOverrides: Record<string, unknown> = {}, docOverrides: Record<string, unknown> = {}) {
  return { version: version(versionOverrides), document: { documentId: "doc-1", subjectId: "subj-1", documentTypeId: "dt-1", ...docOverrides } };
}

function mockReviews(page: Page, received: unknown[], underReview: unknown[] = []) {
  return page.route("**/bff/api/document-archive/reviews**", (route) => {
    const url = new URL(route.request().url());
    const state = url.searchParams.get("state");
    return route.fulfill({ json: { items: state === "UNDER_REVIEW" ? underReview : received, cursor: null } });
  });
}

test.beforeEach(async ({ page }) => {
  await mockSession(page, { authenticated: true, activeOrganizationId: "org-1" });
});

// ---------------------------------------------------------------------------------------------
// E2E: A13 Fila de revisão
// ---------------------------------------------------------------------------------------------

test("E2E-B5-01: VIEWER sees the queue and detail with no action bar", async ({ page }) => {
  await mockOrganizations(page, "VIEWER");
  await mockReviews(page, [hit()]);

  await page.goto("/reviews");
  await expect(page.getByRole("heading", { name: "Fila de revisão" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reivindicar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Aceitar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rejeitar" })).toHaveCount(0);
});

test("E2E-B5-02: MEMBER claims an unclaimed item, then can Aceitar/Rejeitar it", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await mockReviews(page, [hit()]);
  let claimBody: Record<string, unknown> | undefined;
  await page.route("**/bff/api/document-archive/documents/doc-1/versions/1/claim", (route) => {
    claimBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ json: { version: version({ state: "UNDER_REVIEW", reviewerId: "me", version: 2 }) } });
  });

  await page.goto("/reviews");
  await page.getByRole("button", { name: "Reivindicar" }).click();
  await expect.poll(() => claimBody?.["expectedVersion"]).toBe(1);
});

test("E2E-B5-03: a MEMBER sees no action bar on an item claimed by another reviewer", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await mockReviews(page, [], [hit({ state: "UNDER_REVIEW", reviewerId: "user-other" })]);

  await page.goto("/reviews");
  await page.getByRole("button", { name: /Em revisão/ }).click();
  await page.getByRole("button", { name: "doc-1" }).click();
  await expect(page.getByText(/Reivindicado por/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Aceitar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rejeitar" })).toHaveCount(0);
});

test("E2E-B5-04: RBAC bypass — an ADMIN's action bar stays visible on an item claimed by another reviewer (assertReviewerOrAdmin)", async ({ page }) => {
  await mockOrganizations(page, "ADMIN");
  await mockReviews(page, [], [hit({ state: "UNDER_REVIEW", reviewerId: "user-other" })]);

  await page.goto("/reviews");
  await page.getByRole("button", { name: /Em revisão/ }).click();
  await page.getByRole("button", { name: "doc-1" }).click();
  await expect(page.getByText(/você pode decidir mesmo assim/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Aceitar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rejeitar" })).toBeVisible();
});

test("E2E-B5-05: an OWNER accepts an item claimed by another reviewer", async ({ page }) => {
  await mockOrganizations(page, "OWNER");
  await mockReviews(page, [], [hit({ state: "UNDER_REVIEW", reviewerId: "user-other" })]);
  let acceptCalled = false;
  await page.route("**/bff/api/document-archive/documents/doc-1/versions/1/accept", (route) => {
    acceptCalled = true;
    return route.fulfill({ json: { document: { documentId: "doc-1" }, acceptedVersionId: "ver-1" } });
  });

  await page.goto("/reviews");
  await page.getByRole("button", { name: /Em revisão/ }).click();
  await page.getByRole("button", { name: "doc-1" }).click();
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect.poll(() => acceptCalled).toBe(true);
});

test("E2E-B5-06: rejecting requires a closed-set reason, then posts it and advances the selection", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await mockReviews(page, [hit(), hit({ documentId: "doc-2", seq: 1, versionId: "ver-2" }, { documentId: "doc-2" })]);
  let rejectBody: Record<string, unknown> | undefined;
  await page.route("**/bff/api/document-archive/documents/doc-1/versions/1/reject", (route) => {
    rejectBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ json: { version: version({ state: "REJECTED", version: 2 }) } });
  });

  await page.goto("/reviews");
  await page.getByRole("button", { name: "Rejeitar" }).first().click();
  await page.getByLabel(/Motivo da rejeição/).selectOption("ILLEGIBLE");
  await page.getByRole("button", { name: "Confirmar rejeição" }).click();
  await expect.poll(() => rejectBody?.["reason"]).toBe("ILLEGIBLE");
});

test("E2E-B5-07: Aceitar is disabled (never hidden) while a file scan is pending, with an explanation", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await mockReviews(page, [hit({ pendingFileScans: 1 })]);

  await page.goto("/reviews");
  await expect(page.getByText(/Verificando segurança/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Aceitar" })).toBeDisabled();
});

test("E2E-B5-08: Aceitar is hidden (Rejeitar stays) when a file scan is infected", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await mockReviews(page, [hit({ infectedFileScans: 1 })]);

  await page.goto("/reviews");
  await expect(page.getByText(/Arquivo infectado/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Aceitar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Rejeitar" })).toBeVisible();
});

test("E2E-B5-09: a concurrent decision (OCC conflict) surfaces a clear notice and reloads the queue", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await mockReviews(page, [hit()]);
  await page.route("**/bff/api/document-archive/documents/doc-1/versions/1/accept", (route) =>
    route.fulfill({ status: 409, json: { code: "CONFLICT", category: "CONFLICT", message: "DocumentVersion is no longer eligible for acceptance.", retryable: false } }),
  );

  await page.goto("/reviews");
  await page.getByRole("button", { name: "Aceitar" }).click();
  await expect(page.getByText("Este item já foi decidido por outra pessoa.")).toBeVisible();
});

test("E2E-B5-10: the empty queue shows 'Nenhum item nesta fila.'", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await mockReviews(page, []);

  await page.goto("/reviews");
  await expect(page.getByText("Nenhum item nesta fila.").first()).toBeVisible();
});

test("E2E-B5-11: switching tabs resets the detail selection and fetches the other state independently", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await mockReviews(page, [hit()], [hit({ documentId: "doc-2", seq: 1, versionId: "ver-2", state: "UNDER_REVIEW", reviewerId: "user-other" }, { documentId: "doc-2" })]);

  await page.goto("/reviews");
  await expect(page.getByRole("button", { name: "Reivindicar" })).toBeVisible();
  await page.getByRole("button", { name: /Em revisão/ }).click();
  await expect(page.getByText("Selecione um item na lista acima.")).toBeVisible();
});

// ---------------------------------------------------------------------------------------------
// Accessibility - same probes as e2e/accessibility.spec.ts, applied to A13
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

async function setupA13(page: Page) {
  await mockOrganizations(page, "ADMIN");
  await mockReviews(page, [hit()], [hit({ documentId: "doc-2", seq: 1, versionId: "ver-2", state: "UNDER_REVIEW", reviewerId: "user-other" }, { documentId: "doc-2" })]);
}

test("A11Y-contrast: A13 Fila de revisão has no text below its required ratio", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupA13(page);
  await page.goto("/reviews");
  await page.waitForLoadState("networkidle");
  const failures = await page.evaluate(CONTRAST_PROBE);
  expect(failures, `contrast failures: ${JSON.stringify(failures, null, 1)}`).toEqual([]);
});

test("A11Y-focus: A13 keyboard path has a visible ring, adequate target size, and full focusable coverage", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupA13(page);
  await page.goto("/reviews");
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

  expect(stops.length, "A13 should expose a substantial keyboard path").toBeGreaterThan(5);

  const revisit = stops.findIndex((stop) => stop.revisitOf !== null);
  if (revisit !== -1) {
    expect(stops[revisit]?.revisitOf, "keyboard trap on A13").toBe(0);
    terminated = true;
  }
  expect(terminated, `A13: tab path neither wrapped nor left the document within ${MAX_TABS} presses`).toBe(true);

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
  expect(unreached, `A13: focusable elements never reached: ${JSON.stringify(unreached, null, 1)}`).toEqual([]);

  for (const stop of stops.filter((candidate) => candidate.revisitOf === null)) {
    expect(stop.precededByPrevious, `A13: tab order departs from DOM order at <${stop.tag}> "${stop.label}"`).toBe(true);
    expect(stop.outlineStyle, `A13: no focus ring on <${stop.tag}> "${stop.label}"`).not.toBe("none");
    expect(stop.outlineWidth, `A13: focus ring too thin on <${stop.tag}> "${stop.label}"`).toBeGreaterThanOrEqual(2);
    expect(stop.height, `A13: target too short: <${stop.tag}> "${stop.label}"`).toBeGreaterThanOrEqual(24);
    expect(stop.width, `A13: target too narrow: <${stop.tag}> "${stop.label}"`).toBeGreaterThanOrEqual(24);
  }
});

test("A11Y-focus-not-obscured: nothing sticky/fixed on A13 (SC 2.4.11)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupA13(page);
  await page.goto("/reviews");
  await page.waitForLoadState("networkidle");
  const pinned = await page.evaluate(() =>
    Array.from(document.querySelectorAll("body *"))
      .filter((element) => ["sticky", "fixed"].includes(getComputedStyle(element).position))
      .filter((element) => !element.classList.contains("skip-link"))
      .map((element) => element.tagName.toLowerCase() + "." + String(element.className).split(" ")[0]),
  );
  expect(pinned, "A13: sticky/fixed elements found").toEqual([]);
});

test("A11Y-reduced-motion: A13 transitions are neutralised under prefers-reduced-motion", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await mockSession(page, { authenticated: true, activeOrganizationId: "org-1" });
  await setupA13(page);
  await page.goto("/reviews");
  await page.waitForLoadState("networkidle");
  const button = page.locator(".ui-button").first();
  await expect(button).toBeVisible();
  const duration = await button.evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(duration.split(",").every((value) => value.trim() === "0.001s"), `A13: transition not neutralised (${duration})`).toBe(true);
  await context.close();
});

test("A11Y-forced-colors: A13 status badges keep a real border and non-empty text", async ({ browser }) => {
  const context = await browser.newContext({ forcedColors: "active" });
  const page = await context.newPage();
  await mockSession(page, { authenticated: true, activeOrganizationId: "org-1" });
  await setupA13(page);
  await page.goto("/reviews");
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

test("A11Y-scroll-region: the A13 table wrapper is keyboard reachable exactly when it can scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupA13(page);
  await page.goto("/reviews");
  await page.waitForLoadState("networkidle");
  const scrollables = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".ui-table-scroll")).map((element) => ({
      scrollable: element.scrollWidth > element.clientWidth + 1,
      hasTabIndex: element.hasAttribute("tabindex"),
      hasRegionRole: element.getAttribute("role") === "region",
    })),
  );
  for (const scrollable of scrollables) {
    expect(scrollable.hasTabIndex).toBe(scrollable.scrollable);
    expect(scrollable.hasRegionRole).toBe(scrollable.scrollable);
  }
});
