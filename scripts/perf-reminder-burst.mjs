// D-300: seed through the real API, judge an exact cohort from consistent base-table reads.
import { readFileSync, writeFileSync, mkdirSync, existsSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = path.join(ROOT, 'docs/engineering/performance/.local');
const ORIGIN = 'https://d1mbs2t047qo9d.cloudfront.net';
const TABLE = 'exptrk-dev-table';
const ACCOUNT = '975707451904';
const REGION = 'us-east-1';
const PROFILE = 'claude-dev';
const EXPECTED = Number(process.env.PERF_REMINDER_BURST_SIZE ?? 10000);
requireThatBurstSize(EXPECTED);
const PER_TENANT = EXPECTED / 10;
// Cognito access tokens last 15 minutes. The harness sends explicit Cookie headers, so it cannot
// adopt rotated cookies from BFF refresh responses. Reauthenticate between sub-10-minute rounds.
const PAIRS_PER_SESSION = Math.min(200, PER_TENANT);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const save = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
const log = data => console.log(JSON.stringify({ at: new Date().toISOString(), ...data }));
const requireThat = (value, message) => { if (!value) throw new Error(message); };

function requireThatBurstSize(value) {
  if (!Number.isInteger(value) || value < 1000 || value > 100000 || value % 10 !== 0) {
    throw new Error('PERF_REMINDER_BURST_SIZE must be an integer from 1000 to 100000 and divisible by 10');
  }
}

export function schedule(target, now = Date.now()) {
  requireThat(typeof target === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(target),
    'Target must be an ISO timestamp with an explicit timezone');
  const ms = Date.parse(target);
  requireThat(Number.isFinite(ms) && ms % 60000 === 0, 'Target must be an ISO timestamp on a whole minute');
  requireThat(ms - now >= 90 * 60000, 'Allow at least 90 minutes for login, paced seed and materialization');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return { target: new Date(ms).toISOString(), dueDate: `${parts.year}-${parts.month}-${parts.day}T00:00:00.000Z`, localTime: `${parts.hour}:${parts.minute}` };
}

export function assertTenants(tenants) {
  requireThat(tenants.length === 10 && new Set(tenants.map(t => t.organizationId)).size === 10 &&
    new Set(tenants.map(t => t.index)).size === 10, 'Need exactly ten distinct synthetic tenants');
  requireThat(tenants.every(t => /^org_[A-Z0-9]+$/.test(t.organizationId) &&
    Number.isInteger(t.index) && t.index >= 1 && t.index <= 10 && t.label === `PERF LoadTest Tenant ${String(t.index).padStart(2, '0')}`), 'Unexpected synthetic tenant manifest');
}

export async function mapLimit(values, limit, fn) {
  let next = 0;
  let failure;
  const results = new Array(values.length);
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length && !failure) {
      const index = next++;
      try { results[index] = await fn(values[index], index); } catch (error) { failure ??= error; }
    }
  }));
  if (failure) throw failure;
  return results;
}

// Only explicit quota rejections are retried. A timeout/5xx can follow a committed write;
// the journal stays pending, preventing a restart from silently creating another item/policy.
export async function postWithQuotaRetry(request, pause = sleep) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const result = await request();
    if (result.status !== 429) {
      requireThat(result.status === 201, `POST returned ${result.status}; inspect pending journal before resuming`);
      return result.body;
    }
    await pause(60000);
  }
  throw new Error('Quota retries exhausted; inspect pending journal');
}

export function assess(expected, actual, target, total = EXPECTED) {
  const key = row => `${row.PK}|${row.SK}`;
  const wanted = new Map(expected.map(row => [key(row), row]));
  const seen = new Set();
  const statuses = {};
  const lags = [];
  for (const row of actual) {
    const match = wanted.get(key(row));
    requireThat(match && !seen.has(key(row)), 'Unexpected or duplicate occurrence in evidence');
    requireThat(row.tenantId === match.tenantId && row.itemId === match.itemId && row.policyId === match.policyId && row.scheduledAt === target,
      'Occurrence identity/tenant/schedule differs from manifest');
    seen.add(key(row));
    statuses[row.status] = (statuses[row.status] ?? 0) + 1;
    if (row.status === 'TRIGGERED') {
      const lag = (Date.parse(row.updatedAt) - Date.parse(target)) / 1000;
      requireThat(Number.isFinite(lag) && lag >= 0, 'Invalid trigger timestamp');
      lags.push(lag);
    }
  }
  lags.sort((a, b) => a - b);
  const percentiles = Object.fromEntries([50, 75, 90, 95, 99, 100].map(p => [`p${p}`, lags[Math.ceil(lags.length * p / 100) - 1] ?? null]));
  const complete = expected.length === total && wanted.size === total && seen.size === total && statuses.TRIGGERED === total;
  return { expected: total, found: seen.size, missing: total - seen.size, statuses, lagSeconds: percentiles,
    complete, withinFiveMinutes: complete && percentiles.p100 <= 300 };
}

function aws(service, operation, args = []) {
  return JSON.parse(execFileSync('aws', [service, operation, ...args, '--profile', PROFILE, '--region', REGION, '--output', 'json'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 60000, windowsHide: true }));
}

function infrastructure() {
  requireThat(aws('sts', 'get-caller-identity').Account === ACCOUNT, 'Wrong AWS account');
  const functions = ['reminder-producer', 'reminder-claim-consumer', 'reminder-reconciliation', 'reminder-dispatch', 'dispatch-outbox-relay',
    'reminder-scan-enumerator-v2', 'reminder-scan-page-v2', 'reminder-scan-control-relay', 'reminder-scan-control-reconciler'];
  const configs = functions.map(name => {
    const c = aws('lambda', 'get-function-configuration', ['--function-name', `exptrk-dev-${name}`, '--qualifier', 'live']);
    return { name, version: c.Version, codeSha256: c.CodeSha256, mode: c.Environment?.Variables?.SCAN_MODE, epoch: c.Environment?.Variables?.SCAN_MODE_EPOCH };
  });
  requireThat(configs[0].mode === 'PAGED' && configs[2].mode === 'PAGED', 'Producer/reconciliation must use PAGED');
  // Only the scan/lease writers currently expose this setting. The claim consumer does not
  // implement epoch fencing; a steady-state burst cannot establish rollback safety.
  requireThat(configs[0].epoch && configs[2].epoch === configs[0].epoch, 'Producer/reconciliation epochs differ');
  requireThat(configs[5].epoch === configs[0].epoch && configs[6].epoch === configs[0].epoch && configs[8].epoch === configs[0].epoch,
    'Dedicated scan control-plane epochs differ from the active rollout epoch');
  const mappings = aws('lambda', 'list-event-source-mappings').EventSourceMappings
    .filter(m => /:exptrk-dev-reminder-(scan(?:-v2)?|claim)$/.test(m.EventSourceArn) || /:function:exptrk-dev-reminder-scan-control-relay:live$/.test(m.FunctionArn));
  const legacyScanMapping = mappings.find(m => /:exptrk-dev-reminder-scan$/.test(m.EventSourceArn));
  const activeMappings = mappings.filter(m => m !== legacyScanMapping);
  requireThat(mappings.length === 4 && legacyScanMapping?.State === 'Disabled' && activeMappings.length === 3 && activeMappings.every(m => m.State === 'Enabled'),
    'Exclusive cutover requires legacy scan disabled and dedicated scan/claim mappings enabled');
  const schedules = aws('scheduler', 'list-schedules').Schedules
    .filter(s => /^exptrk-dev-reminder-scan-(?:enumerator-v2|control-reconciler)$/.test(s.Name) || s.Name === 'reminder-producer');
  requireThat(schedules.length === 3 && schedules.filter(s => s.Name !== 'reminder-producer').every(s => s.State === 'ENABLED') &&
    schedules.find(s => s.Name === 'reminder-producer')?.State === 'DISABLED', 'Exclusive cutover schedule state is invalid');
  const queues = {};
  for (const name of ['reminder-scan', 'reminder-scan-v2', 'reminder-claim', 'reminder-dispatch']) {
    for (const suffix of ['', '-dlq']) {
      queues[name + suffix] = aws('sqs', 'get-queue-attributes', ['--queue-url', `https://sqs.${REGION}.amazonaws.com/${ACCOUNT}/exptrk-dev-${name}${suffix}`,
        '--attribute-names', 'ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessagesDelayed']).Attributes;
    }
  }
  return { checkedAt: new Date().toISOString(), account: ACCOUNT, region: REGION, configs, schedules,
    mappings: mappings.map(m => ({ source: m.EventSourceArn, functionArn: m.FunctionArn, state: m.State, concurrency: m.ScalingConfig?.MaximumConcurrency })), queues };
}

async function authenticate(tenants) {
  const credentials = Object.fromEntries(readFileSync(path.join(LOCAL, 'perf-11b-loadtest-users-credentials.txt'), 'utf8')
    .split(/\r?\n/).flatMap(line => { const m = /^(\w+)=(.*)$/.exec(line); return m ? [[m[1], m[2].trim()]] : []; }));
  requireThat(credentials.email_prefix && credentials.password, 'Missing local synthetic credentials');
  const { chromium } = await import(pathToFileURL(path.join(ROOT, 'frontend/node_modules/playwright/index.mjs')).href);
  const browser = await chromium.launch();
  const sessions = new Map();
  try {
    for (const tenant of tenants) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto(`${ORIGIN}/bff/login?returnTo=/`, { waitUntil: 'domcontentloaded' });
      await page.locator('#signInFormUsername:visible').fill(`${credentials.email_prefix}${String(tenant.index).padStart(2, '0')}@gmail.com`);
      await page.locator('#signInFormPassword:visible').fill(credentials.password);
      await page.locator("input[name='signInSubmitButton']:visible").click();
      await page.waitForURL(url => url.origin === ORIGIN && !url.pathname.startsWith('/bff/'), { timeout: 60000 });
      const session = await (await context.request.get(`${ORIGIN}/bff/session`)).json();
      requireThat(session.authenticated && session.activeOrganizationId === tenant.organizationId, `Tenant ${tenant.index}: active organization mismatch`);
      const cookies = await context.cookies(ORIGIN);
      const csrf = cookies.find(c => c.name === '__Host-et_csrf')?.value;
      requireThat(csrf && cookies.some(c => c.name === '__Host-et_session'), 'Missing session/CSRF cookie');
      const headers = { 'content-type': 'application/json', cookie: cookies.map(c => `${c.name}=${c.value}`).join('; '),
        'x-csrf-token': csrf, 'sec-fetch-site': 'same-origin', origin: ORIGIN, 'x-organization-id': tenant.organizationId };
      const response = await fetch(`${ORIGIN}/bff/api/items/${tenant.itemId}`, { headers, signal: AbortSignal.timeout(30000), redirect: 'error' });
      const body = await response.json();
      requireThat(response.ok && body.item?.tenantId === tenant.organizationId && body.item?.itemId === tenant.itemId,
        `Tenant ${tenant.index}: authenticated API read did not match manifest`);
      sessions.set(tenant.organizationId, headers);
      await context.close();
      log({ phase: 'auth-verified', tenant: tenant.index });
    }
  } finally { await browser.close(); }
  return sessions;
}

async function seed(manifest, dir, initialSessions) {
  let stopped = false;
  for (let roundStart = 0; roundStart < PER_TENANT; roundStart += PAIRS_PER_SESSION) {
    const sessions = roundStart === 0 ? initialSessions : await authenticate(manifest.tenants);
    const roundEnd = Math.min(roundStart + PAIRS_PER_SESSION, PER_TENANT);
    await mapLimit(manifest.tenants, 10, async tenant => {
      const file = path.join(dir, `tenant-${tenant.index}.json`);
      const rows = existsSync(file) ? read(file) : [];
      requireThat(rows.every(row => !row.pending), `Tenant ${tenant.index}: unresolved POST; reconcile journal before resuming`);
      const headers = sessions.get(tenant.organizationId);
      const cutoff = Date.parse(manifest.target) - 10 * 60000;
      const post = async (route, body) => postWithQuotaRetry(async () => {
        requireThat(!stopped && Date.now() < cutoff, 'Seed stopped or target too close; partial load must not be called a completed burst test');
        await sleep(850);
        const res = await fetch(ORIGIN + route, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000), redirect: 'error' });
        return { status: res.status, body: res.status === 201 ? await res.json() : null };
      });
      try {
        for (let i = roundStart; i < roundEnd; i++) {
        const row = rows[i] ?? { index: i + 1, tenantId: tenant.organizationId };
        rows[i] = row;
        const name = `${manifest.runId}-T${tenant.index}-${i + 1}`;
        if (!row.itemId) {
          row.pending = 'item'; save(file, rows);
          const { item } = await post('/bff/api/items', { name, category: `PERF-12-${EXPECTED}`, dueDate: manifest.dueDate });
          requireThat(item?.itemId && item.tenantId === tenant.organizationId, 'Item response identity mismatch');
          row.itemId = item.itemId; delete row.pending; save(file, rows);
        }
        if (!row.policyId) {
          row.pending = 'policy'; save(file, rows);
          const { policy } = await post('/bff/api/reminders/policies', { scope: 'ITEM', itemId: row.itemId, enabled: true,
            rule: { name, timeZone: 'America/Sao_Paulo', triggers: [{ triggerId: 't1', offsetIso: 'P0D', localTime: manifest.localTime }], channels: ['EMAIL'] } });
          requireThat(policy?.policyId && policy.tenantId === tenant.organizationId, 'Policy response identity mismatch');
          row.policyId = policy.policyId; delete row.pending; save(file, rows);
        }
        if ((i + 1) % 100 === 0) log({ phase: 'seed', tenant: tenant.index, pairs: i + 1, total: PER_TENANT });
        }
      } catch (error) { stopped = true; throw error; }
    });
  }
}

function database() {
  process.env.AWS_PROFILE = PROFILE;
  return DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION, maxAttempts: 3 }));
}

async function materialize(manifest, dir, db) {
  const seeds = manifest.tenants.flatMap(t => read(path.join(dir, `tenant-${t.index}.json`)));
  requireThat(seeds.length === EXPECTED && seeds.every(s => s.itemId && s.policyId && !s.pending) &&
    new Set(seeds.map(s => `${s.tenantId}/${s.itemId}`)).size === EXPECTED, 'Seed incomplete or duplicate');
  const deadline = Date.parse(manifest.target) - 5 * 60000;
  const occurrences = await mapLimit(seeds, 16, async seedRow => {
    while (Date.now() < deadline) {
      let key;
      const found = [];
      do {
        const page = await db.send(new QueryCommand({ TableName: TABLE, ConsistentRead: true,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: { ':pk': `TENANT#${seedRow.tenantId}#ITEM#${seedRow.itemId}`, ':sk': 'OCC#' }, ExclusiveStartKey: key }));
        found.push(...page.Items); key = page.LastEvaluatedKey;
      } while (key);
      if (found.length) {
        requireThat(found.length === 1 && found[0].status === 'SCHEDULED' && found[0].scheduledAt === manifest.target &&
          found[0].policyId === seedRow.policyId && found[0].tenantId === seedRow.tenantId && found[0].itemId === seedRow.itemId,
        'Materialized occurrence does not match the planned cohort');
        const { PK, SK, tenantId, itemId, policyId, scheduledAt } = found[0];
        return { PK, SK, tenantId, itemId, policyId, scheduledAt };
      }
      await sleep(5000);
    }
    throw new Error('Materialization deadline exceeded; test invalid');
  });
  save(path.join(dir, 'cohort.json'), occurrences);
  return occurrences;
}

export async function readCohort(db, cohort, pause = sleep) {
  const batches = [];
  for (let i = 0; i < cohort.length; i += 100) batches.push(cohort.slice(i, i + 100));
  return (await mapLimit(batches, 4, async batch => {
    let request = { [TABLE]: { Keys: batch.map(({ PK, SK }) => ({ PK, SK })), ConsistentRead: true } };
    const rows = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      const result = await db.send(new BatchGetCommand({ RequestItems: request }));
      rows.push(...(result.Responses?.[TABLE] ?? []));
      request = result.UnprocessedKeys ?? {};
      if (!Object.keys(request).length) return rows;
      await pause(Math.min(10000, 250 * 2 ** attempt));
    }
    throw new Error('Unprocessed DynamoDB keys remain; no complete verdict possible');
  })).flat();
}

function metrics(manifest) {
  const result = {};
  for (const fn of ['reminder-scan-enumerator-v2', 'reminder-scan-page-v2', 'reminder-scan-control-relay', 'reminder-scan-control-reconciler',
    'reminder-claim-consumer', 'reminder-dispatch', 'dispatch-outbox-relay']) {
    result[fn] = {};
    for (const metric of ['Invocations', 'Errors', 'Throttles', 'Duration']) {
      result[fn][metric] = aws('cloudwatch', 'get-metric-statistics', ['--namespace', 'AWS/Lambda', '--metric-name', metric,
        '--dimensions', `Name=FunctionName,Value=exptrk-dev-${fn}`, '--start-time', manifest.target,
        '--end-time', new Date().toISOString(), '--period', '60', '--statistics', ...(metric === 'Duration' ? ['Average', 'Maximum'] : ['Sum'])]).Datapoints;
    }
  }
  return result;
}

async function coldWarmMetrics(manifest) {
  const results = {};
  for (const fn of ['reminder-scan-enumerator-v2', 'reminder-scan-page-v2', 'reminder-scan-control-relay', 'reminder-scan-control-reconciler',
    'reminder-claim-consumer', 'reminder-dispatch', 'dispatch-outbox-relay']) {
    const { queryId } = aws('logs', 'start-query', ['--log-group-name', `/aws/lambda/exptrk-dev-${fn}`,
      '--start-time', String(Math.floor(Date.parse(manifest.target) / 1000)), '--end-time', String(Math.floor(Date.now() / 1000)),
      '--query-string', 'filter @type = "REPORT" | stats count(*) as invocations, pct(@duration,50) as p50, pct(@duration,75) as p75, pct(@duration,90) as p90, pct(@duration,95) as p95, pct(@duration,99) as p99, max(@duration) as maxDuration, max(@initDuration) as maxInitDuration by ispresent(@initDuration) as coldStart']);
    let result;
    for (let i = 0; i < 15; i++) {
      await sleep(2000);
      result = aws('logs', 'get-query-results', ['--query-id', queryId]);
      if (!['Scheduled', 'Running'].includes(result.status)) break;
    }
    results[fn] = { queryId, ...result };
    // A missing metric query is evidence missing, never an implicit zero-errors result.
    requireThat(result.status === 'Complete', `CloudWatch query incomplete: ${queryId}`);
  }
  return results;
}

async function verify(manifest, dir, db) {
  const cohort = read(path.join(dir, 'cohort.json'));
  const rows = await readCohort(db, cohort);
  const report = { checkedAt: new Date().toISOString(), runId: manifest.runId, target: manifest.target,
    ...assess(cohort, rows, manifest.target) };
  save(path.join(dir, 'result.json'), report);
  save(path.join(dir, 'occurrences.json'), rows);
  log({ phase: 'verification', ...report });
  return report;
}

async function main() {
  const [command, runId, target] = process.argv.slice(2);
  requireThat(['plan', 'preflight', 'run', 'verify'].includes(command) && /^[a-z0-9-]{1,64}$/.test(runId ?? ''),
    'Usage: node scripts/perf-reminder-burst.mjs plan|preflight|run|verify <unique-run-id> [target-ISO-for-plan]');
  const dir = path.join(LOCAL, runId);
  if (command === 'plan') {
    requireThat(!existsSync(dir), 'Run ID already exists; use a new ID');
    const tenants = read(path.join(LOCAL, 'perf-11b-tenants.json')).tenants;
    assertTenants(tenants);
    const timing = schedule(target ?? new Date(Math.ceil((Date.now() + 120 * 60000) / 60000) * 60000).toISOString());
    mkdirSync(dir, { recursive: true });
    const manifest = { runId, nonce: randomUUID(), createdAt: new Date().toISOString(), expected: EXPECTED,
      gitSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(), ...timing, tenants };
    save(path.join(dir, 'manifest.json'), manifest);
    log({ phase: 'planned', runId, ...timing, expected: EXPECTED, dir });
    return;
  }
  const manifest = read(path.join(dir, 'manifest.json'));
  assertTenants(manifest.tenants);
  requireThat(manifest.runId === runId && manifest.expected === EXPECTED, 'Manifest mismatch');
  const lockPath = path.join(dir, 'runner.lock');
  const lock = openSync(lockPath, 'wx');
  try {
    save(lockPath, { pid: process.pid, startedAt: new Date().toISOString() });
    if (command === 'verify') {
      requireThat(aws('sts', 'get-caller-identity').Account === ACCOUNT, 'Wrong AWS account');
      const report = await verify(manifest, dir, database());
      process.exitCode = report.withinFiveMinutes ? 0 : 2;
      return;
    }
    const baseline = infrastructure();
    save(path.join(dir, 'preflight-infra.json'), baseline);
    requireThat(Object.entries(baseline.queues).filter(([name]) => name.endsWith('-dlq')).every(([, attrs]) =>
      Object.values(attrs).every(n => Number(n) === 0)), 'DLQ not empty before experiment');
    const sessions = await authenticate(manifest.tenants);
    save(path.join(dir, 'preflight.json'), { checkedAt: new Date().toISOString(), tenantsVerified: sessions.size, account: ACCOUNT });
    if (command === 'preflight') { log({ phase: 'preflight-passed', tenants: sessions.size, workloadCreated: 0 }); return; }
    requireThat(Date.parse(manifest.target) - Date.now() >= 60 * 60000, 'Target too close; create a new plan');
    await seed(manifest, dir, sessions);
    const db = database();
    await materialize(manifest, dir, db);
    save(path.join(dir, 'ready.json'), { at: new Date().toISOString(), materialized: EXPECTED, target: manifest.target });
    log({ phase: 'ready', materialized: EXPECTED, target: manifest.target });
    while (Date.now() < Date.parse(manifest.target)) await sleep(Math.min(60000, Date.parse(manifest.target) - Date.now()));
    let report;
    do {
      await sleep(60000);
      report = await verify(manifest, dir, db);
    } while (!report.complete && Date.now() < Date.parse(manifest.target) + 20 * 60000);
    const finalInfra = infrastructure();
    save(path.join(dir, 'final-infra.json'), finalInfra);
    save(path.join(dir, 'metrics.json'), metrics(manifest));
    save(path.join(dir, 'cold-warm.json'), await coldWarmMetrics(manifest));
    const unchanged = JSON.stringify(baseline.configs) === JSON.stringify(finalInfra.configs);
    const queuesEmpty = Object.values(finalInfra.queues).every(attrs => Object.values(attrs).every(n => Number(n) === 0));
    const final = { ...report, deploymentUnchanged: unchanged, queuesEmpty,
      accepted: report.withinFiveMinutes && unchanged && queuesEmpty,
      scope: 'API creation -> materialization -> scan -> claim -> dispatch/TRIGGERED; not provider delivery or rollback safety' };
    save(path.join(dir, 'final.json'), final);
    log({ phase: 'final', ...final });
    process.exitCode = final.accepted ? 0 : 2;
  } finally { closeSync(lock); unlinkSync(lockPath); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
