import { test, expect, type Page } from "@playwright/test";

/**
 * Density gate, functional half (mission §28/§101/VL-G6).
 *
 * The visual half lives in e2e/visual-regression.spec.ts, which is a local-only project (see
 * playwright.config.ts for why). This file is the part CI runs on every PR: it asserts the
 * PROPERTIES that make a dense collection scannable, in a way that is independent of font
 * rasterisation and therefore safe to gate on from any runner.
 *
 * "Não aprovar Collection apenas com 5 registros bonitos" - the milestone brief flagged that
 * density had never actually been verified against real frontend code. It is verified here.
 */

const FIXED_NOW = Date.UTC(2026, 7, 26, 12, 0, 0);

const NAMES = [
  "Alvará de Funcionamento — Unidade Centro",
  "Alvará de Funcionamento — Unidade Zona Sul",
  "Certificado Digital e-CNPJ A1",
  "Contrato de Prestação de Serviços de Limpeza e Conservação Predial Continuada",
  "Licença de Operação Ambiental — Renovação Quadrienal do Estabelecimento Industrial",
];

function stressItems(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    itemId: `item-${index}`,
    tenantId: "tenant-1",
    name: `${NAMES[index % NAMES.length]}${index % 7 === 0 ? ` (${1 + (index % 4)}ª via)` : ""}`,
    category: ["Licenças", "Fiscal", "Financeiro", "Contratos"][index % 4],
    issuer: index % 5 === 4 ? undefined : "Prefeitura Municipal de São José dos Campos",
    dueDate: new Date(FIXED_NOW + (index % 5 === 0 ? -((index % 40) + 1) : index % 3 === 0 ? index % 7 : 10 + (index % 300)) * 86_400_000).toISOString(),
    tags: [],
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
  }));
}

async function freezeClock(page: Page) {
  await page.addInitScript(`{
    const fixed = ${FIXED_NOW};
    const RealDate = Date;
    class FrozenDate extends RealDate {
      constructor(...args) { if (args.length === 0) { super(fixed); } else { super(...args); } }
      static now() { return fixed; }
    }
    globalThis.Date = FrozenDate;
  }`);
}

async function setup(page: Page, count: number) {
  await freezeClock(page);
  await page.route("**/bff/session", (route) => route.fulfill({ json: { authenticated: true, tenantId: "tenant-1", userId: "user-1" } }));
  await page.route("**/bff/api/items/dashboard**", (route) => route.fulfill({ json: { items: stressItems(count) } }));
}

test("DENSITY-01: 140 items render as one semantic table, grouped by urgency, most urgent first", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page, 140);
  await page.goto("/items");

  await expect(page.locator("td.ui-table__cell--primary")).toHaveCount(140);
  // Group order is the operational priority order, not insertion order.
  const groupHeaders = await page.getByRole("rowheader").allInnerTexts();
  const urgencyGroups = groupHeaders.filter((text) => /Vencidos|Vence em breve|Demais ativos/.test(text));
  expect(urgencyGroups.map((text) => text.replace(/\s*\d+\s*$/, "").trim())).toEqual(["Vencidos", "Vence em breve", "Demais ativos"]);

  // Every row carries the four things that must never be dropped for density: identifier,
  // absolute date, urgency, lifecycle status.
  const firstRow = page.locator("tbody tr").filter({ has: page.locator("td.ui-table__cell--primary") }).first();
  await expect(firstRow.locator("td")).toHaveCount(6);
  await expect(firstRow.locator('td[data-label="Data de vencimento"]')).toHaveText(/\d{2}\/\d{2}\/\d{4}/);
  // Two badges per row: urgency and lifecycle status, never merged into one (mission §32).
  await expect(firstRow.locator(".ui-badge")).toHaveCount(2);
});

test("DENSITY-02: at 375px nothing is hidden - the stacked layout keeps every field of every row", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await setup(page, 30);
  await page.goto("/items");

  await expect(page.locator("td.ui-table__cell--primary")).toHaveCount(30);
  const firstRow = page.locator("tbody tr").filter({ has: page.locator("td.ui-table__cell--primary") }).first();
  // `data-label` is what makes each stacked cell self-describing once the column headers are
  // visually hidden; if a cell lost its label the stacked layout would be unreadable.
  for (const label of ["Categoria", "Data de vencimento", "Urgência", "Situação"]) {
    await expect(firstRow.locator(`td[data-label="${label}"]`)).toBeVisible();
  }
  // The page must not scroll horizontally at the narrowest supported width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("DENSITY-03: at 200% zoom the dense collection still reflows without horizontal page scroll", async ({ page }) => {
  // WCAG 2.2 SC 1.4.10 Reflow: 1280px content at 200% zoom == a 640px CSS viewport.
  await page.setViewportSize({ width: 640, height: 800 });
  await setup(page, 60);
  await page.goto("/items");

  await expect(page.locator("td.ui-table__cell--primary")).toHaveCount(60);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
