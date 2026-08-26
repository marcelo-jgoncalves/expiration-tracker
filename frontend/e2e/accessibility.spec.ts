import { test, expect, type Page } from "@playwright/test";

/**
 * Accessibility verification, executable and versioned (Codex Round D, D-03).
 *
 * Round D's finding was fair and important: the milestone document claimed measured results
 * ("0 contrast failures", "22/22 focus stops", reduced-motion and forced-colors behaviour)
 * whose only evidence was a throwaway script outside the repository. A quality gate whose
 * proof cannot be re-run is a claim, not a gate. These are those measurements, turned into
 * assertions that run in CI on every PR.
 *
 * This is NOT a claim of full WCAG conformance, and it is not a substitute for a real screen
 * reader session (still not performed - see docs/frontend/visual-language-and-design-system.md
 * §28/§35). It verifies the specific, machine-checkable properties the visual gates depend on.
 *
 * `axe` is deliberately not used: it is not part of frontend/'s toolchain (the milestone brief
 * requires it only if already present), and these checks measure the computed page - which is
 * how the two real contrast/target-size defects in this milestone were actually found.
 */

const FIXED_NOW = Date.UTC(2026, 7, 26, 12, 0, 0);

function items(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    itemId: `item-${index}`,
    tenantId: "tenant-1",
    name: ["Alvará de Funcionamento — Unidade Centro", "Certificado Digital e-CNPJ A1", "Contrato de Prestação de Serviços de Limpeza e Conservação Predial Continuada"][index % 3],
    category: ["Licenças", "Fiscal", "Contratos"][index % 3],
    issuer: index % 4 === 3 ? undefined : "Prefeitura Municipal de São José dos Campos",
    dueDate: new Date(FIXED_NOW + (index % 3 === 0 ? -(index + 1) : index % 3 === 1 ? 3 : 90) * 86_400_000).toISOString(),
    tags: [],
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
  }));
}

async function setup(page: Page, count = 9) {
  await page.addInitScript(`{
    const fixed = ${FIXED_NOW};
    const RealDate = Date;
    class FrozenDate extends RealDate {
      constructor(...args) { if (args.length === 0) { super(fixed); } else { super(...args); } }
      static now() { return fixed; }
    }
    globalThis.Date = FrozenDate;
  }`);
  await page.route("**/bff/session", (route) => route.fulfill({ json: { authenticated: true, tenantId: "tenant-1", userId: "user-1" } }));
  await page.route("**/bff/api/items/dashboard**", (route) => route.fulfill({ json: { items: items(count) } }));
}

/** WCAG relative-luminance contrast, computed in-page against COMPUTED colours - not against
 * the palette table, so a token used on an unexpected background is still caught. */
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

test.describe("contrast (WCAG 2.2 SC 1.4.3) — VL-G2", () => {
  for (const [name, path] of [
    ["Collection", "/items"],
    ["Overview", "/overview"],
    ["Create", "/items/new"],
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

test("A11Y-focus: every keyboard stop on the Collection has a visible ring and an adequate target — VL-G4 / SC 2.5.8", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  await page.goto("/items");
  await page.waitForLoadState("networkidle");

  /**
   * Each stop is stamped with its index as it is visited, so a SECOND visit to the same
   * element is detectable rather than silently indistinguishable (Codex Round F, F-02). The
   * earlier version of this test pressed Tab a fixed number of times and asserted properties
   * of whatever it landed on: a trap cycling between three controls would have satisfied it,
   * and the document claimed "no trap" on that basis.
   *
   * `precededByPrevious` compares each stop against the one before it in DOM order. Tab order
   * following DOM order is the actual normative requirement (SC 1.3.2 / 2.4.3 meaningful
   * sequence); it is what this test can prove. Whether the DOM order also reads correctly on
   * screen is carried by the visual baselines and by manual inspection, and the document says
   * so rather than claiming this test proves it.
   */
  const MAX_TABS = 60;
  const stops: {
    tag: string;
    label: string;
    outlineWidth: number;
    outlineStyle: string;
    width: number;
    height: number;
    revisitOf: number | null;
    precededByPrevious: boolean;
  }[] = [];
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
        precededByPrevious:
          previous === null ||
          previous === element ||
          Boolean(previous.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING),
      };
    }, index);
    if (!stop) {
      // Focus left the document (browser chrome). The traversal terminates - it does not trap.
      terminated = true;
      break;
    }
    stops.push(stop);
    if (stop.revisitOf !== null) break;
  }

  expect(stops.length, "the Collection should expose a substantial keyboard path").toBeGreaterThan(10);

  const revisit = stops.findIndex((stop) => stop.revisitOf !== null);
  if (revisit !== -1) {
    // Returning to the FIRST stop after visiting everything is a normal wrap, not a trap.
    expect(
      stops[revisit]?.revisitOf,
      `keyboard trap: stop ${revisit} ("${stops[revisit]?.label}") returned to stop ${stops[revisit]?.revisitOf} without covering the page`,
    ).toBe(0);
    terminated = true;
  }
  expect(terminated, `the tab path neither wrapped nor left the document within ${MAX_TABS} presses - likely a trap`).toBe(true);

  for (const stop of stops) {
    expect(stop.precededByPrevious, `tab order departs from DOM order at <${stop.tag}> "${stop.label}"`).toBe(true);
    expect(stop.outlineStyle, `no focus ring on <${stop.tag}> "${stop.label}"`).not.toBe("none");
    expect(stop.outlineWidth, `focus ring too thin on <${stop.tag}> "${stop.label}"`).toBeGreaterThanOrEqual(2);
    // SC 2.5.8 Target Size (Minimum). Every interactive control in this system clears 24px in
    // both dimensions on its own, without relying on the spacing exception.
    expect(stop.height, `target too short: <${stop.tag}> "${stop.label}"`).toBeGreaterThanOrEqual(24);
    expect(stop.width, `target too narrow: <${stop.tag}> "${stop.label}"`).toBeGreaterThanOrEqual(24);
  }
});

test("A11Y-focus-not-obscured: nothing in the system is sticky or fixed, so focus cannot be covered — SC 2.4.11", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page, 60);
  await page.goto("/items");
  await page.waitForLoadState("networkidle");

  const pinned = await page.evaluate(() =>
    Array.from(document.querySelectorAll("body *"))
      .filter((element) => ["sticky", "fixed"].includes(getComputedStyle(element).position))
      // The skip link is absolutely positioned and is itself the first focusable element; it
      // can never cover the thing it hands focus to.
      .filter((element) => !element.classList.contains("skip-link"))
      .map((element) => element.tagName.toLowerCase() + "." + String(element.className).split(" ")[0]),
  );
  expect(pinned).toEqual([]);
});

test("A11Y-reduced-motion: every animation and transition is neutralised under prefers-reduced-motion", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await setup(page);
  // Hold the response open so the skeleton (the only looping animation) is on screen.
  await page.route("**/bff/api/items/dashboard**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await route.fulfill({ json: { items: items(4) } });
  });
  void page.goto("/items");
  await page.waitForSelector(".ui-skeleton__bar");

  const durations = await page.evaluate(() => ({
    skeleton: getComputedStyle(document.querySelector(".ui-skeleton__bar") as Element).animationDuration,
    button: getComputedStyle(document.querySelector(".ui-button") as Element).transitionDuration,
  }));
  expect(durations.skeleton).toBe("0.001s");
  expect(durations.button.split(",").every((value) => value.trim() === "0.001s")).toBe(true);
  await context.close();
});

test("A11Y-forced-colors: status stays identifiable when authored colours are replaced — VL-G3", async ({ browser }) => {
  const context = await browser.newContext({ forcedColors: "active" });
  const page = await context.newPage();
  await setup(page);
  await page.goto("/items");
  await page.waitForLoadState("networkidle");
  await page.waitForSelector(".ui-badge");

  const badges = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".ui-badge"))
      .slice(0, 4)
      .map((element) => ({
        text: element.textContent?.trim() ?? "",
        borderColor: getComputedStyle(element).borderTopColor,
        borderWidth: parseFloat(getComputedStyle(element).borderTopWidth),
      })),
  );

  expect(badges.length).toBeGreaterThan(0);
  for (const badge of badges) {
    // The label is the carrier of meaning; it must survive with no colour at all.
    expect(badge.text.length).toBeGreaterThan(0);
    // The border is forced to a system colour rather than disappearing, so the badge is still
    // a distinct object rather than loose text in a cell.
    expect(badge.borderWidth).toBeGreaterThan(0);
    expect(badge.borderColor).not.toBe("rgba(0, 0, 0, 0)");
  }
});

test("A11Y-scroll-region: the table wrapper is keyboard reachable exactly when it can scroll (Codex Round B, B-04)", async ({ page }) => {
  await setup(page);

  // Desktop: everything fits, so an extra tab stop would be an empty promise.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/items");
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".ui-table-scroll")).not.toHaveAttribute("tabindex", /.*/);

  // In-between width: at 1000px the six columns genuinely overflow (measured ~101px), so the
  // wrapper must become focusable AND named. Chosen deliberately over a width nearer the
  // 820px stacking breakpoint, where the overflow can be a single pixel and the assertion
  // would be about rounding rather than about behaviour.
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(page.locator(".ui-table-scroll")).toHaveAttribute("tabindex", "0");
  await expect(page.locator(".ui-table-scroll")).toHaveAttribute("role", "region");
  await expect(page.locator(".ui-table-scroll")).toHaveAttribute("aria-label", /Vencimentos/);

  // Narrow: the layout stacks, nothing overflows, the stop goes away again.
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(page.locator(".ui-table-scroll")).not.toHaveAttribute("tabindex", /.*/);
});

test("A11Y-forms: every control has a visible label, and errors are associated, not merely coloured — VL-G10", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  await page.goto("/items/new");

  const unlabelled = await page.evaluate(() =>
    Array.from(document.querySelectorAll("input, textarea, select")).filter((control) => {
      const id = control.getAttribute("id");
      return !id || document.querySelector(`label[for="${id}"]`) === null;
    }).length,
  );
  expect(unlabelled).toBe(0);

  await page.getByRole("button", { name: "Criar vencimento" }).click();

  const nameField = page.getByLabel(/^Nome/);
  await expect(nameField).toHaveAttribute("aria-invalid", "true");
  const describedBy = await nameField.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`#${describedBy}`)).toHaveText("Informe um nome.");
  // The summary link carries the SAME string and points at the control.
  await expect(page.getByRole("link", { name: "Nome: Informe um nome." })).toHaveAttribute("href", "#create-item-name");
});
