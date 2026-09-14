// PERF-11 Scenario D — mistura realista.
//
// Weighted mix per the plan spec (section 16.2):
//   40% Overview   -> GET /bff/api/items/dashboard
//   25% Items      -> GET /bff/api/items/{itemId}          (item detail read)
//   20% Subjects   -> GET /bff/api/subjects/dashboard
//   10% Documents  -> GET /bff/api/items/{itemId}           (see scenario-c substitution note -
//                      no real document exists in this tenant, so "Documents" reuses the same
//                      item-detail substitute as Scenario C)
//    5% Reports    -> GET /bff/api/reports/expiring-soon-items (verified live 200, CSV body -
//                      the JSON.parse-vs-CSV bug noted in CICLO-A-analise.md is fixed)
//
// Each VU picks one weighted route per iteration (not all 5 per iteration) so the resulting
// traffic mix approximates the target percentages over the run, the way real mixed user traffic
// would, rather than every VU hammering all 5 endpoints every second.
import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL, ITEM_ID, commonParams } from "./lib/config.js";

export const options = {
  vus: Number(__ENV.VUS) || 1,
  duration: __ENV.DURATION || "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
  },
};

// Cumulative thresholds over a 0..1 draw, matching the 40/25/20/10/5 split.
const ROUTES = [
  { upTo: 0.4, name: "mixed_overview", request: () => http.get(`${BASE_URL}/bff/api/items/dashboard`, commonParams("mixed_overview")) },
  { upTo: 0.65, name: "mixed_items", request: () => http.get(`${BASE_URL}/bff/api/items/${ITEM_ID}`, commonParams("mixed_items")) },
  { upTo: 0.85, name: "mixed_subjects", request: () => http.get(`${BASE_URL}/bff/api/subjects/dashboard`, commonParams("mixed_subjects")) },
  { upTo: 0.95, name: "mixed_documents_substitute", request: () => http.get(`${BASE_URL}/bff/api/items/${ITEM_ID}`, commonParams("mixed_documents_substitute")) },
  { upTo: 1.0, name: "mixed_reports", request: () => http.get(`${BASE_URL}/bff/api/reports/expiring-soon-items`, commonParams("mixed_reports")) },
];

export default function () {
  const draw = Math.random();
  const route = ROUTES.find((r) => draw <= r.upTo);
  const res = route.request();
  check(res, { "status is 200": (r) => r.status === 200 });
  sleep(1);
}
