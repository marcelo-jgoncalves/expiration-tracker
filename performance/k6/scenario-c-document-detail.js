// PERF-11 Scenario C — Document detail.
//
// SUBSTITUTION NOTE (do not remove - read before "fixing" this to hit document-archive):
// The plan spec's literal target is the Document Detail screen
// (frontend/src/routes/DocumentDetail.tsx), which calls
// GET /bff/api/document-archive/documents/{documentId} and
// .../documents/{documentId}/versions. The PERF test tenant (org_01M2GE4F1SZPSJ47HCGRXH4XMN) has
// never had a document uploaded through it - GET /bff/api/document-archive/requirements/{subjectId}
// returns `{"requirements":[]}` and there is no real documentId to call with. Creating one would
// require a mutation (POST /document-archive/documents + upload/commit flow), which is out of
// scope here (PERF-11 is read-only load testing, no tenant-state changes). The document-archive
// IAM gap from earlier work (docs/engineering/performance/results/CICLO-A-analise.md) does appear
// fixed - GET /bff/api/document-archive/storage-usage returns 200 live - but that doesn't produce
// a documentId to test against either.
//
// Substitute used instead: GET /bff/api/items/{itemId}, the Item Detail screen - the closest
// real "single-entity detail page" route with actual seeded data in this tenant. Numbers here
// measure a comparable detail-page read (single item lookup by ID), not the document-archive
// Lambda specifically. See the PERF-11 result doc's methodology section for this caveat again.
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

export default function () {
  const res = http.get(`${BASE_URL}/bff/api/items/${ITEM_ID}`, commonParams("document_detail_substitute_item_detail"));
  check(res, { "status is 200": (r) => r.status === 200 });
  sleep(1);
}
