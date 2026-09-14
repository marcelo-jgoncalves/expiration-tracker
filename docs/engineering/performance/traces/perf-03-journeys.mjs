// Throwaway measurement harness for PERF-03 (frontend/browser baseline), journeys J01-J08.
// NOT a CI test. Run with: node docs/engineering/performance/traces/perf-03-journeys.mjs
//
// Requires the Vite preview server already running at http://127.0.0.1:4173 (npm run build && npm run preview
// -- --port 4173 --strictPort --host 127.0.0.1 from frontend/), same server the e2e suite uses.
//
// Every backend call is mocked via page.route() exactly like frontend/e2e/*.spec.ts - there is no live
// BFF/backend reachable from this sandbox, and mocking preserves the real response shapes.

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolve `playwright` against frontend/'s node_modules (this script lives outside frontend/,
// so plain ESM bare-specifier resolution walking up from this file would never find it).
const require = createRequire(path.resolve(__dirname, "../../../../frontend/package.json"));
const { chromium } = require("playwright");
const BASE_URL = "http://127.0.0.1:4173";
const SCREENSHOTS_DIR = path.resolve(__dirname, "../screenshots");
mkdirSync(SCREENSHOTS_DIR, { recursive: true });

// ---------------------------------------------------------------------------------------------
// Shared mock fixtures (mirrors frontend/e2e/*.spec.ts response shapes)
// ---------------------------------------------------------------------------------------------

function subject(overrides = {}) {
  return {
    subjectId: "subj-1",
    tenantId: "tenant-1",
    type: "VENDOR",
    displayName: "Fornecedor Alfa Ltda",
    externalId: "12.345.678/0001-90",
    tags: [],
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function requirement(overrides = {}) {
  return {
    requirementId: "req-1",
    subjectId: "subj-1",
    name: "Certidão Negativa de Débitos",
    applicability: "APPLICABLE",
    status: "MISSING",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function items(count = 20) {
  return Array.from({ length: count }, (_, i) => ({
    itemId: `item-${i}`,
    tenantId: "tenant-1",
    name: `Alvará ${i}`,
    category: "licenca",
    dueDate: `2026-1${(i % 2) + 1}-01`,
    tags: [],
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    version: 1,
  }));
}

async function mockCommon(page, role = "ADMIN") {
  await page.route("**/bff/session", (route) => route.fulfill({ json: { authenticated: true, activeOrganizationId: "org-1" } }));
  await page.route("**/bff/organizations", (route) =>
    route.fulfill({ json: { organizations: [{ organizationId: "org-1", displayName: "Org One", role, version: 1 }] } }),
  );
}

async function setupJourney(page, name) {
  await mockCommon(page);
  switch (name) {
    case "J01": // Login -> Overview
      await page.route("**/bff/api/items/dashboard**", (route) => route.fulfill({ json: { items: items(20) } }));
      break;
    case "J02": // Overview -> Items
      await page.route("**/bff/api/items/dashboard**", (route) => route.fulfill({ json: { items: items(20) } }));
      break;
    case "J03": // Overview -> Subjects
      await page.route("**/bff/api/items/dashboard**", (route) => route.fulfill({ json: { items: items(20) } }));
      await page.route("**/bff/api/subjects/dashboard**", (route) => route.fulfill({ json: { subjects: [subject(), subject({ subjectId: "subj-2", displayName: "Fornecedor Beta" })] } }));
      break;
    case "J04": // Subjects -> SubjectHub
      await page.route("**/bff/api/subjects/dashboard**", (route) => route.fulfill({ json: { subjects: [subject()] } }));
      await page.route("**/bff/api/subjects/subj-1", (route) => route.fulfill({ json: { subject: subject() } }));
      await page.route("**/bff/api/document-archive/requirements/*/compliance", (route) => route.fulfill({ json: { compliance: { totalRequirements: 4, satisfiedCount: 3, expiringSoonCount: 1, missingCount: 0, compliancePercent: 75 } } }));
      await page.route("**/bff/api/document-archive/requirements/subj-1", (route) => route.fulfill({ json: { requirements: [requirement({ status: "SATISFIED" })] } }));
      break;
    case "J05": // SubjectHub -> Requirements
      await page.route("**/bff/api/subjects/subj-1", (route) => route.fulfill({ json: { subject: subject() } }));
      await page.route("**/bff/api/document-archive/requirements/*/compliance", (route) => route.fulfill({ json: { compliance: { totalRequirements: 1, satisfiedCount: 0, expiringSoonCount: 0, missingCount: 1, compliancePercent: 0 } } }));
      await page.route("**/bff/api/document-archive/requirements/subj-1", (route) => route.fulfill({ json: { requirements: [requirement()] } }));
      break;
    case "J06": // Requirements -> DocumentDetail
      await page.route("**/bff/api/document-archive/requirements/search**", (route) => route.fulfill({ json: { items: [requirement()], scanLimitReached: false } }));
      await page.route("**/bff/api/document-archive/documents/doc-1", (route) =>
        route.fulfill({ json: { document: { documentId: "doc-1", subjectId: "subj-1", documentTypeId: "dt-1", status: "ACTIVE", hasValidity: true, createdAt: "2026-09-01T08:00:00.000Z", updatedAt: "2026-09-01T08:00:00.000Z", version: 1 } } }),
      );
      await page.route("**/bff/api/document-archive/documents/doc-1/versions", (route) =>
        route.fulfill({
          json: {
            versions: [
              { documentId: "doc-1", seq: 1, versionId: "ver-1", state: "SUPERSEDED", origin: "MANUAL_UPLOAD", receivedAt: "2026-09-08T08:12:00.000Z", pendingFileScans: 0, infectedFileScans: 0, createdAt: "2026-09-08T08:12:00.000Z", updatedAt: "2026-09-08T08:12:00.000Z", version: 1 },
              { documentId: "doc-1", seq: 2, versionId: "ver-2", state: "ACCEPTED", origin: "MANUAL_UPLOAD", receivedAt: "2026-09-09T08:12:00.000Z", pendingFileScans: 0, infectedFileScans: 0, createdAt: "2026-09-09T08:12:00.000Z", updatedAt: "2026-09-09T08:12:00.000Z", version: 1 },
            ],
          },
        }),
      );
      break;
    case "J07": // Reports
      await page.route("**/bff/api/reports/subscriptions", (route) => route.fulfill({ json: { subscriptions: [] } }));
      break;
    case "J08": // Settings (notifications)
      await page.route("**/bff/api/notifications/preferences", (route) => route.fulfill({ json: { preferences: { emailEnabled: true, locale: "pt-BR", quietHours: null, consentSource: "USER_SETTINGS", version: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } } }));
      break;
  }
}

// The journey definitions: navigation steps as (action) functions plus final "settle" locator.
const JOURNEYS = {
  J01: { path: "/overview", steps: async () => {}, usefulData: "tbody tr, text=Nenhum vencimento cadastrado ainda." },
  J02: { path: "/overview", steps: async (page) => { await page.getByRole("link", { name: "Vencimentos" }).first().click().catch(() => {}); }, usefulData: "h1, h2" },
  J03: { path: "/overview", steps: async (page) => { await page.goto(`${BASE_URL}/subjects`); }, usefulData: "text=Fornecedores" },
  J04: { path: "/subjects", steps: async (page) => { await page.getByRole("link", { name: "Fornecedor Alfa Ltda" }).click(); }, usefulData: "text=Conformidade" },
  J05: { path: "/subjects/subj-1", steps: async (page) => { await page.getByRole("link", { name: "Requisitos documentais" }).click(); }, usefulData: "text=Requisitos documentais" },
  J06: { path: "/requirements", steps: async () => {}, usefulData: "text=Requisitos documentais" },
  J07: { path: "/reports", steps: async () => {}, usefulData: "h1, h2" },
  J08: { path: "/settings/notifications", steps: async () => {}, usefulData: "text=Minhas preferências de notificação" },
};

// ---------------------------------------------------------------------------------------------
// Metric collection
// ---------------------------------------------------------------------------------------------

const PERF_SCRIPT = `(() => new Promise((resolve) => {
  const nav = performance.getEntriesByType("navigation")[0];
  let lcp = 0;
  let cls = 0;
  const po1 = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) lcp = Math.max(lcp, e.startTime);
  });
  try { po1.observe({ type: "largest-contentful-paint", buffered: true }); } catch (e) {}
  const po2 = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (!e.hadRecentInput) cls += e.value;
  });
  try { po2.observe({ type: "layout-shift", buffered: true }); } catch (e) {}
  setTimeout(() => {
    resolve({
      ttfb: nav ? nav.responseStart - nav.requestStart : null,
      dcl: nav ? nav.domContentLoadedEventEnd - nav.startTime : null,
      load: nav ? nav.loadEventEnd - nav.startTime : null,
      lcp,
      cls,
    });
  }, 600);
}))()`;

async function measureJourney(browser, name, { throttle = false } = {}) {
  const context = await browser.newContext({ locale: "pt-BR", timezoneId: "UTC" });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  if (throttle) {
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      downloadThroughput: (1.6 * 1024 * 1024) / 8, // ~1.6 Mbps Fast 4G-ish
      uploadThroughput: (0.75 * 1024 * 1024) / 8,
      latency: 150,
    });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }

  let requestCount = 0;
  let jsBytes = 0;
  const jsTimings = [];
  page.on("response", async (response) => {
    requestCount += 1;
    const req = response.request();
    if (req.resourceType() === "script") {
      try {
        const body = await response.body();
        jsBytes += body.length;
      } catch (e) {
        // navigated away / opaque response, ignore
      }
      const timing = response.request().timing();
      if (timing) jsTimings.push(timing);
    }
  });

  await setupJourney(page, name);

  const journey = JOURNEYS[name];
  const t0 = Date.now();
  await page.goto(`${BASE_URL}${journey.path}`, { waitUntil: "domcontentloaded" });
  await journey.steps(page);
  // "Time to useful data": wait for the journey's defining content locator to be visible.
  let usefulDataMs = null;
  try {
    const locatorStr = journey.usefulData;
    const parts = locatorStr.split(", ");
    await Promise.race(parts.map((sel) => page.locator(sel).first().waitFor({ state: "visible", timeout: 10000 })));
    usefulDataMs = Date.now() - t0;
  } catch (e) {
    usefulDataMs = null; // could not confirm within timeout
  }
  await page.waitForLoadState("networkidle").catch(() => {});

  const perf = await page.evaluate(PERF_SCRIPT);

  const result = {
    journey: name,
    throttled: throttle,
    ttfbMs: perf.ttfb,
    dclMs: perf.dcl,
    loadMs: perf.load,
    lcpMs: perf.lcp,
    clsScore: perf.cls,
    inpApprox: "not measured (needs real user interaction timing; see report notes)",
    jsTransferredBytes: jsBytes,
    requestCount,
    timeToUsefulDataMs: usefulDataMs,
  };

  await context.close();
  return result;
}

async function screenshotWaterfallHar(browser, name) {
  const harPath = path.join(SCREENSHOTS_DIR, `${name}-waterfall.har`);
  const context = await browser.newContext({ recordHar: { path: harPath, content: "embed" }, locale: "pt-BR", timezoneId: "UTC" });
  const page = await context.newPage();
  await setupJourney(page, name);
  const journey = JOURNEYS[name];
  await page.goto(`${BASE_URL}${journey.path}`, { waitUntil: "networkidle" });
  await journey.steps(page);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.screenshot({ path: path.join(SCREENSHOTS_DIR, `${name}-screenshot.png`), fullPage: true });
  await context.close();
  console.log(`  saved ${harPath} + screenshot`);
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function main() {
  const browser = await chromium.launch();
  const allResults = [];

  const runs = 3;
  for (const name of Object.keys(JOURNEYS)) {
    console.log(`Measuring ${name} (${runs} runs, unthrottled)...`);
    const samples = [];
    for (let i = 0; i < runs; i++) {
      samples.push(await measureJourney(browser, name, { throttle: false }));
    }
    const agg = {
      journey: name,
      throttled: false,
      runs: samples.length,
      ttfbMs: median(samples.map((s) => s.ttfbMs).filter((v) => v != null)),
      dclMs: median(samples.map((s) => s.dclMs).filter((v) => v != null)),
      loadMs: median(samples.map((s) => s.loadMs).filter((v) => v != null)),
      lcpMs: median(samples.map((s) => s.lcpMs).filter((v) => v != null)),
      clsScore: median(samples.map((s) => s.clsScore).filter((v) => v != null)),
      jsTransferredBytes: Math.round(median(samples.map((s) => s.jsTransferredBytes))),
      requestCount: Math.round(median(samples.map((s) => s.requestCount))),
      timeToUsefulDataMs: median(samples.map((s) => s.timeToUsefulDataMs).filter((v) => v != null)),
      raw: samples,
    };
    allResults.push(agg);
  }

  console.log("Measuring J01, J04 with Fast-4G + CPU throttling...");
  for (const name of ["J01", "J04"]) {
    const throttled = await measureJourney(browser, name, { throttle: true });
    allResults.push({ ...throttled, runs: 1 });
  }

  console.log("Capturing HAR waterfalls for J01, J04, J06...");
  for (const name of ["J01", "J04", "J06"]) {
    await screenshotWaterfallHar(browser, name);
  }

  await browser.close();

  const outPath = path.resolve(__dirname, "perf-03-results.json");
  writeFileSync(outPath, JSON.stringify(allResults, null, 2));
  console.log(`\nResults written to ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
