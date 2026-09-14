// PERF-11-b Scenario D (multi-tenant) — same realistic weighted mix as PERF-11's
// scenario-d-mixed.js (40% Overview / 25% Items / 20% Subjects / 10% Documents-substitute / 5%
// Reports), but each VU uses its own tenant's session + itemId (round-robin over the N tenants
// provisioned by perf-11b-multi-tenant-setup.mjs), instead of every VU hammering the single
// PERF-11 tenant. This is what lets aggregate throughput exceed one tenant's 100 req/60s
// API_REQUEST quota (src/modules/identity/application/quota.ts).
import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL, tenantForVu, commonParamsForVu } from "./lib/config-multi-tenant.js";

export const options = {
  vus: Number(__ENV.VUS) || 1,
  duration: __ENV.DURATION || "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  const tenant = tenantForVu(__VU);
  const draw = Math.random();
  let name, res;
  if (draw <= 0.4) {
    name = "mixed_overview";
    res = http.get(`${BASE_URL}/bff/api/items/dashboard`, commonParamsForVu(name, __VU));
  } else if (draw <= 0.65) {
    name = "mixed_items";
    res = http.get(`${BASE_URL}/bff/api/items/${tenant.itemId}`, commonParamsForVu(name, __VU));
  } else if (draw <= 0.85) {
    name = "mixed_subjects";
    res = http.get(`${BASE_URL}/bff/api/subjects/dashboard`, commonParamsForVu(name, __VU));
  } else if (draw <= 0.95) {
    name = "mixed_documents_substitute";
    res = http.get(`${BASE_URL}/bff/api/items/${tenant.itemId}`, commonParamsForVu(name, __VU));
  } else {
    name = "mixed_reports";
    res = http.get(`${BASE_URL}/bff/api/reports/expiring-soon-items`, commonParamsForVu(name, __VU));
  }
  check(res, { "status is 200": (r) => r.status === 200 });
  sleep(1);
}
