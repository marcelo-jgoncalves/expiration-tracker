import { test, expect, type Page } from "@playwright/test";

/**
 * Block 4 E2E/accessibility (D-2xx) — A20 (Document Types & Metadata Catalog). Verified from
 * the start, not deferred (D-260's exact lesson: Block 3 shipped without E2E once, found to be
 * a real gap, had to be closed in a follow-up session — this file exists so Block 4 never
 * repeats that).
 *
 * Same mocking discipline as `block3-subjects-requirements.spec.ts`: every scenario mocks the
 * BFF via `page.route()`, real response shapes/status codes, no live BFF reachable from this
 * sandbox. Accessibility probes are copied verbatim from that file's own copy of
 * `e2e/accessibility.spec.ts`'s established checks (contrast/keyboard-focus/target-size/
 * no-sticky/reduced-motion/forced-colors/label-association), never re-invented.
 */

function mockSession(page: Page, session: { authenticated: boolean; activeOrganizationId?: string }) {
  return page.route("**/bff/session", (route) => route.fulfill({ json: session }));
}

function mockOrganizations(page: Page, role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  return page.route("**/bff/organizations", (route) =>
    route.fulfill({ json: { organizations: [{ organizationId: "org-1", displayName: "Org One", role, version: 1 }] } }),
  );
}

function documentType(overrides: Record<string, unknown> = {}) {
  return {
    documentTypeId: "doctype-1",
    displayName: "CND Federal",
    status: "ACTIVE",
    metadataFields: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function mockCatalog(page: Page, active: unknown[], deprecated: unknown[] = []) {
  return page.route("**/bff/api/document-archive/document-types**", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const url = new URL(route.request().url());
    const status = url.searchParams.get("status");
    return route.fulfill({ json: { documentTypes: status === "DEPRECATED" ? deprecated : active } });
  });
}

test.beforeEach(async ({ page }) => {
  await mockSession(page, { authenticated: true, activeOrganizationId: "org-1" });
});

// ---------------------------------------------------------------------------------------------
// E2E: A20 catalog - RBAC, create, deprecate/reactivate
// ---------------------------------------------------------------------------------------------

test("E2E-B4-01: ADMIN creates a document type and it actually renders in the catalog after refetch (not just the POST body)", async ({ page }) => {
  await mockOrganizations(page, "ADMIN");
  // Codex block-review finding (LOW): the original version of this test only observed the POST
  // request body - it would still pass even if the post-create cache invalidation/refetch were
  // broken and the new type never actually appeared on screen. This stateful mock makes the GET
  // catalog route reflect what was actually created, so the assertion below proves the UI
  // really re-renders with the new type, not just that the network call was shaped correctly.
  const created: Record<string, unknown>[] = [];
  await page.route("**/bff/api/document-archive/document-types**", (route) => {
    const method = route.request().method();
    if (method === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      const type = documentType({ displayName: body["displayName"] });
      created.push(type);
      return route.fulfill({ status: 201, json: { documentType: type } });
    }
    if (method === "GET") {
      const url = new URL(route.request().url());
      const status = url.searchParams.get("status");
      return route.fulfill({ json: { documentTypes: status === "DEPRECATED" ? [] : created } });
    }
    return route.fallback();
  });

  await page.goto("/settings/document-types");
  await expect(page.getByRole("heading", { name: "Tipos de documento" })).toBeVisible();
  await page.getByRole("button", { name: "Novo tipo" }).click();
  await page.getByLabel(/Nome do tipo de documento/).fill("Alvará de Funcionamento");
  await page.getByRole("button", { name: "Criar tipo" }).click();

  await expect(page.getByRole("link", { name: "Alvará de Funcionamento" })).toBeVisible();
});

test("E2E-B4-02: VIEWER browses the catalog with no 'Novo tipo' and no Ações column", async ({ page }) => {
  await mockOrganizations(page, "VIEWER");
  await mockCatalog(page, [documentType()]);

  await page.goto("/settings/document-types");
  await expect(page.getByRole("link", { name: "CND Federal" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Novo tipo" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Descontinuar" })).toHaveCount(0);
});

test("E2E-B4-03: ADMIN deprecates then reactivates a type (docarchive:documenttype-deprecate/reactivate) - reactivation is actually exercised, not just deprecation", async ({ page }) => {
  await mockOrganizations(page, "ADMIN");
  // Codex block-review finding (LOW): the original version of this test's title promised
  // "deprecates THEN reactivates" but only ever clicked "Descontinuar" - reactivation, including
  // its body-based `expectedVersion`, was never exercised. Stateful mock so the catalog list
  // reflects each mutation, letting the test click through the real deprecate -> reactivate
  // round trip and assert both bodies.
  let type = documentType();
  let deprecateBody: Record<string, unknown> | undefined;
  let reactivateBody: Record<string, unknown> | undefined;
  await page.route("**/bff/api/document-archive/document-types**", (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET" && url.pathname.endsWith("/document-types")) {
      const status = url.searchParams.get("status");
      return route.fulfill({ json: { documentTypes: (status === "DEPRECATED") === (type.status === "DEPRECATED") ? [type] : [] } });
    }
    return route.fallback();
  });
  await page.route("**/bff/api/document-archive/document-types/doctype-1/deprecate", (route) => {
    deprecateBody = route.request().postDataJSON() as Record<string, unknown>;
    type = documentType({ status: "DEPRECATED", version: 2 });
    return route.fulfill({ json: { documentType: type } });
  });
  await page.route("**/bff/api/document-archive/document-types/doctype-1/reactivate", (route) => {
    reactivateBody = route.request().postDataJSON() as Record<string, unknown>;
    type = documentType({ status: "ACTIVE", version: 3 });
    return route.fulfill({ json: { documentType: type } });
  });

  await page.goto("/settings/document-types");
  await page.getByRole("button", { name: "Descontinuar" }).click();
  await expect.poll(() => deprecateBody?.["expectedVersion"]).toBe(1);
  await expect(page.getByRole("button", { name: "Reativar" })).toBeVisible();
  await page.getByRole("button", { name: "Reativar" }).click();
  await expect.poll(() => reactivateBody?.["expectedVersion"]).toBe(2);
});

test("E2E-B4-04: MEMBER opens the field editor in read-only mode (docarchive:documenttype-read is READ_ONLY_ROLES)", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await page.route("**/bff/api/document-archive/document-types/doctype-1", (route) => route.fulfill({ json: { documentType: documentType() } }));

  await page.goto("/settings/document-types/doctype-1");
  await expect(page.getByRole("heading", { name: "CND Federal" })).toBeVisible();
  await expect(page.getByText("Modo leitura — apenas administradores editam este catálogo.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Adicionar campo" })).toHaveCount(0);
});

test("E2E-B4-05: ADMIN adds a SINGLE_SELECT metadata field with options (docarchive:documenttype-metadata-manage)", async ({ page }) => {
  await mockOrganizations(page, "ADMIN");
  await page.route("**/bff/api/document-archive/document-types/doctype-1", (route) => route.fulfill({ json: { documentType: documentType() } }));
  let fieldBody: Record<string, unknown> | undefined;
  await page.route("**/bff/api/document-archive/document-types/doctype-1/metadata-fields", (route) => {
    fieldBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({
      status: 201,
      json: {
        documentType: documentType({
          metadataFields: [{ fieldId: "f1", name: "Categoria de risco", valueType: "SINGLE_SELECT", required: false, status: "ACTIVE", options: [{ optionId: "o1", label: "Alto", status: "ACTIVE" }], createdAt: "x", updatedAt: "x" }],
        }),
      },
    });
  });

  await page.goto("/settings/document-types/doctype-1");
  await expect(page.getByText("Nenhum campo definido ainda.")).toBeVisible();
  await page.getByRole("button", { name: "Adicionar campo" }).click();
  await page.getByLabel(/Nome do campo/).fill("Categoria de risco");
  await page.getByLabel(/Tipo de valor/).selectOption("SINGLE_SELECT");
  await page.getByLabel(/Opções/).fill("Alto, Médio, Baixo");
  await page.getByRole("button", { name: "Adicionar campo" }).click();

  await expect.poll(() => fieldBody?.["name"]).toBe("Categoria de risco");
  expect(fieldBody?.["options"]).toEqual(["Alto", "Médio", "Baixo"]);
  await expect(page.getByText("Categoria de risco")).toBeVisible();
});

test("E2E-B4-06: a version conflict (OCC) on deprecate shows the standard reload notice, not a generic error", async ({ page }) => {
  await mockOrganizations(page, "ADMIN");
  await mockCatalog(page, [documentType()]);
  await page.route("**/bff/api/document-archive/document-types/doctype-1/deprecate", (route) =>
    route.fulfill({ status: 409, json: { code: "VERSION_CONFLICT", category: "CONFLICT", message: "Version conflict.", retryable: false } }),
  );

  await page.goto("/settings/document-types");
  await page.getByRole("button", { name: "Descontinuar" }).click();
  await expect(page.getByText("Este tipo foi alterado por outra pessoa — recarregue antes de tentar de novo.")).toBeVisible();
});

// ---------------------------------------------------------------------------------------------
// Accessibility - same probes as e2e/accessibility.spec.ts / block3-subjects-requirements.spec.ts
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

async function setupCatalog(page: Page) {
  await mockOrganizations(page, "ADMIN");
  await mockCatalog(page, [documentType(), documentType({ documentTypeId: "doctype-2", displayName: "Apólice antiga", status: "DEPRECATED" })], [documentType({ documentTypeId: "doctype-2", displayName: "Apólice antiga", status: "DEPRECATED" })]);
}

async function setupEditor(page: Page) {
  await mockOrganizations(page, "ADMIN");
  await page.route("**/bff/api/document-archive/document-types/doctype-1", (route) =>
    route.fulfill({
      json: {
        documentType: documentType({
          metadataFields: [{ fieldId: "f1", name: "Categoria de risco", valueType: "SINGLE_SELECT", required: true, status: "ACTIVE", options: [{ optionId: "o1", label: "Alto", status: "ACTIVE" }], createdAt: "x", updatedAt: "x" }],
        }),
      },
    }),
  );
}

test.describe("A11Y-contrast (WCAG 2.2 SC 1.4.3) - Block 4 A20 screens", () => {
  for (const [name, path, setup] of [
    ["A20 Catálogo", "/settings/document-types", setupCatalog],
    ["A20 Editor de campos", "/settings/document-types/doctype-1", setupEditor],
  ] as const) {
    test(`A11Y-contrast: ${name} has no text below its required ratio`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await setup(page);
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const failures = await page.evaluate(CONTRAST_PROBE);
      expect(failures, `contrast failures on ${name}: ${JSON.stringify(failures, null, 1)}`).toEqual([]);
    });
  }
});

test.describe("A11Y-focus - Block 4 A20 screens: keyboard path with visible ring, adequate target size, full focusable coverage, no trap", () => {
  for (const [name, path, setup] of [
    ["A20 Catálogo", "/settings/document-types", setupCatalog],
    ["A20 Editor de campos", "/settings/document-types/doctype-1", setupEditor],
  ] as const) {
    test(`A11Y-focus: ${name}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await setup(page);
      await page.goto(path);
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

      expect(stops.length, `${name} should expose a substantial keyboard path`).toBeGreaterThan(3);

      const revisit = stops.findIndex((stop) => stop.revisitOf !== null);
      if (revisit !== -1) {
        expect(stops[revisit]?.revisitOf, `keyboard trap on ${name}`).toBe(0);
        terminated = true;
      }
      expect(terminated, `${name}: tab path neither wrapped nor left the document within ${MAX_TABS} presses`).toBe(true);

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
      expect(unreached, `${name}: focusable elements never reached: ${JSON.stringify(unreached, null, 1)}`).toEqual([]);

      for (const stop of stops.filter((candidate) => candidate.revisitOf === null)) {
        expect(stop.precededByPrevious, `${name}: tab order departs from DOM order at <${stop.tag}> "${stop.label}"`).toBe(true);
        expect(stop.outlineStyle, `${name}: no focus ring on <${stop.tag}> "${stop.label}"`).not.toBe("none");
        expect(stop.outlineWidth, `${name}: focus ring too thin on <${stop.tag}> "${stop.label}"`).toBeGreaterThanOrEqual(2);
        expect(stop.height, `${name}: target too short: <${stop.tag}> "${stop.label}"`).toBeGreaterThanOrEqual(24);
        expect(stop.width, `${name}: target too narrow: <${stop.tag}> "${stop.label}"`).toBeGreaterThanOrEqual(24);
      }
    });
  }
});

test.describe("A11Y-focus-not-obscured - Block 4 A20 screens: nothing sticky/fixed (SC 2.4.11)", () => {
  for (const [name, path, setup] of [
    ["A20 Catálogo", "/settings/document-types", setupCatalog],
    ["A20 Editor de campos", "/settings/document-types/doctype-1", setupEditor],
  ] as const) {
    test(`A11Y-focus-not-obscured: ${name}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await setup(page);
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const pinned = await page.evaluate(() =>
        Array.from(document.querySelectorAll("body *"))
          .filter((element) => ["sticky", "fixed"].includes(getComputedStyle(element).position))
          .filter((element) => !element.classList.contains("skip-link"))
          .map((element) => element.tagName.toLowerCase() + "." + String(element.className).split(" ")[0]),
      );
      expect(pinned, `${name}: sticky/fixed elements found`).toEqual([]);
    });
  }
});

test.describe("A11Y-reduced-motion - Block 4 A20 screens: transitions neutralised under prefers-reduced-motion", () => {
  for (const [name, path, setup] of [
    ["A20 Catálogo", "/settings/document-types", setupCatalog],
    ["A20 Editor de campos", "/settings/document-types/doctype-1", setupEditor],
  ] as const) {
    test(`A11Y-reduced-motion: ${name}`, async ({ browser }) => {
      const context = await browser.newContext({ reducedMotion: "reduce" });
      const page = await context.newPage();
      await mockSession(page, { authenticated: true, activeOrganizationId: "org-1" });
      await setup(page);
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const button = page.locator(".ui-button").first();
      await expect(button).toBeVisible();
      const duration = await button.evaluate((el) => getComputedStyle(el).transitionDuration);
      expect(duration.split(",").every((value) => value.trim() === "0.001s"), `${name}: transition not neutralised (${duration})`).toBe(true);
      await context.close();
    });
  }
});

test.describe("A11Y-forced-colors - Block 4 A20 screens: status badges keep a real border and non-empty text (VL-G3)", () => {
  test("A11Y-forced-colors: A20 catalog status badges", async ({ browser }) => {
    const context = await browser.newContext({ forcedColors: "active" });
    const page = await context.newPage();
    await mockSession(page, { authenticated: true, activeOrganizationId: "org-1" });
    await setupCatalog(page);
    await page.goto("/settings/document-types");
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
});

test("A11Y-forms: A20's 'Novo tipo' and 'Adicionar campo' forms have full label/error association", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockOrganizations(page, "ADMIN");
  await mockCatalog(page, [documentType()]);

  await page.goto("/settings/document-types");
  await page.getByRole("button", { name: "Novo tipo" }).click();
  // Accepts BOTH association forms WCAG allows: an explicit `label[for]` (TextField/SelectField)
  // and a label WRAPPING the control (Checkbox.tsx's own documented convention - "a real
  // <label> wrapping the input... not aria-label"). A probe checking `label[for]` alone would
  // flag Checkbox as unlabelled even though it is genuinely accessible.
  const unlabelledCatalog = await page.evaluate(() =>
    Array.from(document.querySelectorAll("input, textarea, select")).filter((control) => {
      const id = control.getAttribute("id");
      const hasExplicitLabel = Boolean(id) && document.querySelector(`label[for="${id}"]`) !== null;
      const hasWrappingLabel = control.closest("label") !== null;
      return !hasExplicitLabel && !hasWrappingLabel;
    }).length,
  );
  expect(unlabelledCatalog).toBe(0);

  await page.route("**/bff/api/document-archive/document-types/doctype-1", (route) => route.fulfill({ json: { documentType: documentType() } }));
  await page.goto("/settings/document-types/doctype-1");
  await page.getByRole("button", { name: "Adicionar campo" }).click();
  const unlabelledEditor = await page.evaluate(() =>
    Array.from(document.querySelectorAll("input, textarea, select")).filter((control) => {
      const id = control.getAttribute("id");
      const hasExplicitLabel = Boolean(id) && document.querySelector(`label[for="${id}"]`) !== null;
      const hasWrappingLabel = control.closest("label") !== null;
      return !hasExplicitLabel && !hasWrappingLabel;
    }).length,
  );
  expect(unlabelledEditor).toBe(0);
});
