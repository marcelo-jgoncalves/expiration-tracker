// PERF-04: warm-latency measurement harness against the live dev BFF (real tenant, real
// Cognito-backed session — see docs/engineering/performance/baseline/PERF-04-test-tenant.md).
//
// Runs N sequential GET requests per endpoint (concurrency=1, small delay between requests),
// discards the first few as cold/cache-warming, and reports p50/p75/p90/p95/p99 (ms, wall clock
// from request start to response body fully read) plus min/max/mean.
//
// Usage:
//   node docs/engineering/performance/traces/perf-04-latency.mjs [--n 50] [--warmup 5] [--delay 150]
//
// Reads the session cookie from docs/engineering/performance/.local/perf-04-session-cookies.json
// (gitignored — produced by perf-04-auth.mjs). Writes raw per-request samples as JSON next to this
// script's caller output (stdout) so the results doc can be built from the printed summary.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = path.resolve(__dirname, "../.local/perf-04-session-cookies.json");
const APP_ORIGIN = "https://d1mbs2t047qo9d.cloudfront.net";
const SUBJECT_ID = "subject_01M2GE65D5XGV7CXQ6ECB9YYAD";

function parseArgs(argv) {
  const out = { n: 50, warmup: 5, delay: 150 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--n") out.n = Number(argv[++i]);
    if (argv[i] === "--warmup") out.warmup = Number(argv[++i]);
    if (argv[i] === "--delay") out.delay = Number(argv[++i]);
  }
  return out;
}

function percentile(sortedMs, p) {
  if (sortedMs.length === 0) return null;
  const idx = Math.min(sortedMs.length - 1, Math.ceil((p / 100) * sortedMs.length) - 1);
  return sortedMs[Math.max(0, idx)];
}

function summarize(samplesMs) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: Math.round((sum / sorted.length) * 10) / 10,
    p50: percentile(sorted, 50),
    p75: percentile(sorted, 75),
    p90: percentile(sorted, 90),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

async function timedGet(url, cookieHeader) {
  const start = performance.now();
  const res = await fetch(url, { headers: { Cookie: cookieHeader } });
  await res.arrayBuffer(); // force full body read into wall-clock timing
  const elapsedMs = performance.now() - start;
  return { elapsedMs, status: res.status };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runEndpoint(name, path_, cookieHeader, opts) {
  const url = `${APP_ORIGIN}${path_}`;
  const all = [];
  const statusCounts = {};
  for (let i = 0; i < opts.n; i++) {
    const { elapsedMs, status } = await timedGet(url, cookieHeader);
    all.push({ i, elapsedMs, status });
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    if (opts.delay > 0) await sleep(opts.delay);
  }
  const warm = all.slice(opts.warmup).filter((s) => s.status < 500);
  const warmMs = warm.map((s) => s.elapsedMs);
  return {
    name,
    path: path_,
    requested: opts.n,
    warmupDiscarded: opts.warmup,
    statusCounts,
    warmSampleCount: warmMs.length,
    stats: summarize(warmMs),
    raw: all,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const session = JSON.parse(fs.readFileSync(SESSION_PATH, "utf8"));

  // sanity check the session before burning the full run
  const sessionCheck = await fetch(`${APP_ORIGIN}/bff/session`, { headers: { Cookie: session.cookieHeader } });
  const sessionBody = await sessionCheck.json();
  if (!sessionBody.authenticated) {
    console.error("Session not authenticated — rerun perf-04-auth.mjs. Body:", sessionBody);
    process.exit(1);
  }

  const endpoints = [
    { name: "bff.session", path: "/bff/session" },
    { name: "items.dashboard", path: "/bff/api/items/dashboard" },
    { name: "subjects.dashboard", path: "/bff/api/subjects/dashboard" },
    { name: "subjects.byId", path: `/bff/api/subjects/${SUBJECT_ID}` },
    // document-archive: EXCLUDED. Every route probed (storage-usage, document-types,
    // requirements/{subjectId}) returns 500 "DynamoDB access denied during
    // OrganizationStore.queryGsi4." — the same IAM gap noted in PERF-04-test-tenant.md for
    // writes affects reads too on this module in dev. Not a payload/seed-data problem; skipped
    // per task instructions (measurement-only, not fixing infra permissions here).
  ];

  const results = [];
  for (const ep of endpoints) {
    process.stderr.write(`Running ${ep.name} (${opts.n} requests, warmup=${opts.warmup})...\n`);
    const result = await runEndpoint(ep.name, ep.path, session.cookieHeader, opts);
    results.push(result);
    process.stderr.write(`  statusCounts=${JSON.stringify(result.statusCounts)} stats=${JSON.stringify(result.stats)}\n`);
  }

  console.log(JSON.stringify({ obtainedAt: new Date().toISOString(), opts, results }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
