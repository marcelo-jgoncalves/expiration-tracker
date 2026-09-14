// PERF-11-b: provision N synthetic load-test tenants, one Cognito user + one organization each.
//
// Originally attempted the cheaper "1 Cognito user, N organizations, switch active org via
// POST /bff/organization/select" approach (confirmed that endpoint exists in
// src/modules/bff/http/bff-handlers.ts, Wave B2B-6/D-101) - but live-verified that
// POST /bff/organizations returns 409 CONFLICT ("You have already created an organization.") on
// the second call for the same user, i.e. this product enforces **1 organization per user**
// (CreateOrganizationService). So N tenants require N Cognito users. Mitigation used: all N users
// were created via `aws cognito-idp admin-create-user` + `admin-set-user-password --permanent`
// (see docs/engineering/performance/.local/perf-11b-loadtest-users-credentials.txt, gitignored) -
// this is still far cheaper than N manual signups/email confirmations, just not as cheap as the
// single-user approach this script originally targeted.
//
// Usage:
//   node docs/engineering/performance/traces/perf-11b-multi-tenant-setup.mjs [N]
//
// Output per tenant i (1..N):
//   docs/engineering/performance/.local/perf-11b-session-{i}.json   (cookies + org id, gitignored)
// Plus a manifest:
//   docs/engineering/performance/.local/perf-11b-tenants.json       (gitignored)

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(
  pathToFileURL(path.resolve(__dirname, "../../../../frontend/node_modules/playwright/index.mjs")).href
);

const CREDS_PATH = path.resolve(__dirname, "../.local/perf-11b-loadtest-users-credentials.txt");
const OUT_DIR = path.resolve(__dirname, "../.local");
const MANIFEST_PATH = path.resolve(OUT_DIR, "perf-11b-tenants.json");
const APP_ORIGIN = "https://d1mbs2t047qo9d.cloudfront.net";

const N = Number(process.argv[2]) || 10;

function parseCreds(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function tenantEmail(creds, i) {
  return `${creds.email_prefix}${String(i).padStart(2, "0")}@gmail.com`;
}

async function login(browser, creds) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${APP_ORIGIN}/bff/login?returnTo=/`, { waitUntil: "networkidle" });
  const usernameField = page.locator("#signInFormUsername:visible");
  await usernameField.waitFor({ state: "visible", timeout: 20000 });
  await usernameField.fill(creds.email);
  await page.locator("#signInFormPassword:visible").fill(creds.password);
  await page.locator("input[name='signInSubmitButton']:visible").click();
  await page.waitForURL((url) => url.origin === APP_ORIGIN && !url.pathname.startsWith("/bff/"), { timeout: 20000 });
  const cookies = await context.cookies(APP_ORIGIN);
  const sessionCookie = cookies.find((c) => c.name === "__Host-et_session");
  const csrfCookie = cookies.find((c) => c.name === "__Host-et_csrf");
  if (!sessionCookie) throw new Error("No session cookie after login: " + cookies.map((c) => c.name).join(","));
  return {
    context,
    page,
    cookieHeader: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    csrfToken: csrfCookie ? csrfCookie.value : null,
  };
}

async function apiPost(page, urlPath, body, csrfToken) {
  return page.evaluate(
    async ({ urlPath, body, csrfToken, origin }) => {
      const res = await fetch(origin + urlPath, {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify(body),
        credentials: "include",
      });
      const text = await res.text();
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
      return { status: res.status, json };
    },
    { urlPath, body, csrfToken, origin: APP_ORIGIN },
  );
}

async function main() {
  const creds = parseCreds(readFileSync(CREDS_PATH, "utf-8"));
  const browser = await chromium.launch();
  const tenants = [];

  for (let i = 1; i <= N; i++) {
    const label = `PERF LoadTest Tenant ${String(i).padStart(2, "0")}`;
    const tenantCreds = { email: tenantEmail(creds, i), password: creds.password };
    console.log(`[${i}/${N}] logging in as ${tenantCreds.email} for tenant "${label}"...`);
    const { context, page, cookieHeader, csrfToken } = await login(browser, tenantCreds);

    console.log(`[${i}/${N}] creating organization...`);
    const createRes = await apiPost(page, "/bff/organizations", { displayName: label, timezone: "America/Sao_Paulo" }, csrfToken);
    if (createRes.status !== 201) throw new Error(`createOrganization failed for tenant ${i}: ${JSON.stringify(createRes)}`);
    const organizationId = createRes.json.organizationId;

    // Seed minimal data - same small scale as the PERF-04/PERF-11 single tenant (a handful of
    // records; this test is about request throughput, not data volume).
    console.log(`[${i}/${N}] seeding items/subjects...`);
    let itemId = null;
    for (let n = 1; n <= 3; n++) {
      const r = await apiPost(
        page,
        "/bff/api/items",
        { name: `PERF LoadTest Item ${i}-${n}`, category: "Licenca", dueDate: "2026-12-01T00:00:00.000Z" },
        csrfToken,
      );
      if (r.status !== 201) throw new Error(`create item failed tenant ${i}: ${JSON.stringify(r)}`);
      if (n === 1) itemId = r.json.item?.itemId ?? r.json.itemId;
    }
    let subjectId;
    {
      const r = await apiPost(page, "/bff/api/subjects", { type: "VENDOR", displayName: `PERF LoadTest Vendor ${i}` }, csrfToken);
      if (r.status !== 201) throw new Error(`create subject failed tenant ${i}: ${JSON.stringify(r)}`);
      subjectId = r.json.subject?.subjectId ?? r.json.subjectId;
    }

    const outPath = path.resolve(OUT_DIR, `perf-11b-session-${i}.json`);
    const record = {
      index: i,
      label,
      organizationId,
      cookieHeader,
      itemId,
      subjectId,
      obtainedAt: new Date().toISOString(),
    };
    writeFileSync(outPath, JSON.stringify(record, null, 2));
    tenants.push({ index: i, label, organizationId, itemId, subjectId, cookieFile: `perf-11b-session-${i}.json` });

    await context.close();
    console.log(`[${i}/${N}] done: org=${organizationId} item=${itemId} subject=${subjectId}`);
  }

  writeFileSync(MANIFEST_PATH, JSON.stringify({ N, createdAt: new Date().toISOString(), tenants }, null, 2));
  await browser.close();
  console.log(`\nDone. Manifest: ${MANIFEST_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
