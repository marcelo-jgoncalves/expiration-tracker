/**
 * W2-07 load test drill (docs/engineering/pilot-readiness-program.md, Wave 2) - one-off
 * script, not part of the app. Generates real concurrent traffic against two real Lambdas
 * in `dev`:
 *
 *  - `exptrk-dev-test-ping-handler` (harmless, no domain data touched) at the Stage 3 API
 *    peak rate from docs/architecture/capacity-model.md (~12 req/s), compressed into a
 *    shorter real window than the model's 20-30min suggestion (practical constraint of an
 *    interactive drill session, not a scope reduction of the request volume itself).
 *  - `exptrk-dev-textract-task-handler` (`START_OCR` operation) at ~1/min, the AI/OCR peak,
 *    against a real tiny image already uploaded to the clean bucket in a prior drill
 *    (reused here - Textract's own idempotency via clientRequestToken means a distinct
 *    documentId/runId per call always produces a fresh, real Textract job even reading the
 *    same S3 object).
 *
 * Requires AI_EXTRACTION/OCR AppConfig kill switch already ON (the caller flips it before
 * running this, and flips it back off after - this script never touches AppConfig itself).
 *
 * Records latency (p50/p95/p99), error count, and throttling (ProvisionedConcurrency/
 * TooManyRequestsException) per target.
 */
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const client = new LambdaClient({ region: "us-east-1" });

const PING_FUNCTION = "exptrk-dev-test-ping-handler";
const TEXTRACT_FUNCTION = "exptrk-dev-textract-task-handler";
const CLEAN_BUCKET = "exptrk-dev-documents-clean";
const CLEAN_KEY = "tenant/w2-07-drill-tenant/item/w2-07-item/document/w2-07-doc/v1/w2-07-test.png";

const PING_TARGET_RPS = 12; // Stage 3 API peak, capacity-model.md
const PING_DURATION_SECONDS = 90; // compressed real window (practical constraint, see header)
const OCR_CALL_COUNT = 20; // ~ the Stage 3 "extractions/min" peak worth of real Textract calls
const OCR_INTERVAL_MS = 3000; // fired in a tight loop rather than spread over the full 20min window (same practical constraint)

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

// Bypasses the real API Gateway JWT authorizer (this invokes the Lambda directly) - fabricates
// the same claims shape a valid JWT authorizer context would carry, for ONE synthetic
// "cognito sub" reused across the whole run, so this also exercises the real first-login
// IdentityMapping/UserProfile provisioning path AND the real API_REQUEST quota enforcement
// (limit 100/60s per identity/quota.ts) under load - a 429 partway through is expected,
// real evidence of the quota gate holding under load, not a bug in this script.
const PING_SUB = "w2-07-load-test-sub";
function pingEvent() {
  const now = Math.floor(Date.now() / 1000);
  return {
    requestContext: {
      requestId: `w2-07-req-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      authorizer: { jwt: { claims: { sub: PING_SUB, jti: `w2-07-jti-${Date.now()}-${Math.random().toString(36).slice(2)}`, iat: String(now), exp: String(now + 3600) } } },
    },
  };
}

async function pingOnce() {
  const start = Date.now();
  try {
    const res = await client.send(new InvokeCommand({ FunctionName: PING_FUNCTION, Payload: Buffer.from(JSON.stringify(pingEvent())) }));
    const latencyMs = Date.now() - start;
    const failed = res.FunctionError !== undefined;
    let statusCode;
    if (!failed) {
      try {
        statusCode = JSON.parse(Buffer.from(res.Payload).toString("utf8")).statusCode;
      } catch {
        /* ignore parse failure */
      }
    }
    return { latencyMs, failed, throttled: false, statusCode };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const throttled = err?.name === "TooManyRequestsException";
    return { latencyMs, failed: true, throttled };
  }
}

async function runPingLoad() {
  console.log(`--- PING LOAD: ${PING_TARGET_RPS} req/s target for ${PING_DURATION_SECONDS}s ---`);
  const results = [];
  const endAt = Date.now() + PING_DURATION_SECONDS * 1000;
  const intervalMs = 1000 / PING_TARGET_RPS;
  const inFlight = [];

  while (Date.now() < endAt) {
    inFlight.push(pingOnce().then((r) => results.push(r)));
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  await Promise.all(inFlight);

  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const errors = results.filter((r) => r.failed).length;
  const throttled = results.filter((r) => r.throttled).length;
  const quotaExceeded = results.filter((r) => r.statusCode === 429).length;
  const ok = results.filter((r) => r.statusCode === 200).length;
  console.log(`PING total=${results.length} ok=${ok} quotaExceeded429=${quotaExceeded} errors=${errors} throttled=${throttled}`);
  console.log(`PING latency p50=${percentile(latencies, 50)}ms p95=${percentile(latencies, 95)}ms p99=${percentile(latencies, 99)}ms max=${latencies[latencies.length - 1]}ms`);
  return { total: results.length, errors, throttled };
}

async function startOcrOnce(i) {
  const runId = `w2-07-run-${i}`;
  const documentId = `w2-07-doc-${i}`;
  const event = {
    operation: "START_OCR",
    taskToken: `w2-07-drill-fake-token-${i}`,
    input: {
      tenantId: "w2-07-drill-tenant",
      itemId: "w2-07-item",
      documentId,
      documentVersion: 1,
      runId,
      pipelineVersion: "v1",
      cleanObject: { bucket: CLEAN_BUCKET, key: CLEAN_KEY, versionId: "" },
      fileName: "w2-07-test.png",
      contentType: "image/png",
    },
  };
  const start = Date.now();
  try {
    const res = await client.send(new InvokeCommand({ FunctionName: TEXTRACT_FUNCTION, Payload: Buffer.from(JSON.stringify(event)) }));
    const latencyMs = Date.now() - start;
    const failed = res.FunctionError !== undefined;
    let errorType;
    if (failed) {
      try {
        errorType = JSON.parse(Buffer.from(res.Payload).toString("utf8")).errorType;
      } catch {
        /* ignore parse failure */
      }
    }
    return { i, latencyMs, failed, errorType };
  } catch (err) {
    const latencyMs = Date.now() - start;
    return { i, latencyMs, failed: true, errorType: err?.name };
  }
}

async function runOcrLoad() {
  console.log(`--- OCR/TEXTRACT LOAD: ${OCR_CALL_COUNT} real START_OCR calls, ${OCR_INTERVAL_MS}ms apart ---`);
  const results = [];
  for (let i = 0; i < OCR_CALL_COUNT; i++) {
    const r = await startOcrOnce(i);
    results.push(r);
    console.log(`  [${i + 1}/${OCR_CALL_COUNT}] latency=${r.latencyMs}ms failed=${r.failed}${r.errorType ? ` errorType=${r.errorType}` : ""}`);
    if (i < OCR_CALL_COUNT - 1) await new Promise((r) => setTimeout(r, OCR_INTERVAL_MS));
  }
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const errors = results.filter((r) => r.failed).length;
  console.log(`OCR total=${results.length} errors=${errors}`);
  console.log(`OCR latency p50=${percentile(latencies, 50)}ms p95=${percentile(latencies, 95)}ms max=${latencies[latencies.length - 1]}ms`);
  return { total: results.length, errors };
}

const mode = process.argv[2] ?? "both"; // "ping" | "ocr" | "both" - lets a rerun (e.g. after fixing a bug) target only what actually needs rerunning, avoiding duplicate real Textract cost.
const pingSummary = mode !== "ocr" ? await runPingLoad() : undefined;
const ocrSummary = mode !== "ping" ? await runOcrLoad() : undefined;
console.log("\n=== SUMMARY ===");
console.log(JSON.stringify({ ping: pingSummary, ocr: ocrSummary }, null, 2));
