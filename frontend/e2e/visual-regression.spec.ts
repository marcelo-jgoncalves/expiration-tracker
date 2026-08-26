import { test, expect, type Page } from "@playwright/test";

/**
 * Visual regression baselines for the Core Expiration slice (mission §68/§107/VL-G12).
 *
 * Purpose (mission §136): catch unexpected hierarchy/layout/state changes, NOT wage a war
 * over 1px. `maxDiffPixelRatio` is therefore set deliberately loose enough to absorb
 * sub-pixel text rasterisation while still failing on a moved column, a lost badge, a broken
 * stacked layout or a collapsed group header.
 *
 * Governance (mission §69): a changed snapshot is a REVIEW ITEM, never a thing to re-record
 * until CI is green. Regenerate only with `--update-snapshots` AND an explanation of the
 * visual change in the PR that does it.
 *
 * Determinism (mission §132): fixed viewport, fixed locale/timezone (playwright.config.ts),
 * a fixed clock injected before any app code runs, a deterministic seeded fixture, and
 * animations disabled by the screenshot call itself. Nothing here depends on the network or
 * on the real current date - a suite whose baselines rot every midnight is worse than none.
 */

/** The whole suite renders "as of" this instant, so every relative date ("Vence em 3 dias")
 * is stable forever. */
const FIXED_NOW = Date.UTC(2026, 7, 26, 12, 0, 0);

const CATEGORIES = ["Licenças", "Fiscal", "Financeiro", "Contratos", "Segurança do trabalho"];
const ISSUERS: (string | undefined)[] = ["Prefeitura Municipal de São José dos Campos", "Serasa Experian", "Porto Seguro", "Alfa Serviços Ltda", undefined];
/** Long names, near-identical names and long Portuguese words are the point (mission §114). */
const NAMES = [
  "Alvará de Funcionamento — Unidade Centro",
  "Alvará de Funcionamento — Unidade Zona Sul",
  "Certificado Digital e-CNPJ A1",
  "Certificado Digital e-CNPJ A3",
  "Apólice de Seguro Patrimonial",
  "Contrato de Prestação de Serviços de Limpeza e Conservação Predial Continuada",
  "Licença de Operação Ambiental — Renovação Quadrienal do Estabelecimento Industrial",
  "AVCB — Auto de Vistoria do Corpo de Bombeiros",
];

function stressItems(count: number) {
  const items = [];
  for (let index = 0; index < count; index++) {
    // Deterministic spread across overdue / due-soon / later, so all three urgency groups and
    // both status tones are exercised at every run.
    const offsetDays = index % 5 === 0 ? -((index % 40) + 1) : index % 3 === 0 ? index % 7 : 10 + (index % 300);
    items.push({
      itemId: `item-${index}`,
      tenantId: "tenant-1",
      name: `${NAMES[index % NAMES.length]}${index % 7 === 0 ? ` (${1 + (index % 4)}ª via)` : ""}`,
      category: CATEGORIES[index % CATEGORIES.length],
      issuer: ISSUERS[index % ISSUERS.length],
      number: index % 3 === 0 ? `2024/${String(index).padStart(5, "0")}` : undefined,
      dueDate: new Date(FIXED_NOW + offsetDays * 86_400_000).toISOString(),
      tags: [],
      status: "ACTIVE",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    });
  }
  return items;
}

const DETAIL_ITEM = {
  itemId: "item-1",
  tenantId: "tenant-1",
  name: "Licença de Operação Ambiental — Renovação Quadrienal do Estabelecimento Industrial",
  category: "Licenças",
  description: "Renovação obrigatória junto ao órgão ambiental estadual. Exige protocolo com 120 dias de antecedência.",
  issuer: "Companhia Ambiental do Estado",
  number: "2024/00918",
  periodicity: "Quadrienal",
  priority: "Alta",
  dueDate: new Date(FIXED_NOW + 3 * 86_400_000).toISOString(),
  tags: ["ambiental", "obrigatório"],
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  version: 3,
};

/** Freezes `Date.now()`/`new Date()` before any app module evaluates. Every relative date the
 * UI derives (`presentItemUrgency`, `formatRelativeDueContext`) becomes reproducible. */
async function freezeClock(page: Page) {
  await page.addInitScript(`{
    const fixed = ${FIXED_NOW};
    const RealDate = Date;
    class FrozenDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) { super(fixed); } else { super(...args); }
      }
      static now() { return fixed; }
    }
    globalThis.Date = FrozenDate;
  }`);
}

async function mockSession(page: Page) {
  await page.route("**/bff/session", (route) => route.fulfill({ json: { authenticated: true, tenantId: "tenant-1", userId: "user-1" } }));
}

async function mockDashboard(page: Page, items: unknown[]) {
  await page.route("**/bff/api/items/dashboard**", (route) => route.fulfill({ json: { items } }));
}

const SNAPSHOT_OPTIONS = { maxDiffPixelRatio: 0.02, animations: "disabled" as const, fullPage: true };

test.beforeEach(async ({ page }) => {
  await freezeClock(page);
  await mockSession(page);
});

test("VR-01: Overview - desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockDashboard(page, stressItems(6));
  await page.goto("/overview");
  await expect(page.getByRole("heading", { name: "Visão geral" })).toBeVisible();
  await expect(page).toHaveScreenshot("overview-desktop.png", SNAPSHOT_OPTIONS);
});

/**
 * The density gate (mission §28/§101/VL-G6). 140 items across all three urgency groups, with
 * long and near-identical names. This is the scenario the milestone brief flagged as never
 * having been verified against real frontend code - it is verified here, and a regression
 * that makes the dense collection unscannable now fails a test.
 */
test("VR-02: Collection - desktop, dense (140 items)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockDashboard(page, stressItems(140));
  await page.goto("/items");
  await expect(page.getByRole("columnheader", { name: /Vencidos/ })).toBeVisible();
  // Every record keeps its identifier, its absolute date, its urgency and its status - the
  // stacked/desktop layouts differ visually but neither drops a column.
  await expect(page.locator("td.ui-table__cell--primary")).toHaveCount(140);
  await expect(page).toHaveScreenshot("collection-desktop-dense.png", SNAPSHOT_OPTIONS);
});

test("VR-03: Collection - narrow, dense (stacked rows keep every field)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await mockDashboard(page, stressItems(12));
  await page.goto("/items");
  await expect(page.getByRole("columnheader", { name: /Vencidos/ })).toBeVisible();
  await expect(page).toHaveScreenshot("collection-narrow-dense.png", SNAPSHOT_OPTIONS);
});

test("VR-04: Collection - true-empty state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockDashboard(page, []);
  await page.goto("/items");
  await expect(page.getByText("Nenhum vencimento cadastrado ainda.")).toBeVisible();
  await expect(page).toHaveScreenshot("collection-empty.png", SNAPSHOT_OPTIONS);
});

test("VR-05: Detail - desktop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/bff/api/items/item-1", (route) => route.fulfill({ json: { item: DETAIL_ITEM } }));
  await page.goto("/items/item-1");
  await expect(page.getByRole("heading", { name: DETAIL_ITEM.name })).toBeVisible();
  await expect(page).toHaveScreenshot("detail-desktop.png", SNAPSHOT_OPTIONS);
});

test("VR-06: Create - narrow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/items/new");
  await expect(page.getByRole("heading", { name: "Novo vencimento" })).toBeVisible();
  await expect(page).toHaveScreenshot("create-narrow.png", SNAPSHOT_OPTIONS);
});

test("VR-07: Create - validation errors (summary + per-field)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/items/new");
  await page.getByRole("button", { name: "Criar vencimento" }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page).toHaveScreenshot("create-validation-errors.png", SNAPSHOT_OPTIONS);
});

/** OCC (mission §48): a concurrency conflict has its own visual pattern and its own recovery
 * action, and is NOT rendered as "the system broke". */
test("VR-08: Renew - OCC conflict recovery", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/bff/api/items/item-1", (route) => route.fulfill({ json: { item: DETAIL_ITEM } }));
  await page.route("**/bff/api/items/item-1/renew", (route) =>
    route.fulfill({ status: 409, json: { code: "VERSION_CONFLICT", category: "CONFLICT", message: "conflito de versão", retryable: false } }),
  );
  await page.goto("/items/item-1/renew");
  await page.getByLabel(/Nova data de vencimento/).fill("2027-09-01");
  await page.getByRole("button", { name: "Confirmar renovação" }).click();
  await expect(page.getByText("Este vencimento mudou desde que você o abriu")).toBeVisible();
  await expect(page).toHaveScreenshot("renew-occ-conflict.png", SNAPSHOT_OPTIONS);
});

test("VR-09: shared error state", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/bff/api/items/dashboard**", (route) =>
    route.fulfill({ status: 500, json: { code: "INTERNAL", category: "INTERNAL", message: "Erro interno do servidor.", retryable: false } }),
  );
  await page.goto("/overview");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveScreenshot("shared-error-state.png", SNAPSHOT_OPTIONS);
});

/** Focus visibility is a gate (VL-G4), so it gets its own baseline rather than being trusted
 * to a code review of the CSS. */
test("VR-10: focus ring on the primary action", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockDashboard(page, stressItems(4));
  await page.goto("/items");
  await page.getByRole("link", { name: "Novo vencimento" }).focus();
  await expect(page.getByRole("link", { name: "Novo vencimento" })).toBeFocused();
  await expect(page).toHaveScreenshot("focus-primary-action.png", { ...SNAPSHOT_OPTIONS, fullPage: false });
});
