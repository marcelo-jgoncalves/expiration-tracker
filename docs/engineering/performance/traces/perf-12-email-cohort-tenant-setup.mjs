// PERF-12 (D-301/D-302 10k revalidation): provision 10 synthetic tenants whose OWN Cognito
// email is an AWS SES mailbox simulator address, so that GlobalUser.emailNormalized - set only
// once, at first-login bootstrap (src/modules/identity/application/bootstrap-identity.ts) and
// never updatable afterwards - resolves reminder-dispatch notification recipients to controlled,
// safe addresses instead of a real inbox. Reassigning EXISTING tenants' recipients was considered
// and rejected: it would need either (a) mutating GlobalUser.emailNormalized directly via
// DynamoDB, bypassing the app's own invariants (AGENTS.md #7 forbids raw UpdateItem for mutable
// writes), or (b) inviting a new member into an existing org, which requires reading the
// invitation-acceptance email - impossible for a simulator address that has no real inbox to read
// from. A brand-new tenant's founder never goes through the invite flow, so this is the only path
// that stays within the product's real invariants.
//
// Cohort: 7 success@ (bulk of the 10k structural volume, always "delivered"), 1 bounce@,
// 1 complaint@, 1 suppressionlist@ (classification coverage) - all using +label subaddressing,
// which AWS's official docs confirm the mailbox simulator honors (strips the label before
// matching the base local part).
//
// Users were created out-of-band via `aws cognito-idp admin-create-user` (MessageAction=SUPPRESS,
// email_verified=true) + `admin-set-user-password --permanent` - no real inbox ever needs to
// receive anything, mirroring exactly how perf-11b-multi-tenant-setup.mjs provisioned its own 10
// Gmail-based users.
//
// Usage:
//   node docs/engineering/performance/traces/perf-12-email-cohort-tenant-setup.mjs
//
// Output:
//   docs/engineering/performance/.local/perf-12-email-tenants.json (gitignored)

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(
  pathToFileURL(path.resolve(__dirname, "../../../../frontend/node_modules/playwright/index.mjs")).href
);

const OUT_DIR = path.resolve(__dirname, "../.local");
const MANIFEST_PATH = path.resolve(OUT_DIR, "perf-12-email-tenants.json");
const APP_ORIGIN = "https://d1mbs2t047qo9d.cloudfront.net";

const CREDS_PATH = path.resolve(OUT_DIR, "perf-11b-loadtest-users-credentials.txt");
function sharedPassword() {
  const text = readFileSync(CREDS_PATH, "utf-8");
  const m = text.match(/^password=(.*)$/m);
  if (!m) throw new Error("Shared password not found in " + CREDS_PATH);
  return m[1].trim();
}

const EMAILS = [
  "success+d302-10k-01@simulator.amazonses.com",
  "success+d302-10k-02@simulator.amazonses.com",
  "success+d302-10k-03@simulator.amazonses.com",
  "success+d302-10k-04@simulator.amazonses.com",
  "success+d302-10k-05@simulator.amazonses.com",
  "success+d302-10k-06@simulator.amazonses.com",
  "success+d302-10k-07@simulator.amazonses.com",
  "bounce+d302-10k-08@simulator.amazonses.com",
  "complaint+d302-10k-09@simulator.amazonses.com",
  "suppressionlist+d302-10k-10@simulator.amazonses.com",
];

async function login(browser, email, password) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${APP_ORIGIN}/bff/login?returnTo=/`, { waitUntil: "networkidle" });
  await page.locator("#signInFormUsername:visible").fill(email);
  await page.locator("#signInFormPassword:visible").fill(password);
  await page.locator("input[name='signInSubmitButton']:visible").click();
  await page.waitForURL((url) => url.origin === APP_ORIGIN && !url.pathname.startsWith("/bff/"), { timeout: 20000 });
  const cookies = await context.cookies(APP_ORIGIN);
  const sessionCookie = cookies.find((c) => c.name === "__Host-et_session");
  const csrfCookie = cookies.find((c) => c.name === "__Host-et_csrf");
  if (!sessionCookie) throw new Error("No session cookie after login for " + email + ": " + cookies.map((c) => c.name).join(","));
  return { context, page, csrfToken: csrfCookie ? csrfCookie.value : null };
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
      try { json = JSON.parse(text); } catch { json = { raw: text }; }
      return { status: res.status, json };
    },
    { urlPath, body, csrfToken, origin: APP_ORIGIN },
  );
}

async function main() {
  const password = sharedPassword();
  const browser = await chromium.launch();
  const tenants = [];
  try {
    for (let i = 0; i < EMAILS.length; i++) {
      const index = i + 1;
      const email = EMAILS[i];
      const label = `PERF D302-10k EmailCohort ${String(index).padStart(2, "0")}`;
      console.log(`[${index}/10] logging in as ${email}...`);
      const { context, page, csrfToken } = await login(browser, email, password);

      console.log(`[${index}/10] creating organization...`);
      const createRes = await apiPost(page, "/bff/organizations", { displayName: label, timezone: "America/Sao_Paulo" }, csrfToken);
      if (createRes.status !== 201) throw new Error(`createOrganization failed for tenant ${index}: ${JSON.stringify(createRes)}`);
      const organizationId = createRes.json.organizationId;

      console.log(`[${index}/10] seeding one placeholder item (authenticate() needs it to exist)...`);
      const itemRes = await apiPost(
        page,
        "/bff/api/items",
        { name: `PERF D302-10k EmailCohort ${index}`, category: "Licenca", dueDate: "2026-12-01T00:00:00.000Z" },
        csrfToken,
      );
      if (itemRes.status !== 201) throw new Error(`create item failed tenant ${index}: ${JSON.stringify(itemRes)}`);
      const itemId = itemRes.json.item?.itemId ?? itemRes.json.itemId;

      tenants.push({ index, label, organizationId, itemId, email });
      await context.close();
      console.log(`[${index}/10] done: org=${organizationId} item=${itemId} email=${email}`);
    }
  } finally {
    await browser.close();
  }

  writeFileSync(MANIFEST_PATH, JSON.stringify({ N: 10, createdAt: new Date().toISOString(), cohort: "d302-10k-email-simulator", tenants }, null, 2));
  console.log(`\nDone. Manifest: ${MANIFEST_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
