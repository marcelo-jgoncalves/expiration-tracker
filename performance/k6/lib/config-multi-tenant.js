// PERF-11-b: shared config for the multi-tenant variant of the PERF-11 k6 harness.
//
// Loads the manifest + per-tenant session cookies written by
// docs/engineering/performance/traces/perf-11b-multi-tenant-setup.mjs (10 synthetic tenants,
// "PERF LoadTest Tenant 01".."10", one Cognito user + one org + a handful of seeded items/
// subjects each - see that script's header comment for why N separate Cognito users were needed
// instead of switching organizations under one user).
//
// Each VU picks its tenant as `(__VU - 1) % N`, so VUs are spread round-robin across all N
// tenants and no single tenant's per-tenant API_REQUEST quota (100 req/60s,
// src/modules/identity/application/quota.ts) absorbs more than its 1/N share of the offered
// load.
const manifest = JSON.parse(
  open("../../../docs/engineering/performance/.local/perf-11b-tenants.json"),
);

export const BASE_URL = "https://d1mbs2t047qo9d.cloudfront.net";
export const TENANT_COUNT = manifest.N;

// k6's `open()` only works at init time and only with literal-ish paths it can statically see in
// simple cases; safest is to eagerly open every known cookie file (N is small and fixed) rather
// than try a dynamic path per VU.
const sessions = manifest.tenants.map((t) =>
  JSON.parse(open(`../../../docs/engineering/performance/.local/${t.cookieFile}`)),
);

export function tenantForVu(vuId) {
  const idx = (vuId - 1) % TENANT_COUNT;
  return sessions[idx];
}

export function commonParamsForVu(name, vuId) {
  const tenant = tenantForVu(vuId);
  return {
    headers: { Cookie: tenant.cookieHeader },
    tags: { name },
  };
}
