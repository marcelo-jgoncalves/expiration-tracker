import { test, expect, type Page } from "@playwright/test";

/**
 * Block 4 E2E/accessibility (D-2xx) — A21 (Requirement Templates). Sibling of
 * `block4-catalogs.spec.ts` (A20); same mocking/accessibility-probe discipline, verified from
 * the start per D-260.
 */

function mockSession(page: Page, session: { authenticated: boolean; activeOrganizationId?: string }) {
  return page.route("**/bff/session", (route) => route.fulfill({ json: session }));
}

function mockOrganizations(page: Page, role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  return page.route("**/bff/organizations", (route) =>
    route.fulfill({ json: { organizations: [{ organizationId: "org-1", displayName: "Org One", role, version: 1 }] } }),
  );
}

function template(overrides: Record<string, unknown> = {}) {
  return {
    templateId: "tpl-1",
    displayName: "Fornecedor de serviços — padrão",
    status: "ACTIVE",
    items: [
      { templateItemId: "item-1", name: "CND Federal", applicability: "APPLICABLE", position: 0 },
      { templateItemId: "item-2", name: "CND Estadual", applicability: "APPLICABLE", position: 1 },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 3,
    ...overrides,
  };
}

function mockCatalog(page: Page, active: unknown[], archived: unknown[] = []) {
  return page.route("**/bff/api/document-archive/requirement-templates**", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const url = new URL(route.request().url());
    const status = url.searchParams.get("status");
    return route.fulfill({ json: { requirementTemplates: status === "ARCHIVED" ? archived : active } });
  });
}

function mockDetail(page: Page, tpl: Record<string, unknown>) {
  return page.route(`**/bff/api/document-archive/requirement-templates/${tpl["templateId"]}`, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ json: { requirementTemplate: tpl } });
  });
}

test.beforeEach(async ({ page }) => {
  await mockSession(page, { authenticated: true, activeOrganizationId: "org-1" });
});

// ---------------------------------------------------------------------------------------------
// E2E: A21 catalog/detail - RBAC tiers, archive/reactivate, duplicate, apply flow
// ---------------------------------------------------------------------------------------------

test("E2E-B4-07: ADMIN creates a template and it becomes selected", async ({ page }) => {
  await mockOrganizations(page, "ADMIN");
  await mockCatalog(page, []);
  let createBody: Record<string, unknown> | undefined;
  await page.route("**/bff/api/document-archive/requirement-templates", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    createBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ status: 201, json: { requirementTemplate: template({ displayName: createBody["displayName"], items: [] }) } });
  });
  await mockDetail(page, template({ items: [] }));

  await page.goto("/settings/requirement-templates");
  await expect(page.getByRole("heading", { name: "Templates de requisitos" })).toBeVisible();
  await page.getByRole("button", { name: "Novo template" }).click();
  await page.getByLabel(/Nome do template/).fill("Checklist novo fornecedor");
  await page.getByRole("button", { name: "Criar template" }).click();

  await expect.poll(() => createBody?.["displayName"]).toBe("Checklist novo fornecedor");
  await expect(page).toHaveURL(/\/settings\/requirement-templates\/tpl-1$/);
});

test("E2E-B4-08: VIEWER browses read-only - no 'Novo template', no admin actions, no apply", async ({ page }) => {
  await mockOrganizations(page, "VIEWER");
  await mockCatalog(page, [template()]);
  await mockDetail(page, template());

  await page.goto("/settings/requirement-templates");
  await expect(page.getByRole("heading", { name: /Fornecedor de serviços/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Novo template" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Arquivar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Aplicar a fornecedor" })).toHaveCount(0);
});

test("E2E-B4-09: MEMBER applies (WRITE_ROLES) but has no catalog-admin actions", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await mockCatalog(page, [template()]);
  await mockDetail(page, template());

  await page.goto("/settings/requirement-templates");
  await expect(page.getByRole("button", { name: "Aplicar a fornecedor" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Arquivar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Duplicar" })).toHaveCount(0);
});

test("E2E-B4-10: ADMIN archives a template (docarchive:requirementtemplate-archive)", async ({ page }) => {
  await mockOrganizations(page, "ADMIN");
  await mockCatalog(page, [template()]);
  await mockDetail(page, template());
  let archiveBody: Record<string, unknown> | undefined;
  await page.route("**/bff/api/document-archive/requirement-templates/tpl-1/archive", (route) => {
    archiveBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ json: { requirementTemplate: template({ status: "ARCHIVED" }) } });
  });

  await page.goto("/settings/requirement-templates");
  await page.getByRole("button", { name: "Arquivar" }).click();
  await expect.poll(() => archiveBody?.["expectedVersion"]).toBe(3);
});

test("E2E-B4-11: ADMIN duplicates an ARCHIVED template (audit fix: catalog-admin-only even when archived)", async ({ page }) => {
  await mockOrganizations(page, "ADMIN");
  await mockCatalog(page, [], [template({ status: "ARCHIVED" })]);
  await mockDetail(page, template({ status: "ARCHIVED" }));
  let duplicateBody: Record<string, unknown> | undefined;
  await page.route("**/bff/api/document-archive/requirement-templates/tpl-1/duplicate", (route) => {
    duplicateBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ status: 201, json: { requirementTemplate: template({ templateId: "tpl-2", displayName: duplicateBody?.["displayName"], status: "ACTIVE", version: 1 }) } });
  });

  await page.goto("/settings/requirement-templates");
  await expect(page.getByText("Template arquivado — somente leitura para não-admins.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Editar" })).toBeDisabled();
  await page.getByRole("button", { name: "Duplicar" }).click();
  await page.getByLabel(/Nome da cópia/).fill("Cópia de referência");
  await page.getByRole("button", { name: "Confirmar duplicação" }).click();

  await expect.poll(() => duplicateBody?.["displayName"]).toBe("Cópia de referência");
});

test("E2E-B4-12: VIEWER cannot open the archived template's Duplicar action at all (nav-level RBAC still honest, read stays available)", async ({ page }) => {
  await mockOrganizations(page, "VIEWER");
  await mockCatalog(page, [], [template({ status: "ARCHIVED" })]);
  await mockDetail(page, template({ status: "ARCHIVED" }));

  await page.goto("/settings/requirement-templates");
  await expect(page.getByRole("heading", { name: /Fornecedor de serviços/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Duplicar" })).toHaveCount(0);
});

test("E2E-B4-13: full apply-to-subject flow - preview shows NOVO/DUPLICATE_NAME, confirm creates only the NOVO items", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await mockCatalog(page, [template()]);
  await mockDetail(page, template());
  let previewBody: Record<string, unknown> | undefined;
  let applyBody: Record<string, unknown> | undefined;
  await page.route("**/bff/api/document-archive/requirement-templates/tpl-1/preview", (route) => {
    previewBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({
      json: {
        create: [{ templateItemId: "item-1", name: "CND Federal", applicability: "APPLICABLE", position: 0 }],
        skip: [{ templateItemId: "item-2", name: "CND Estadual", reason: "DUPLICATE_NAME", existingRequirementId: "req-9", sameTemplateItem: false }],
        templateVersion: 3,
      },
    });
  });
  await page.route("**/bff/api/document-archive/requirement-templates/tpl-1/apply", (route) => {
    applyBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({
      json: { created: [{ templateItemId: "item-1", requirementId: "req-new", name: "CND Federal" }], skipped: [{ templateItemId: "item-2", name: "CND Estadual", reason: "DUPLICATE_NAME", existingRequirementId: "req-9", sameTemplateItem: false }], templateVersion: 3 },
    });
  });

  await page.goto("/settings/requirement-templates");
  await page.getByRole("button", { name: "Aplicar a fornecedor" }).click();
  await page.getByLabel(/ID do fornecedor/).fill("subj-42");
  await page.getByRole("button", { name: "Pré-visualizar aplicação" }).click();

  await expect.poll(() => previewBody?.["subjectId"]).toBe("subj-42");
  await expect(page.getByText("Já existe um requisito com este nome neste fornecedor — será ignorado")).toBeVisible();
  await expect(page.getByText("Novo", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Confirmar aplicação" }).click();
  await expect.poll(() => applyBody?.["subjectId"]).toBe("subj-42");
  await expect(page.getByText("1 requisito(s) criado(s), 1 ignorado(s) por duplicidade de nome.")).toBeVisible();
});

test("E2E-B4-14: a template with zero items disables 'Aplicar a fornecedor'", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await mockCatalog(page, [template({ items: [] })]);
  await mockDetail(page, template({ items: [] }));

  await page.goto("/settings/requirement-templates");
  await expect(page.getByRole("button", { name: "Aplicar a fornecedor" })).toBeDisabled();
});

test("E2E-B4-15: ADMIN reorders template items with the ▲/▼ buttons (a real full-array update, not a fabricated endpoint)", async ({ page }) => {
  await mockOrganizations(page, "ADMIN");
  await mockCatalog(page, [template()]);
  await mockDetail(page, template());
  let updateBody: Record<string, unknown> | undefined;
  await page.route("**/bff/api/document-archive/requirement-templates/tpl-1", (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    updateBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ json: { requirementTemplate: template({ items: [{ templateItemId: "item-2", name: "CND Estadual", applicability: "APPLICABLE", position: 0 }, { templateItemId: "item-1", name: "CND Federal", applicability: "APPLICABLE", position: 1 }], version: 4 }) } });
  });

  await page.goto("/settings/requirement-templates");
  await page.getByRole("button", { name: 'Mover "CND Estadual" para cima' }).click();

  await expect.poll(() => (updateBody?.["items"] as Array<{ name: string }> | undefined)?.map((i) => i.name)).toEqual(["CND Estadual", "CND Federal"]);
  // Codex block-review finding (LOW): the original version only asserted item order, so a
  // regression that silently dropped `expectedVersion` from the reorder PATCH (which the real
  // backend requires in the body, not the `If-Match` header - see `requirementTemplates.ts`'s
  // own doc comment) would have passed this test and then 400'd in production.
  expect(updateBody?.["expectedVersion"]).toBe(3);
});

// ---------------------------------------------------------------------------------------------
// Accessibility - same probes as e2e/accessibility.spec.ts
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
    // WCAG 1.4.3 explicitly exempts "inactive user interface component" text from the
    // contrast requirement - this screen is the first to load a disabled control with visible
    // text at initial render (the first item's "up" and the last item's "down" reorder
    // buttons), which the shared probe copy (e2e/accessibility.spec.ts) never needed to
    // exempt before. Scoped to this file's own copy, not the canonical one, since only this
    // screen's initial state exercises it.
    if (element.matches && element.matches(":disabled")) continue;
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

async function setupScreen(page: Page) {
  await mockOrganizations(page, "ADMIN");
  await mockCatalog(page, [template(), template({ templateId: "tpl-2", displayName: "Fornecedor de equipamentos", items: [{ templateItemId: "item-3", name: "Certificado de garantia", applicability: "APPLICABLE", position: 0 }] })]);
  await mockDetail(page, template());
}

test.describe("A11Y-contrast (WCAG 2.2 SC 1.4.3) - Block 4 A21 screen", () => {
  test("A11Y-contrast: A21 Templates has no text below its required ratio", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setupScreen(page);
    await page.goto("/settings/requirement-templates");
    await page.waitForLoadState("networkidle");
    const failures = await page.evaluate(CONTRAST_PROBE);
    expect(failures, `contrast failures: ${JSON.stringify(failures, null, 1)}`).toEqual([]);
  });
});

test.describe("A11Y-focus - Block 4 A21 screen: keyboard path with visible ring, adequate target size, full focusable coverage, no trap", () => {
  test("A11Y-focus: A21 Templates", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await setupScreen(page);
    await page.goto("/settings/requirement-templates");
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

    expect(stops.length, "A21 Templates should expose a substantial keyboard path").toBeGreaterThan(5);

    const revisit = stops.findIndex((stop) => stop.revisitOf !== null);
    if (revisit !== -1) {
      expect(stops[revisit]?.revisitOf, "keyboard trap on A21 Templates").toBe(0);
      terminated = true;
    }
    expect(terminated, `A21 Templates: tab path neither wrapped nor left the document within ${MAX_TABS} presses`).toBe(true);

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
    expect(unreached, `A21 Templates: focusable elements never reached: ${JSON.stringify(unreached, null, 1)}`).toEqual([]);

    for (const stop of stops.filter((candidate) => candidate.revisitOf === null)) {
      expect(stop.precededByPrevious, `A21 Templates: tab order departs from DOM order at <${stop.tag}> "${stop.label}"`).toBe(true);
      expect(stop.outlineStyle, `A21 Templates: no focus ring on <${stop.tag}> "${stop.label}"`).not.toBe("none");
      expect(stop.outlineWidth, `A21 Templates: focus ring too thin on <${stop.tag}> "${stop.label}"`).toBeGreaterThanOrEqual(2);
      expect(stop.height, `A21 Templates: target too short: <${stop.tag}> "${stop.label}"`).toBeGreaterThanOrEqual(24);
      expect(stop.width, `A21 Templates: target too narrow: <${stop.tag}> "${stop.label}"`).toBeGreaterThanOrEqual(24);
    }
  });
});

test("A11Y-focus-not-obscured: A21 Templates has nothing sticky/fixed (SC 2.4.11)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupScreen(page);
  await page.goto("/settings/requirement-templates");
  await page.waitForLoadState("networkidle");
  const pinned = await page.evaluate(() =>
    Array.from(document.querySelectorAll("body *"))
      .filter((element) => ["sticky", "fixed"].includes(getComputedStyle(element).position))
      .filter((element) => !element.classList.contains("skip-link"))
      .map((element) => element.tagName.toLowerCase() + "." + String(element.className).split(" ")[0]),
  );
  expect(pinned, "A21 Templates: sticky/fixed elements found").toEqual([]);
});

test("A11Y-reduced-motion: A21 Templates neutralises transitions under prefers-reduced-motion", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await mockSession(page, { authenticated: true, activeOrganizationId: "org-1" });
  await setupScreen(page);
  await page.goto("/settings/requirement-templates");
  await page.waitForLoadState("networkidle");
  const button = page.locator(".ui-button").first();
  await expect(button).toBeVisible();
  const duration = await button.evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(duration.split(",").every((value) => value.trim() === "0.001s"), `transition not neutralised (${duration})`).toBe(true);
  await context.close();
});

test("A11Y-forced-colors: A21 status badges keep a real border and non-empty text (VL-G3)", async ({ browser }) => {
  const context = await browser.newContext({ forcedColors: "active" });
  const page = await context.newPage();
  await mockSession(page, { authenticated: true, activeOrganizationId: "org-1" });
  await setupScreen(page);
  await page.goto("/settings/requirement-templates");
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

test("A11Y-forms: A21's 'Novo template' and 'Aplicar a fornecedor' forms have full label/error association", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockOrganizations(page, "ADMIN");
  await mockCatalog(page, [template()]);
  await mockDetail(page, template());

  await page.goto("/settings/requirement-templates");
  await page.getByRole("button", { name: "Novo template" }).click();
  const unlabelledCreate = await page.evaluate(() =>
    Array.from(document.querySelectorAll("input, textarea, select")).filter((control) => {
      const id = control.getAttribute("id");
      return !(Boolean(id) && document.querySelector(`label[for="${id}"]`) !== null) && control.closest("label") === null;
    }).length,
  );
  expect(unlabelledCreate).toBe(0);

  // Codex block-review finding (LOW): this test's title promised BOTH forms but only ever
  // opened "Novo template" - the apply form's own label/error association was never checked.
  await page.getByRole("button", { name: "Cancelar" }).click();
  await page.getByRole("button", { name: "Aplicar a fornecedor" }).click();
  const unlabelledApply = await page.evaluate(() =>
    Array.from(document.querySelectorAll("input, textarea, select")).filter((control) => {
      const id = control.getAttribute("id");
      return !(Boolean(id) && document.querySelector(`label[for="${id}"]`) !== null) && control.closest("label") === null;
    }).length,
  );
  expect(unlabelledApply).toBe(0);
});
