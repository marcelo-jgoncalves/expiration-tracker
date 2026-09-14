// PERF-11 Scenario A — leitura simples: Overview dashboard.
//
// Hits the single endpoint the Overview screen (frontend/src/routes/Overview.tsx) loads on
// mount: GET /bff/api/items/dashboard.
//
// Usage (run one ramp stage at a time - see docs/engineering/performance/results/PERF-11-load-testing.md
// for why we don't just declare a `stages` array and let k6 run the whole ramp unattended: each
// stage needs a CloudWatch check before deciding whether to proceed):
//
//   k6 run --vus 1 --duration 30s performance/k6/scenario-a-overview.js
//   k6 run --vus 5 --duration 30s performance/k6/scenario-a-overview.js
//   ... etc through 100 VU, per the plan's ramp (1/5/10/25/50/100 VU)
//
// VUS/DURATION can also be read from env if preferred: k6 run -e VUS=10 -e DURATION=30s ...
// (the --vus/--duration CLI flags above take precedence when both are given).
import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL, commonParams } from "./lib/config.js";

export const options = {
  // Default local dev/no-arg run: light smoke so `k6 run scenario-a-overview.js` with no flags
  // doesn't accidentally fire 100 VUs. The real ramp always passes --vus/--duration explicitly.
  vus: Number(__ENV.VUS) || 1,
  duration: __ENV.DURATION || "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"], // error rate > 1% is a PERF-11 stop condition
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/bff/api/items/dashboard`, commonParams("overview_dashboard"));
  check(res, {
    "status is 200": (r) => r.status === 200,
    "has items array": (r) => {
      try {
        return Array.isArray(JSON.parse(r.body).items);
      } catch {
        return false;
      }
    },
  });
  sleep(1); // ~1 req/s/VU, roughly matching a user glancing at a dashboard, not a hot loop
}
