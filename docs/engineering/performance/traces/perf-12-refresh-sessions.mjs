// PERF-12 10k slice: refresh BFF sessions for the 10 existing PERF-11-b synthetic tenants
// (their cookies from ~22:18 UTC expired by the time seeding started ~23:5x UTC). Re-uses the
// same Cognito users/orgs - does NOT create new organizations, just re-authenticates and
// overwrites docs/engineering/performance/.local/perf-11b-session-{i}.json with fresh cookies.
//
// Usage: node docs/engineering/performance/traces/perf-12-refresh-sessions.mjs

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

function parseCreds(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
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
  await context.close();
  return {
    cookieHeader: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    csrfToken: csrfCookie ? csrfCookie.value : null,
  };
}

async function main() {
  const creds = parseCreds(readFileSync(CREDS_PATH, "utf-8"));
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  const browser = await chromium.launch();

  // Do logins with limited concurrency (5 at a time) to keep Playwright/Cognito stable.
  const CONCURRENCY = 5;
  const tenants = manifest.tenants;
  let idx = 0;
  async function worker() {
    while (idx < tenants.length) {
      const t = tenants[idx++];
      const email = `${creds.email_prefix}${String(t.index).padStart(2, "0")}@gmail.com`;
      console.log(`[${t.index}] logging in as ${email}...`);
      const { cookieHeader, csrfToken } = await login(browser, { email, password: creds.password });
      const outPath = path.resolve(OUT_DIR, t.cookieFile);
      const record = {
        index: t.index,
        label: t.label,
        organizationId: t.organizationId,
        cookieHeader,
        csrfTokenValue: csrfToken,
        itemId: t.itemId,
        subjectId: t.subjectId,
        obtainedAt: new Date().toISOString(),
      };
      writeFileSync(outPath, JSON.stringify(record, null, 2));
      console.log(`[${t.index}] refreshed -> ${outPath}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await browser.close();
  console.log("All sessions refreshed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
