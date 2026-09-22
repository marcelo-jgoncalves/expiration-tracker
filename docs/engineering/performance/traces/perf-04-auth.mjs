// PERF-04: obtain a real BFF session (cookies) for the synthetic perf-test tenant user.
//
// D-322 (2026-09-22): rewritten to call `POST /bff/login` (direct-auth entry point added by
// D-321) with a plain `fetch`, instead of driving a headless browser through the Cognito
// Hosted UI form (`#signInFormUsername` et al.). That selector-based flow broke the moment
// D-321 stopped being the app's primary login path - and turned out to be fragile even for the
// dormant `GET /bff/login` fallback itself, because Cognito's real `ManagedLoginVersion` stayed
// at 2 in the AWS account (a `managed_login_version` argument removed from Terraform config
// does not force a downgrade of an already-live domain - optional+computed, D-320/D-321 never
// actually reverted it in practice), which renders different markup than the classic Hosted UI
// this script's old selectors assumed. The direct-auth endpoint sidesteps all of that: it's the
// same JSON contract the app's own `/login` screen uses, no browser needed at all.
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
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDS_PATH = path.resolve(__dirname, "../.local/perf-test-tenant-credentials.txt");
const OUT_PATH = path.resolve(__dirname, "../.local/perf-04-session-cookies.json");
const APP_ORIGIN = "https://d1mbs2t047qo9d.cloudfront.net";
// This script runs via plain `node` (no ts-node/tsx, no build step first - ci.yml calls it
// directly), so the real constants in src/modules/bff/domain/cookies.ts can't be imported here;
// kept as literals in sync with that file, same convention the old Playwright-based version of
// this script already used.
const SESSION_COOKIE_NAME = "__Host-et_session";
const CSRF_COOKIE_NAME = "__Host-et_csrf";

function parseCreds(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/** Splits a `Set-Cookie` value list into `{name, value}` pairs, keeping only the cookie's own
 * first `name=value` segment (drops `Path=`/`Secure`/`HttpOnly`/... attributes) - `getSetCookie()`
 * already separates multiple headers, this just parses each one's leading pair. */
function parseSetCookiePairs(setCookieValues) {
  return setCookieValues.map((raw) => {
    const firstSegment = raw.split(";")[0] ?? "";
    const eq = firstSegment.indexOf("=");
    return { name: firstSegment.slice(0, eq).trim(), value: firstSegment.slice(eq + 1).trim() };
  });
}

async function main() {
  const creds = process.env.PERF_TEST_EMAIL && process.env.PERF_TEST_PASSWORD
    ? { email: process.env.PERF_TEST_EMAIL, password: process.env.PERF_TEST_PASSWORD }
    : parseCreds(readFileSync(CREDS_PATH, "utf-8"));
  if (!creds.email || !creds.password) {
    throw new Error("Could not parse email/password from credentials file: " + CREDS_PATH);
  }

  const response = await fetch(`${APP_ORIGIN}/bff/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
  });

  if (!response.ok) {
    throw new Error(`POST /bff/login failed: ${response.status} ${await response.text()}`);
  }

  const cookies = parseSetCookiePairs(response.headers.getSetCookie());
  const sessionCookie = cookies.find((c) => c.name === SESSION_COOKIE_NAME);
  const csrfCookie = cookies.find((c) => c.name === CSRF_COOKIE_NAME);

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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
