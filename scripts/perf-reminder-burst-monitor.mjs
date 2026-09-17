// Read-only checkpoints for the existing burst runner; never creates/retries test data.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mapLimit } from './perf-reminder-burst.mjs';

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runId = process.argv[2];
if (!/^[a-z0-9-]{1,64}$/.test(runId ?? '')) throw new Error('Expected run ID');
const dir = path.join(root, 'docs/engineering/performance/.local', runId);
const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
process.env.AWS_PROFILE = 'claude-dev';
const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1', maxAttempts: 3 }));
async function aws(service, operation, args = []) {
  const { stdout } = await exec('aws', [service, operation, ...args, '--profile', 'claude-dev', '--region', 'us-east-1', '--output', 'json'],
    { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  return JSON.parse(stdout);
}
async function journals() {
  return Promise.all(manifest.tenants.map(async tenant => {
    const file = path.join(dir, `tenant-${tenant.index}.json`);
    if (!existsSync(file)) return { tenant: tenant.index, rows: [] };
    for (let attempt = 0; attempt < 5; attempt++) {
      // The runner may be replacing this journal while the monitor reads it.
      try { return { tenant: tenant.index, rows: JSON.parse(readFileSync(file, 'utf8')) }; }
      catch (error) { if (attempt === 4) throw error; await sleep(100); }
    }
  }));
}
async function checkpoint(percent, journal) {
  const at = new Date().toISOString();
  const start = new Date(Date.now() - 5 * 60000).toISOString();
  const selected = journal.flatMap(({ rows }) => {
    const ready = rows.filter(r => r.policyId && !r.pending);
    return [...new Set([ready[0], ready[Math.floor(ready.length / 2)], ready.at(-1)])].filter(Boolean);
  });
  const sample = await mapLimit(selected, 6, async seed => {
    const result = await db.send(new QueryCommand({ TableName: 'exptrk-dev-table', ConsistentRead: true,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `TENANT#${seed.tenantId}#ITEM#${seed.itemId}`, ':sk': 'OCC#' } }));
    const matches = (result.Items ?? []).filter(r => r.policyId === seed.policyId && r.scheduledAt === manifest.target);
    return { tenantId: seed.tenantId, itemId: seed.itemId, matches: matches.length, statuses: matches.map(r => r.status) };
  });
  const functions = ['bff-handler', 'items-handler', 'reminders-handler', 'reminder-materialization-trigger', 'dispatch-outbox-relay', 'reminder-producer', 'reminder-claim-consumer'];
  const metrics = await mapLimit(functions.flatMap(fn => ['Invocations', 'Errors', 'Throttles'].map(metric => ({ fn, metric }))), 4, async ({ fn, metric }) => {
    const result = await aws('cloudwatch', 'get-metric-statistics', ['--namespace', 'AWS/Lambda', '--metric-name', metric,
      '--dimensions', `Name=FunctionName,Value=exptrk-dev-${fn}`, '--start-time', start, '--end-time', at, '--period', '60', '--statistics', 'Sum']);
    return { fn, metric, points: result.Datapoints, sum: result.Datapoints.length ? result.Datapoints.reduce((n, p) => n + p.Sum, 0) : null };
  });
  const queues = await mapLimit(['reminder-materialization-trigger', 'reminder-scan', 'reminder-claim', 'reminder-dispatch'].flatMap(q => [q, `${q}-dlq`]), 4, async name => ({ name,
    ...(await aws('sqs', 'get-queue-attributes', ['--queue-url', `https://sqs.us-east-1.amazonaws.com/975707451904/exptrk-dev-${name}`,
      '--attribute-names', 'ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessagesDelayed'])).Attributes }));
  const progress = journal.map(j => ({ tenant: j.tenant, items: j.rows.filter(r => r.itemId).length, policies: j.rows.filter(r => r.policyId).length }));
  const report = { at, checkpointPercent: percent, target: manifest.target, progress, sample, metrics, queues,
    limitations: 'Materialization is a 3-items-per-tenant sample, not a full-cohort verdict. CloudWatch metrics are global and may lag; null means no datapoints.' };
  writeFileSync(path.join(dir, `checkpoint-${percent}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ at, checkpoint: percent, policies: progress.reduce((n, p) => n + p.policies, 0),
    sampleSize: sample.length, sampleMaterialized: sample.filter(s => s.matches === 1).length,
    errors: metrics.filter(m => m.metric === 'Errors' && m.sum > 0), throttles: metrics.filter(m => m.metric === 'Throttles' && m.sum > 0), queues }));
}
async function main() {
  if ((await aws('sts', 'get-caller-identity')).Account !== '975707451904') throw new Error('Wrong AWS account');
  const pending = [25, 50, 75, 100].filter(p => !existsSync(path.join(dir, `checkpoint-${p}.json`)));
  const deadline = Date.parse(manifest.target) + 30 * 60000;
  while (pending.length && Date.now() < deadline) {
    const journal = await journals();
    const count = journal.reduce((n, j) => n + j.rows.filter(r => r.policyId && !r.pending).length, 0);
    if (count >= manifest.expected * pending[0] / 100) await checkpoint(pending.shift(), journal);
    else if (!existsSync(path.join(dir, 'runner.lock'))) throw new Error(`Runner stopped before next checkpoint; ${count} policies recorded`);
    else await sleep(30000);
  }
  if (pending.length) throw new Error('Monitor deadline exceeded');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
