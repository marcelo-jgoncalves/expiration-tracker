// Shared config/helpers for PERF-11 k6 load tests.
//
// All scenarios hit the real `dev` CloudFront distribution (no mock, no local server) using a
// real, already-authenticated BFF session for the synthetic "PERF Test Tenant"
// (org_01M2GE4F1SZPSJ47HCGRXH4XMN, see docs/engineering/performance/baseline/PERF-04-test-tenant.md).
//
// The session cookie is obtained by docs/engineering/performance/traces/perf-04-auth.mjs (drives
// the real Cognito Hosted UI OAuth flow headlessly via Playwright) and cached to
// docs/engineering/performance/.local/perf-04-session-cookies.json (gitignored - never commit
// that file's contents). Re-run that script if this open() call fails (file missing) or if k6
// requests start coming back 401 (session expired/revoked) - the BFF session TTL is long but not
// infinite.
//
// k6's `open()` only works at init time (not inside VU code) and resolves paths relative to the
// file that calls it, so this must run at module scope, not inside a function.
const sessionData = JSON.parse(
  open("../../../docs/engineering/performance/.local/perf-04-session-cookies.json"),
);

export const BASE_URL = "https://d1mbs2t047qo9d.cloudfront.net";

// All 4 scenarios are read-only (GET) dashboard/detail views - the BFF's CSRF check only guards
// state-changing requests (POST/PUT/PATCH/DELETE go through `verifyCsrf` in
// src/modules/bff/domain/bff-request.ts), so only the session cookie is needed here, not the
// CSRF token/header. Confirmed live: all 4 real routes below return 200 with just the session
// cookie (see PERF-11 result doc for the curl checks run before writing these scripts).
export const AUTH_HEADERS = {
  Cookie: sessionData.cookieHeader,
};

// Real IDs seeded in the PERF test tenant (see baseline/PERF-04-test-tenant.md). The tenant has
// 7 Items and 2 Subjects - deliberately small, see the "small dataset" caveat in the PERF-11
// result doc. These are read-only lookups; nothing here mutates tenant state.
export const ITEM_ID = "item_01M2GE5JZQ9F62S4AEAN1ZC7FR";
export const SUBJECT_ID = "subject_01M2GE65D5XGV7CXQ6ECB9YYAD";

// Standard k6 tags/checks applied to every request so results are comparable across scenarios.
export function commonParams(name) {
  return {
    headers: AUTH_HEADERS,
    tags: { name },
  };
}
