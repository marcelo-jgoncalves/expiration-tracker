// PERF-12 10k slice: seed 1,000 item+policy pairs into EACH of the 10 PERF-11-b synthetic
// tenants (10 x 1,000 = 10,000 total), all triggers targeting the SAME minute, run as 10
// concurrent in-process workers (one per tenant) so each tenant's own seeding respects its OWN
// 100req/60s API_REQUEST quota independently, while wall-clock time stays ~26min total instead of
// 26min x 10 serial. reminder-producer scans GLOBALLY (GSI3, not tenant-scoped), so this produces
// a genuine 10k global burst at the target minute across 10 different tenants.
//
// Usage: node docs/engineering/performance/traces/perf-12-seed-10k.mjs [targetLocalTime]
// targetLocalTime defaults to 21:30 America/Sao_Paulo (00:30 UTC) - pick something ~30min out.

import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_DIR = path.resolve(__dirname, "../.local");
const APP_ORIGIN = "https://d1mbs2t047qo9d.cloudfront.net";
const N_PER_TENANT = 1000;
const DUE_DATE = "2026-09-14T00:00:00.000Z";
const TRIGGER_LOCAL_TIME = process.argv[2] || "21:30";
const DELAY_MS = 700; // ~85 req/min per tenant, under the 100/60s API_REQUEST tenant quota

const manifest = JSON.parse(readFileSync(path.resolve(LOCAL_DIR, "perf-11b-tenants.json"), "utf-8"));
const PROGRESS_DIR = path.resolve(LOCAL_DIR, "perf-12-10k-progress");
mkdirSync(PROGRESS_DIR, { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function csrfFromCookieHeader(cookieHeader) {
  const m = cookieHeader.match(/__Host-et_csrf=([^;]+)/);
  if (!m) throw new Error("no csrf cookie found in cookieHeader");
  return m[1];
}

async function postJson(headers, urlPath, body) {
  const res = await fetch(`${APP_ORIGIN}${urlPath}`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

async function seedTenant(t) {
  const sess = JSON.parse(readFileSync(path.resolve(LOCAL_DIR, t.cookieFile), "utf-8"));
  const csrf = sess.csrfTokenValue || csrfFromCookieHeader(sess.cookieHeader);
  const headers = {
    "Content-Type": "application/json",
    Cookie: sess.cookieHeader,
    "X-CSRF-Token": csrf,
    "Sec-Fetch-Site": "same-origin",
    "X-Organization-Id": t.organizationId,
  };

  const logPath = path.resolve(PROGRESS_DIR, `tenant-${t.index}.jsonl`);
  const summaryPath = path.resolve(PROGRESS_DIR, `tenant-${t.index}-summary.json`);

  let itemsCreated = 0;
  let policiesCreated = 0;
  let itemFailures = 0;
  let policyFailures = 0;
  const startedAt = new Date().toISOString();

  for (let i = 1; i <= N_PER_TENANT; i++) {
    const name = `PERF-12 10k T${String(t.index).padStart(2, "0")} Item ${String(i).padStart(4, "0")}`;
    let itemRes;
    for (let attempt = 0; attempt < 6; attempt++) {
      itemRes = await postJson(headers, "/bff/api/items", { name, category: "PERF-12-10k", dueDate: DUE_DATE });
      if (itemRes.status !== 429) break;
      await sleep(2000 * (attempt + 1)); // backoff on quota rejection
    }
    await sleep(DELAY_MS);

    let itemId;
    if (itemRes.status === 201) {
      itemId = itemRes.json.item?.itemId;
      itemsCreated++;
    } else {
      itemFailures++;
      appendFileSync(logPath, JSON.stringify({ i, phase: "item", status: itemRes.status, body: itemRes.json }) + "\n");
      continue;
    }

    let policyRes;
    for (let attempt = 0; attempt < 6; attempt++) {
      policyRes = await postJson(headers, "/bff/api/reminders/policies", {
        scope: "ITEM",
        itemId,
        enabled: true,
        rule: {
          name: `PERF-12 10k T${String(t.index).padStart(2, "0")} Policy ${String(i).padStart(4, "0")}`,
          timeZone: "America/Sao_Paulo",
          triggers: [{ triggerId: "t1", offsetIso: "P0D", localTime: TRIGGER_LOCAL_TIME }],
          channels: ["EMAIL"],
        },
      });
      if (policyRes.status !== 429) break;
      await sleep(2000 * (attempt + 1));
    }
    await sleep(DELAY_MS);

    if (policyRes.status === 201) {
      policiesCreated++;
      appendFileSync(logPath, JSON.stringify({ i, phase: "ok", itemId, policyId: policyRes.json.policy?.policyId }) + "\n");
    } else {
      policyFailures++;
      appendFileSync(logPath, JSON.stringify({ i, phase: "policy", status: policyRes.status, body: policyRes.json, itemId }) + "\n");
    }

    if (i % 100 === 0) {
      const summary = { tenant: t.index, orgId: t.organizationId, progress: i, of: N_PER_TENANT, itemsCreated, policiesCreated, itemFailures, policyFailures, updatedAt: new Date().toISOString() };
      writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
      console.log(`[T${t.index}] ${i}/${N_PER_TENANT} items=${itemsCreated} policies=${policiesCreated} itemFail=${itemFailures} policyFail=${policyFailures}`);
    }
  }

  const finishedAt = new Date().toISOString();
  const summary = { tenant: t.index, orgId: t.organizationId, progress: N_PER_TENANT, of: N_PER_TENANT, itemsCreated, policiesCreated, itemFailures, policyFailures, startedAt, finishedAt, triggerLocalTime: TRIGGER_LOCAL_TIME, dueDate: DUE_DATE };
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`[T${t.index}] DONE`, JSON.stringify(summary));
  return summary;
}

async function main() {
  console.log(`Starting parallel 10-tenant seed: ${N_PER_TENANT}/tenant, target trigger ${TRIGGER_LOCAL_TIME} America/Sao_Paulo, ${manifest.tenants.length} tenants.`);
  const results = await Promise.all(manifest.tenants.map(seedTenant));
  const grandTotal = results.reduce((acc, r) => ({ items: acc.items + r.itemsCreated, policies: acc.policies + r.policiesCreated, itemFail: acc.itemFail + r.itemFailures, policyFail: acc.policyFail + r.policyFailures }), { items: 0, policies: 0, itemFail: 0, policyFail: 0 });
  const finalSummary = { finishedAt: new Date().toISOString(), triggerLocalTime: TRIGGER_LOCAL_TIME, perTenant: results, grandTotal };
  writeFileSync(path.resolve(LOCAL_DIR, "perf-12-10k-seed-summary.json"), JSON.stringify(finalSummary, null, 2));
  console.log("ALL DONE", JSON.stringify(finalSummary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
