import { test, expect, type Page } from "@playwright/test";

/**
 * Block 8 — A18 (Minhas preferências de notificação), D-2xx. Same mocking discipline as
 * `e2e/block7-tracking-delivery-guest.spec.ts`.
 */

function mockSession(page: Page, session: { authenticated: boolean; activeOrganizationId?: string }) {
  return page.route("**/bff/session", (route) => route.fulfill({ json: session }));
}

function mockOrganizations(page: Page, role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  return page.route("**/bff/organizations", (route) =>
    route.fulfill({ json: { organizations: [{ organizationId: "org-1", displayName: "Org One", role, version: 1 }] } }),
  );
}

function preferences(overrides: Record<string, unknown> = {}) {
  return {
    emailEnabled: true,
    locale: "pt-BR",
    quietHours: null,
    consentSource: "USER_SETTINGS",
    version: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function mockA18(page: Page, opts: { preferences?: Record<string, unknown>; onPut?: (body: unknown) => void; putStatus?: number; putBody?: unknown } = {}) {
  await page.route("**/bff/api/notifications/preferences", (route) => {
    if (route.request().method() === "PUT") {
      opts.onPut?.(route.request().postDataJSON());
      if (opts.putStatus && opts.putStatus !== 200) return route.fulfill({ status: opts.putStatus, json: opts.putBody ?? {} });
      return route.fulfill({ json: { preferences: preferences({ ...(opts.preferences ?? {}), version: (opts.preferences?.["version"] as number | undefined ?? 1) + 1 }) } });
    }
    return route.fulfill({ json: { preferences: opts.preferences ?? preferences() } });
  });
}

test.beforeEach(async ({ page }) => {
  await mockSession(page, { authenticated: true, activeOrganizationId: "org-1" });
});

test("E2E-B8-01: every role sees the nav entry and can reach the screen", async ({ page }) => {
  await mockOrganizations(page, "VIEWER");
  await mockA18(page);

  await page.goto("/overview");
  await expect(page.getByRole("link", { name: "Minhas preferências de notificação" })).toBeVisible();
  await page.getByRole("link", { name: "Minhas preferências de notificação" }).click();
  await expect(page.getByRole("heading", { name: "Minhas preferências de notificação" })).toBeVisible();
});

test("E2E-B8-02: e-mail is always locked checked, WhatsApp shows an unavailable badge, never an editable control", async ({ page }) => {
  await mockOrganizations(page, "MEMBER");
  await mockA18(page);

  await page.goto("/settings/notifications");
  await expect(page.getByLabel("Ativado")).toBeChecked();
  await expect(page.getByLabel("Ativado")).toBeDisabled();
  await expect(page.getByText("Indisponível", { exact: true })).toBeVisible();
});

test("E2E-B8-03: saving a new locale and quiet-hours window PUTs the real route with the built payload", async ({ page }) => {
  await mockOrganizations(page, "OWNER");
  let putBody: unknown;
  await mockA18(page, { onPut: (body) => (putBody = body) });

  await page.goto("/settings/notifications");
  await page.getByLabel(/^Idioma/).selectOption("en-US");
  await page.getByLabel(/^Das/).fill("22:00");
  await page.getByLabel(/^Até/).fill("06:00");
  await expect(page.getByText("Este intervalo atravessa a meia-noite.")).toBeVisible();
  await page.getByRole("button", { name: "Salvar preferências" }).click();

  await expect.poll(() => putBody).toEqual({
    emailEnabled: true,
    locale: "en-US",
    quietHours: { enabled: true, startLocal: "22:00", endLocal: "06:00", timeZone: expect.any(String) },
  });
  await expect(page.getByRole("button", { name: "Salvo" })).toBeVisible();
});

test("E2E-B8-04: an incomplete quiet-hours interval blocks save with a field error, never reaching the API", async ({ page }) => {
  await mockOrganizations(page, "OWNER");
  let putCalled = false;
  await mockA18(page, { onPut: () => (putCalled = true) });

  await page.goto("/settings/notifications");
  await page.getByLabel(/^Das/).fill("21:00");
  await expect(page.getByText("Informe os dois horários do intervalo, ou deixe ambos em branco.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Salvar preferências" })).toBeDisabled();
  expect(putCalled).toBe(false);
});

test("E2E-B8-05: a version conflict on save shows the OCC notice, disables Save, and 'Recarregar' re-hydrates from the real GET", async ({ page }) => {
  await mockOrganizations(page, "ADMIN");
  let getCallCount = 0;
  await page.route("**/bff/api/notifications/preferences", (route) => {
    if (route.request().method() === "PUT") return route.fulfill({ status: 409, json: { code: "CONFLICT", category: "CONFLICT", message: "Version conflict.", retryable: false } });
    getCallCount += 1;
    return route.fulfill({ json: { preferences: preferences(getCallCount === 1 ? { locale: "pt-BR", version: 1 } : { locale: "en-US", version: 2 }) } });
  });

  await page.goto("/settings/notifications");
  await page.getByRole("button", { name: "Salvar preferências" }).click();
  await expect(page.getByText(/alteradas em outro lugar/)).toBeVisible();
  await expect(page.getByText("Não foi possível salvar suas preferências. Tente novamente.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Salvar preferências" })).toBeDisabled();

  await page.getByRole("button", { name: "Recarregar" }).click();
  await expect(page.getByLabel(/^Idioma/)).toHaveValue("en-US");
  await expect(page.getByRole("button", { name: "Salvar preferências" })).toBeEnabled();
});

// Codex review round 2 (D-2xx) HIGH finding, corrected: a FAILED reload used to still clear the
// conflict flag, letting the next save silently repeat the same stale-version 409 forever.
test("E2E-B8-07: a failed 'Recarregar' keeps the conflict notice and Save disabled, never silently clearing it", async ({ page }) => {
  await mockOrganizations(page, "ADMIN");
  let getCallCount = 0;
  await page.route("**/bff/api/notifications/preferences", (route) => {
    if (route.request().method() === "PUT") return route.fulfill({ status: 409, json: { code: "CONFLICT", category: "CONFLICT", message: "Version conflict.", retryable: false } });
    getCallCount += 1;
    if (getCallCount === 1) return route.fulfill({ json: { preferences: preferences({ version: 1 }) } });
    // `retryable: false` - a genuinely retryable error would make `useNotificationPreferences`'s
    // own "safe-read" retry policy attempt this call up to 3 times with backoff before settling,
    // which would make this assertion flaky against a fixed timeout for no real reason.
    return route.fulfill({ status: 503, json: { code: "DEPENDENCY_UNAVAILABLE", category: "DEPENDENCY_UNAVAILABLE", message: "down", retryable: false } });
  });

  await page.goto("/settings/notifications");
  await page.getByRole("button", { name: "Salvar preferências" }).click();
  await expect(page.getByText(/alteradas em outro lugar/)).toBeVisible();

  await page.getByRole("button", { name: "Recarregar" }).click();
  await expect(page.getByText(/Não foi possível recarregar agora/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Salvar preferências" })).toBeDisabled();
});

// Codex review round 1 (D-2xx) BLOQUEANTE finding, corrected: the checkbox used to be hard-coded
// checked and the save payload hard-coded `emailEnabled: true` regardless of the real value - a
// real risk of silently un-suppressing an SES-complaint-suppressed address on any unrelated save.
test("E2E-B8-06: emailEnabled:false shows the checkbox unchecked and is preserved (never forced true) on save", async ({ page }) => {
  await mockOrganizations(page, "OWNER");
  let putBody: unknown;
  await mockA18(page, { preferences: preferences({ emailEnabled: false }), onPut: (body) => (putBody = body) });

  await page.goto("/settings/notifications");
  await expect(page.getByLabel("Ativado")).not.toBeChecked();
  await expect(page.getByText("Desativado — contate o suporte para reativar")).toBeVisible();
  await page.getByRole("button", { name: "Salvar preferências" }).click();

  await expect.poll(() => (putBody as Record<string, unknown> | undefined)?.["emailEnabled"]).toBe(false);
});

// ---------------------------------------------------------------------------------------------
// Accessibility
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
    // WCAG 1.4.3 exempts text that is part of an inactive UI component - real here for A18's
    // locked e-mail checkbox, whose label text is a DOM SIBLING of the disabled <input> (Checkbox
    // .tsx's own structure: <label><input disabled/><span/><span class="ui-checkbox__text"/></label>),
    // never a descendant, so \`:closest(":disabled")\` above never matches it. This is a real,
    // pre-existing gap in this probe (copy-pasted per E2E file, no shared module to fix once) -
    // named here rather than silently worked around.
    if (element.closest("label")?.querySelector(":disabled")) continue;
    const box = element.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    const fg = parse(style.color);
    const bg = parse(effectiveBackground(element));
    if (!fg || !bg) continue;
    const L1 = lum(fg.r, fg.g, fg.b);
    const L2 = lum(bg.r, bg.g, bg.b);
    const lighter = Math.max(L1, L2);
    const darker = Math.min(L1, L2);
    const ratio = (lighter + 0.05) / (darker + 0.05);
    const size = parseFloat(style.fontSize);
    const isLarge = size >= 24 || (size >= 18.66 && parseInt(style.fontWeight, 10) >= 700);
    const required = isLarge ? 3 : 4.5;
    if (ratio + 0.005 < required) {
      results.push({ selector: element.tagName.toLowerCase() + "." + String(element.className).split(" ")[0], text: element.textContent.trim().slice(0, 40), ratio: Number(ratio.toFixed(2)), required });
    }
  }
  return results;
})()`;

test("A11Y-contrast: A18 has no text below its required ratio", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockOrganizations(page, "OWNER");
  await mockA18(page, { preferences: preferences({ consentSource: "MIGRATED_DEFAULT", quietHours: { enabled: true, startLocal: "21:00", endLocal: "07:00", timeZone: "America/Sao_Paulo" } }) });
  await page.goto("/settings/notifications");
  await page.waitForLoadState("networkidle");
  const failures = await page.evaluate(CONTRAST_PROBE);
  expect(failures, `contrast failures: ${JSON.stringify(failures, null, 1)}`).toEqual([]);
});

test("A11Y-reduced-motion: A18 renders correctly under prefers-reduced-motion", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await mockSession(page, { authenticated: true, activeOrganizationId: "org-1" });
  await mockOrganizations(page, "OWNER");
  await mockA18(page);
  await page.goto("/settings/notifications");
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Minhas preferências de notificação" })).toBeVisible();
});
