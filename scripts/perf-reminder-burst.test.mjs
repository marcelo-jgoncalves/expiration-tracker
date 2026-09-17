import { it } from 'node:test';
import assert from 'node:assert/strict';
import { assess, schedule, postWithQuotaRetry, readCohort, mapLimit, assertTenants } from './perf-reminder-burst.mjs';

const target = '2026-09-17T02:30:00.000Z';
const occurrence = n => ({ PK: `TENANT#t#ITEM#${n}`, SK: `OCC#${n}`, tenantId: 't', itemId: String(n),
  policyId: `p${n}`, scheduledAt: target, status: 'TRIGGERED', updatedAt: '2026-09-17T02:32:00.000Z' });

// G-V3: deriving dueDate from UTC instead of the configured local zone shifts this burst by a day.
it('keeps the due date on the Sao Paulo calendar across UTC midnight', () => {
  const result = schedule(target, Date.parse('2026-09-16T23:00:00Z'));
  assert.equal(result.dueDate, '2026-09-16T00:00:00.000Z');
  assert.equal(result.localTime, '23:30');
  assert.throws(() => schedule(target, Date.parse(target) - 60000), /90 minutes/);
  assert.throws(() => schedule('2026-09-17T02:30:01Z', 0), /whole minute/);
  assert.throws(() => schedule('2026-09-17T02:30:00', 0), /timezone/);
});

// G-V3: removing the organization uniqueness check allows ten workers to share one rate-limit bucket.
it('rejects duplicated synthetic tenants before login or workload creation', () => {
  const tenants = Array.from({ length: 10 }, (_, i) => ({ index: i + 1,
    organizationId: `org_${i}`, label: `PERF LoadTest Tenant ${String(i + 1).padStart(2, '0')}` }));
  assertTenants(tenants);
  tenants[9].organizationId = tenants[0].organizationId;
  assert.throws(() => assertTenants(tenants), /distinct/);
});

// G-V3: using outcome log counts instead of exact keys would accept these missing/foreign records.
it('requires every cohort occurrence and rejects foreign tenant, schedule and duplicates', () => {
  const expected = [occurrence(1), occurrence(2)];
  assert.equal(assess(expected, expected.slice(0, 1), target, 2).complete, false);
  for (const replacement of [{ ...expected[1], tenantId: 'other' }, { ...expected[1], scheduledAt: '2026-09-18T02:30:00Z' }, expected[0]]) {
    assert.throws(() => assess(expected, [expected[0], replacement], target, 2));
  }
  assert.equal(assess(expected, [expected[0], { ...expected[1], status: 'SCHEDULED' }], target, 2).complete, false);
});

// G-V3: equating eventual completion with the five-minute SLO would incorrectly pass the late row.
it('separates full drain from the five-minute SLO and calculates actual percentiles', () => {
  const rows = [occurrence(1), { ...occurrence(2), updatedAt: '2026-09-17T02:36:00.000Z' }];
  const result = assess(rows, rows, target, 2);
  assert.equal(result.complete, true);
  assert.equal(result.withinFiveMinutes, false);
  assert.equal(result.lagSeconds.p50, 120);
  assert.equal(result.lagSeconds.p100, 360);
  assert.equal(assess([rows[0]], [rows[0]], target, 1).withinFiveMinutes, true);
});

// G-V3: retrying any non-201 instead of only 429 creates duplicate writes after ambiguous failures.
it('retries quota rejection but never repeats a timed-out or failed write', async () => {
  let calls = 0;
  const pauses = [];
  assert.deepEqual(await postWithQuotaRetry(async () => ++calls === 1 ? { status: 429 } : { status: 201, body: { id: 'ok' } },
    async ms => { pauses.push(ms); }), { id: 'ok' });
  assert.equal(calls, 2);
  assert.deepEqual(pauses, [60000]);
  calls = 0;
  await assert.rejects(postWithQuotaRetry(async () => { calls++; return { status: 500 }; }), /500/);
  assert.equal(calls, 1);
  await assert.rejects(postWithQuotaRetry(async () => { throw new Error('timeout'); }), /timeout/);
});

// G-V3: dropping UnprocessedKeys or removing ConsistentRead silently loses evidence in a partial batch.
it('retries unprocessed keys and requests at most 100 strongly consistent records per batch', async () => {
  const cohort = Array.from({ length: 101 }, (_, i) => occurrence(i));
  let partial = false;
  const db = { send: async command => {
    const request = command.input.RequestItems['exptrk-dev-table'];
    assert.equal(request.ConsistentRead, true);
    assert.ok(request.Keys.length <= 100);
    const keys = request.Keys;
    if (!partial && keys.length === 100) {
      partial = true;
      return { Responses: { 'exptrk-dev-table': keys.slice(1) }, UnprocessedKeys: { 'exptrk-dev-table': { Keys: keys.slice(0, 1), ConsistentRead: true } } };
    }
    return { Responses: { 'exptrk-dev-table': keys } };
  } };
  const rows = await readCohort(db, cohort, async () => {});
  assert.equal(rows.length, 101);
  assert.equal(new Set(rows.map(r => r.PK)).size, 101);
});

// G-V3: returning collected records after exhausted retries makes an incomplete AWS read look final.
it('fails explicitly when DynamoDB never processes the requested keys', async () => {
  let calls = 0;
  const db = { send: async command => { calls++; return { UnprocessedKeys: command.input.RequestItems }; } };
  await assert.rejects(readCohort(db, [occurrence(1)], async () => {}), /Unprocessed/);
  assert.equal(calls, 8);
});

// G-V3: replacing bounded workers with Promise.all starts every tenant/read immediately.
it('bounds concurrency and waits for active work before surfacing a failure', async () => {
  let active = 0;
  let maximum = 0;
  await assert.rejects(mapLimit([0, 1, 2, 3], 2, async value => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    if (value === 0) throw new Error('stop');
  }), /stop/);
  assert.equal(maximum, 2);
  assert.equal(active, 0);
});
