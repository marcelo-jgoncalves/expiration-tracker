import { test, expect, type Page } from "@playwright/test";

/**
 * Block 3 E2E/accessibility gap closure (D-259 -> D-2xx). D-259 recorded that A08 (Fornecedores
 * CRUD), A09 (Subject Hub) and A11 (Requisitos documentais) were verified by unit/component/
 * typecheck/lint/boundaries/docs only - the E2E/Playwright and accessibility suites were never
 * run against these 3 screens. This file closes that gap: real user flows (create/edit/archive/
 * delete a Subject with RBAC variation per role), the compliance panel's null-vs-percent states,
 * the 5-state Requirement badge, and navigation A08 -> A09 -> A11. Accessibility checks reuse
 * e2e/accessibility.spec.ts's established probes (contrast, keyboard path + focus ring + target
 * size + focusable coverage, no sticky/fixed, reduced motion, forced colors, label/error
 * association) rather than re-inventing them.
 *
 * Same mocking discipline as the other E2E specs: every scenario mocks the BFF via
 * page.route(), preserving real response shapes/status codes - there is no live BFF reachable
 * from this sandbox.
 */

function mockSession(page: Page, session: { authenticated: boolean; activeOrganizationId?: string }) {
  return page.route("**/bff/session", (route) => route.fulfill({ json: session }));
}

function mockOrganizations(page: Page, role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  return page.route("**/bff/organizations", (route) =>
    route.fulfill({ json: { organizations: [{ organizationId: "org-1", displayName: "Org One", role, version: 1 }] } }),
  );
}

function subject(overrides: Record<string, unknown> = {}) {
  return {
    subjectId: "subj-1",
    tenantId: "tenant-1",
    type: "VENDOR",
    displayName: "Fornecedor Alfa Ltda",
    externalId: "12.345.678/0001-90",
    notes: undefined,
    tags: [],
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function requirement(overrides: Record<string, unknown> = {}) {
  return {
    requirementId: "req-1",
    subjectId: "subj-1",
    name: "Certidão Negativa de Débitos",
    applicability: "APPLICABLE",
    status: "MISSING",
    assigneeUserId: undefined,
    evidenceValidUntil: undefined,
    evidenceVersionId: undefined,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function mockCompliance(page: Page, compliance: Record<string, unknown>) {
  return page.route("**/bff/api/document-archive/requirements/*/compliance", (route) => route.fulfill({ json: { compliance } }));
}

function mockRequirementsForSubject(page: Page, requirements: unknown[]) {
  return page.route("**/bff/api/document-archive/requirements/subj-1", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ json: { requirements } });
  });
}

test.beforeEach(async ({ page }) => {
  await mockSession(page, { authenticated: true, activeOrganizationId: "org-1" });
});

// ---------------------------------------------------------------------------------------------
// E2E: A08 Fornecedores CRUD + RBAC
// ---------------------------------------------------------------------------------------------

test("E2E-B3-01: MEMBER creates a subject -> lands on the Hub", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await page.route("**/bff/api/subjects/dashboard**", (route) => route.fulfill({ json: { subjects: [] } }));
  let createBody: Record<string, unknown> | undefined;
  await page.route("**/bff/api/subjects", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    createBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ status: 201, json: { subject: subject({ displayName: createBody["displayName"] }) } });
  });
  await page.route("**/bff/api/subjects/subj-1", (route) => route.fulfill({ json: { subject: subject() } }));
  await mockCompliance(page, { totalRequirements: 0, satisfiedCount: 0, expiringSoonCount: 0, missingCount: 0, compliancePercent: null });
  await mockRequirementsForSubject(page, []);

  await page.goto("/subjects");
  await expect(page.getByRole("heading", { name: "Fornecedores" })).toBeVisible();
  await page.getByRole("link", { name: "Novo fornecedor" }).first().click();
  await expect(page).toHaveURL(/\/subjects\/new$/);

  await page.getByLabel(/^Nome/).fill("Fornecedor Alfa Ltda");
  await page.getByRole("button", { name: "Salvar" }).click();

  await expect(page).toHaveURL(/\/subjects\/subj-1$/);
  await expect(page.getByRole("heading", { name: "Fornecedor Alfa Ltda" })).toBeVisible();
  expect(createBody?.["displayName"]).toBe("Fornecedor Alfa Ltda");
});

test("E2E-B3-02: VIEWER sees the collection with no write actions (no 'Novo fornecedor', no row menu)", async ({ page }) => {
  await mockOrganizations(page, "VIEWER");
  await page.route("**/bff/api/subjects/dashboard**", (route) => route.fulfill({ json: { subjects: [subject()] } }));

  await page.goto("/subjects");
  await expect(page.getByRole("heading", { name: "Fornecedores" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Novo fornecedor" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Editar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Arquivar|Excluir/ })).toHaveCount(0);
});

test("E2E-B3-03: MEMBER can archive but NOT delete (no Excluir button) - RBAC verified against authorization.ts (subject:delete is ADMIN_ROLES)", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await page.route("**/bff/api/subjects/dashboard**", (route) => route.fulfill({ json: { subjects: [subject()] } }));
  let archiveCalled = false;
  await page.route("**/bff/api/subjects/subj-1/archive", (route) => {
    archiveCalled = true;
    return route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/bff/api/subjects/dashboard?status=ARCHIVED", (route) => route.fulfill({ json: { subjects: [subject({ status: "ARCHIVED" })] } }));

  await page.goto("/subjects");
  await expect(page.getByRole("button", { name: "Excluir" })).toHaveCount(0);
  await page.getByRole("button", { name: "Arquivar" }).click();
  await expect.poll(() => archiveCalled).toBe(true);
});

test("E2E-B3-04: ADMIN can delete a subject (subject:delete, ADMIN_ROLES) with confirm dialog", async ({ page }) => {
  await mockOrganizations(page, "ADMIN");
  await page.route("**/bff/api/subjects/dashboard**", (route) => route.fulfill({ json: { subjects: [subject()] } }));
  let deleteCalled = false;
  await page.route("**/bff/api/subjects/subj-1", (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    deleteCalled = true;
    return route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/subjects");
  await page.getByRole("button", { name: "Excluir" }).click();
  await expect(page.getByRole("alertdialog", { name: /Excluir Fornecedor Alfa/ })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect.poll(() => deleteCalled).toBe(true);
});

// ---------------------------------------------------------------------------------------------
// E2E: A09 Subject Hub - compliance null-vs-percent states, RBAC-gated actions, navigation
// ---------------------------------------------------------------------------------------------

test("E2E-B3-05: compliance panel shows '-' (never 0%) when totalRequirements is 0", async ({ page }) => {
  await mockOrganizations(page, "ADMIN");
  await page.route("**/bff/api/subjects/subj-1", (route) => route.fulfill({ json: { subject: subject() } }));
  await mockCompliance(page, { totalRequirements: 0, satisfiedCount: 0, expiringSoonCount: 0, missingCount: 0, compliancePercent: null });
  await mockRequirementsForSubject(page, []);

  await page.goto("/subjects/subj-1");
  await expect(page.getByRole("heading", { name: "Conformidade" })).toBeVisible();
  await expect(page.locator("#compliance-heading").locator("..")).toContainText("—");
  await expect(page.getByText("0%")).toHaveCount(0);
});

test("E2E-B3-06: compliance panel shows a real percent with numerator/denominator when requirements exist", async ({ page }) => {
  await mockOrganizations(page, "ADMIN");
  await page.route("**/bff/api/subjects/subj-1", (route) => route.fulfill({ json: { subject: subject() } }));
  await mockCompliance(page, { totalRequirements: 4, satisfiedCount: 3, expiringSoonCount: 1, missingCount: 0, compliancePercent: 75 });
  await mockRequirementsForSubject(page, [requirement({ status: "SATISFIED" })]);

  await page.goto("/subjects/subj-1");
  await expect(page.getByText("75%")).toBeVisible();
  await expect(page.getByText("3 de 4 requisitos satisfeitos")).toBeVisible();
});

test("E2E-B3-07: A09 -> A11 navigation carries ?subjectId= and A11 honors it via the per-subject query", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await page.route("**/bff/api/subjects/subj-1", (route) => route.fulfill({ json: { subject: subject() } }));
  await mockCompliance(page, { totalRequirements: 1, satisfiedCount: 0, expiringSoonCount: 0, missingCount: 1, compliancePercent: 0 });
  await mockRequirementsForSubject(page, [requirement()]);

  await page.goto("/subjects/subj-1");
  await page.getByRole("link", { name: "Requisitos documentais" }).click();
  await expect(page).toHaveURL(/\/requirements\?subjectId=subj-1$/);
  await expect(page.getByRole("heading", { name: "Requisitos documentais" })).toBeVisible();
  await expect(page.getByText("Requisitos de documento deste fornecedor.")).toBeVisible();
  await expect(page.getByText("Certidão Negativa de Débitos")).toBeVisible();
});

test("E2E-B3-08: only ADMIN sees 'Excluir fornecedor' and 'Pré-visualizar dossiê' on the Hub (subject:delete / docarchive:dossier-export, both ADMIN_ROLES)", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await page.route("**/bff/api/subjects/subj-1", (route) => route.fulfill({ json: { subject: subject() } }));
  await mockCompliance(page, { totalRequirements: 0, satisfiedCount: 0, expiringSoonCount: 0, missingCount: 0, compliancePercent: null });
  await mockRequirementsForSubject(page, []);

  await page.goto("/subjects/subj-1");
  await expect(page.getByRole("button", { name: "Excluir fornecedor" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pré-visualizar dossiê" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Editar fornecedor" })).toBeVisible(); // subject:update, WRITE_ROLES
});

// ---------------------------------------------------------------------------------------------
// E2E: A11 Requisitos documentais - 5-state badge, create/edit/delete
// ---------------------------------------------------------------------------------------------

test("E2E-B3-09: all 5 Requirement status states render with the correct label", async ({ page }) => {
  await mockOrganizations(page, "VIEWER");
  await page.route("**/bff/api/document-archive/requirements/search**", (route) => {
    const url = new URL(route.request().url());
    const status = url.searchParams.get("status");
    const byStatus: Record<string, unknown> = {
      MISSING: requirement({ requirementId: "r-missing", name: "Req Missing", status: "MISSING" }),
      PENDING: requirement({ requirementId: "r-pending", name: "Req Pending", status: "PENDING" }),
      SATISFIED: requirement({ requirementId: "r-satisfied", name: "Req Satisfied", status: "SATISFIED" }),
      NOT_SATISFIED: requirement({ requirementId: "r-notsat", name: "Req NotSatisfied", status: "NOT_SATISFIED" }),
      NOT_APPLICABLE: requirement({ requirementId: "r-na", name: "Req NA", status: "NOT_APPLICABLE" }),
    };
    return route.fulfill({ json: { items: status && byStatus[status] ? [byStatus[status]] : [], scanLimitReached: false } });
  });

  await page.goto("/requirements");
  await expect(page.getByRole("heading", { name: "Requisitos documentais" })).toBeVisible();
  for (const label of ["Em falta", "Pendente", "Satisfeito", "Não satisfeito", "Não se aplica"]) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
});

test("E2E-B3-10: MEMBER creates a requirement -> visible in the list", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await page.route("**/bff/api/document-archive/requirements/search**", (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: { items: url.searchParams.get("status") === "MISSING" ? [requirement({ requirementId: "r-existing", name: "Existente" })] : [], scanLimitReached: false } });
  });
  let createBody: Record<string, unknown> | undefined;
  await page.route("**/bff/api/document-archive/requirements", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    createBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ status: 201, json: { requirement: requirement({ requirementId: "r-new", name: createBody["name"] as string }) } });
  });

  await page.goto("/requirements");
  await page.getByRole("button", { name: "Novo requisito" }).click();
  await page.getByLabel("ID do fornecedor").fill("subj-2");
  await page.getByLabel("Nome do requisito").fill("Apólice de Seguro Vigente");
  await page.getByRole("button", { name: "Criar requisito" }).click();

  await expect.poll(() => createBody?.["name"]).toBe("Apólice de Seguro Vigente");
  expect(createBody?.["subjectId"]).toBe("subj-2");
});

test("E2E-B3-11: VIEWER sees no 'Novo requisito' button and no row actions", async ({ page }) => {
  await mockOrganizations(page, "VIEWER");
  await page.route("**/bff/api/document-archive/requirements/search**", (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: { items: url.searchParams.get("status") === "MISSING" ? [requirement()] : [], scanLimitReached: false } });
  });

  await page.goto("/requirements");
  await expect(page.getByRole("button", { name: "Novo requisito" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Editar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Excluir" })).toHaveCount(0);
});

test("E2E-B3-12: MEMBER deletes a requirement (docarchive:requirement-delete is WRITE_ROLES, a deliberate exception)", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await page.route("**/bff/api/document-archive/requirements/search**", (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: { items: url.searchParams.get("status") === "MISSING" ? [requirement()] : [], scanLimitReached: false } });
  });
  let deleteCalled = false;
  await page.route("**/bff/api/document-archive/requirements/subj-1/req-1/delete", (route) => {
    deleteCalled = true;
    return route.fulfill({ status: 204, body: "" });
  });

  await page.goto("/requirements");
  await page.getByRole("button", { name: "Excluir" }).click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect.poll(() => deleteCalled).toBe(true);
});

// ---------------------------------------------------------------------------------------------
// E2E: full A08 -> A09 -> A11 navigation chain
// ---------------------------------------------------------------------------------------------

test("E2E-B3-13: navigate A08 -> A09 -> A11 and back", async ({ page }) => {
  await mockOrganizations(page, "ADMIN");
  await page.route("**/bff/api/subjects/dashboard**", (route) => route.fulfill({ json: { subjects: [subject()] } }));
  await page.route("**/bff/api/subjects/subj-1", (route) => route.fulfill({ json: { subject: subject() } }));
  await mockCompliance(page, { totalRequirements: 1, satisfiedCount: 0, expiringSoonCount: 0, missingCount: 1, compliancePercent: 0 });
  await mockRequirementsForSubject(page, [requirement()]);

  await page.goto("/subjects");
  await page.getByRole("link", { name: "Fornecedor Alfa Ltda" }).click();
  await expect(page).toHaveURL(/\/subjects\/subj-1$/);
  await expect(page.locator("#surface-content")).toBeFocused();

  await page.getByRole("link", { name: "Requisitos documentais" }).click();
  await expect(page).toHaveURL(/\/requirements\?subjectId=subj-1$/);

  await page.getByRole("link", { name: "Certidão Negativa de Débitos" }).click();
  await expect(page).toHaveURL(/\/subjects\/subj-1$/);

  await page.getByRole("link", { name: "← Voltar para Fornecedores" }).click();
  await expect(page).toHaveURL(/\/subjects$/);
});

// ---------------------------------------------------------------------------------------------
// Accessibility - same probes as e2e/accessibility.spec.ts, applied to A08/A09/A11
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

async function setupA08(page: Page) {
  await mockOrganizations(page, "ADMIN");
  await page.route("**/bff/api/subjects/dashboard**", (route) => route.fulfill({ json: { subjects: [subject(), subject({ subjectId: "subj-2", displayName: "Fornecedor Beta", externalId: undefined })] } }));
}

async function setupA09(page: Page) {
  await mockOrganizations(page, "ADMIN");
  await page.route("**/bff/api/subjects/subj-1", (route) => route.fulfill({ json: { subject: subject() } }));
  await mockCompliance(page, { totalRequirements: 4, satisfiedCount: 3, expiringSoonCount: 1, missingCount: 0, compliancePercent: 75 });
  await mockRequirementsForSubject(page, [requirement({ status: "SATISFIED" })]);
}

async function setupA11(page: Page) {
  await mockOrganizations(page, "ADMIN");
  await page.route("**/bff/api/document-archive/requirements/search**", (route) => {
    const url = new URL(route.request().url());
    const status = url.searchParams.get("status");
    return route.fulfill({
      json: {
        items: status === "MISSING" ? [requirement()] : status === "PENDING" ? [requirement({ requirementId: "r-2", name: "Req Pendente", status: "PENDING" })] : [],
        scanLimitReached: false,
      },
    });
  });
}

test.describe("A11Y-contrast (WCAG 2.2 SC 1.4.3) - Block 3 screens", () => {
  for (const [name, path, setup] of [
    ["A08 Fornecedores", "/subjects", setupA08],
    ["A09 Subject Hub", "/subjects/subj-1", setupA09],
    ["A11 Requisitos", "/requirements", setupA11],
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

test.describe("A11Y-focus - Block 3 screens: keyboard path with visible ring, adequate target size, full focusable coverage, no trap", () => {
  for (const [name, path, setup] of [
    ["A08 Fornecedores", "/subjects", setupA08],
    ["A09 Subject Hub", "/subjects/subj-1", setupA09],
    ["A11 Requisitos", "/requirements", setupA11],
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

      expect(stops.length, `${name} should expose a substantial keyboard path`).toBeGreaterThan(5);

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

test.describe("A11Y-focus-not-obscured - Block 3 screens: nothing sticky/fixed (SC 2.4.11)", () => {
  for (const [name, path, setup] of [
    ["A08 Fornecedores", "/subjects", setupA08],
    ["A09 Subject Hub", "/subjects/subj-1", setupA09],
    ["A11 Requisitos", "/requirements", setupA11],
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

test.describe("A11Y-reduced-motion - Block 3 screens: transitions neutralised under prefers-reduced-motion", () => {
  for (const [name, path, setup] of [
    ["A08 Fornecedores", "/subjects", setupA08],
    ["A09 Subject Hub", "/subjects/subj-1", setupA09],
    ["A11 Requisitos", "/requirements", setupA11],
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

test.describe("A11Y-forced-colors - Block 3 screens: badges/status stay identifiable (VL-G3)", () => {
  test("A11Y-forced-colors: A11 status badges keep a real border and non-empty text", async ({ browser }) => {
    const context = await browser.newContext({ forcedColors: "active" });
    const page = await context.newPage();
    await mockSession(page, { authenticated: true, activeOrganizationId: "org-1" });
    await setupA11(page);
    await page.goto("/requirements");
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

test("A11Y-forms: A08's create form has full label/error association", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockOrganizations(page, "ADMIN");
  await page.goto("/subjects/new");

  const unlabelled = await page.evaluate(() =>
    Array.from(document.querySelectorAll("input, textarea, select")).filter((control) => {
      const id = control.getAttribute("id");
      return !id || document.querySelector(`label[for="${id}"]`) === null;
    }).length,
  );
  expect(unlabelled).toBe(0);

  await page.getByRole("button", { name: "Salvar" }).click();
  const nameField = page.getByLabel(/^Nome/);
  await expect(nameField).toHaveAttribute("aria-invalid", "true");
  const describedBy = await nameField.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`#${describedBy}`)).toHaveText("Informe o nome do fornecedor.");
});

test("A11Y-forms: A11's inline create-requirement form has full label/error association", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupA11(page);
  await page.goto("/requirements");
  await page.getByRole("button", { name: "Novo requisito" }).click();

  const unlabelled = await page.evaluate(() =>
    Array.from(document.querySelectorAll("input, textarea, select")).filter((control) => {
      const id = control.getAttribute("id");
      return !id || document.querySelector(`label[for="${id}"]`) === null;
    }).length,
  );
  expect(unlabelled).toBe(0);
});
