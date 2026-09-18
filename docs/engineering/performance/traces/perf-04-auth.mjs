// PERF-04: obtain a real BFF session (cookies) for the synthetic perf-test tenant user by
// driving the actual Cognito Hosted UI OAuth Authorization Code + PKCE flow headlessly via
// Playwright (the BFF has no direct password-grant endpoint - `handleCallback` only accepts a
// real `code` minted by Cognito's Hosted UI, see src/modules/bff/application/bff-auth-service.ts).
//
// Usage:
//   node docs/engineering/performance/traces/perf-04-auth.mjs
//
// Reads credentials from docs/engineering/performance/.local/perf-test-tenant-credentials.txt
// (gitignored - never commit). Prints the resulting cookies as JSON to stdout so they can be
// piped into curl/fetch-based follow-up scripts. Also writes them to
// docs/engineering/performance/.local/perf-04-session-cookies.json (gitignored) for reuse across
// multiple runs without re-authenticating (BFF session TTL is well beyond a single work session).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// This script lives under docs/engineering/performance/traces, outside the frontend/ package
// tree, so bare-specifier resolution for "playwright" fails from here - load it directly from
// frontend/node_modules instead (the only place it's installed in this repo).
const { chromium } = await import(
  pathToFileURL(path.resolve(__dirname, "../../../../frontend/node_modules/playwright/index.mjs")).href
);
const CREDS_PATH = path.resolve(__dirname, "../.local/perf-test-tenant-credentials.txt");
const OUT_PATH = path.resolve(__dirname, "../.local/perf-04-session-cookies.json");
const APP_ORIGIN = "https://d1mbs2t047qo9d.cloudfront.net";

function parseCreds(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

async function main() {
  const creds = process.env.PERF_TEST_EMAIL && process.env.PERF_TEST_PASSWORD
    ? { email: process.env.PERF_TEST_EMAIL, password: process.env.PERF_TEST_PASSWORD }
    : parseCreds(readFileSync(CREDS_PATH, "utf-8"));
  if (!creds.email || !creds.password) {
    throw new Error("Could not parse email/password from credentials file: " + CREDS_PATH);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // Step 1: hit /bff/login, which 302s to the Cognito Hosted UI authorize URL and sets the
  // opaque login cookie (LoginAttempt pointer) that handleCallback() will validate against.
  await page.goto(`${APP_ORIGIN}/bff/login?returnTo=/`, { waitUntil: "networkidle" });

  // Step 2: fill the Hosted UI login form. Cognito's default Hosted UI form field names.
  // The page renders two matching #signInFormUsername elements (a hidden duplicate form
  // markup); `:visible` picks the one actually rendered on screen.
  const usernameField = page.locator("#signInFormUsername:visible");
  await usernameField.waitFor({ state: "visible", timeout: 20000 });
  await usernameField.fill(creds.email);
  await page.locator("#signInFormPassword:visible").fill(creds.password);
  await page.locator("input[name='signInSubmitButton']:visible").click();

  // Step 3: Hosted UI redirects back to /bff/callback?code=...&state=..., which the BFF
  // exchanges server-side and 302s to APP_ORIGIN + returnTo, setting session/csrf cookies.
  await page.waitForURL((url) => url.origin === APP_ORIGIN && !url.pathname.startsWith("/bff/"), { timeout: 20000 });

  const cookies = await context.cookies(APP_ORIGIN);
  // Exact names from src/modules/bff/domain/cookies.ts (__Host- prefixed, so must be sent from
  // a secure, path=/ context - a plain `curl -b` header reconstruction works fine here since we
  // only need the value, not the browser-enforced cookie-jar semantics).
  const sessionCookie = cookies.find((c) => c.name === "__Host-et_session");
  const csrfCookie = cookies.find((c) => c.name === "__Host-et_csrf");

  if (!sessionCookie) {
    console.error("All cookies seen:", cookies.map((c) => c.name));
    throw new Error("Did not find a session cookie after login - check cookie name constants in src/modules/bff/domain/cookies.ts");
  }

  const result = {
    cookieHeader: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
    sessionCookieName: sessionCookie.name,
    csrfCookieName: csrfCookie ? csrfCookie.name : null,
    csrfTokenValue: csrfCookie ? csrfCookie.value : null,
    obtainedAt: new Date().toISOString(),
  };

  mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));
  console.log(`[perf-auth] BFF session obtained at ${result.obtainedAt}`);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
