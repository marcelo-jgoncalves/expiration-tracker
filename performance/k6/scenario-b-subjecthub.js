// PERF-11 Scenario B — tela composta: SubjectHub.
//
// SubjectHub (frontend/src/routes/SubjectHub.tsx) is the fan-out-heaviest screen in the app per
// PERF-07 (docs/engineering/performance/results/PERF-07-fan-out.md): it loads the subject
// itself plus its requirements/compliance data in parallel. We reproduce the two calls that hit
// real, populated data for this tenant (GET /bff/api/subjects/{subjectId} for the subject header,
// and GET /bff/api/subjects/dashboard as the list the hub is reached from) issued back-to-back
// per iteration, the same way the browser fires them in parallel on mount.
//
// Usage: same pattern as scenario-a-overview.js - run one VU stage at a time.
//   k6 run --vus 1 --duration 30s performance/k6/scenario-b-subjecthub.js
import http from "k6/http";
import { check, sleep } from "k6";
import { BASE_URL, SUBJECT_ID, commonParams } from "./lib/config.js";

export const options = {
  vus: Number(__ENV.VUS) || 1,
  duration: __ENV.DURATION || "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
  },
};

export default function () {
  // http.batch fires both requests concurrently, matching how the SPA actually loads this
  // screen (parallel fan-out per PERF-07, not a sequential waterfall).
  const responses = http.batch([
    ["GET", `${BASE_URL}/bff/api/subjects/dashboard`, null, commonParams("subjecthub_subjects_dashboard")],
    ["GET", `${BASE_URL}/bff/api/subjects/${SUBJECT_ID}`, null, commonParams("subjecthub_subject_detail")],
  ]);
  for (const res of responses) {
    check(res, { "status is 200": (r) => r.status === 200 });
  }
  sleep(1);
}
