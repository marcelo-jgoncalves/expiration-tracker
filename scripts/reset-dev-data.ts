/**
 * Wave B2B-12 (docs/architecture/multi-user-b2b-wave-b2b12-scope.md, `APPROVED` D-110) — one-off
 * reset/reseed of the `dev` environment ahead of the Multi-User B2B cutover. Read-only inventory
 * done during the scoping protocol (Rodada 1) confirmed every row in `dev` today is
 * synthetic/disposable (zero real Organization/Membership) — reset, not migration, per
 * roadmap-evolution/17 §63.
 *
 * Two sequential phases, never combined:
 *   Phase A (always runs, read-only): inventories `exptrk-dev-table`, `exptrk-dev-bff-session`,
 *     the `extraction-transient` S3 bucket, the Cognito user pool, and all 24 SQS queues (12 +
 *     DLQs). Writes a RAW snapshot (may contain PII/secrets — session cookies, e-mails) to
 *     `.local-artifacts/dev-reset/<ISO timestamp>/` (gitignored, never committed) and a REDACTED
 *     manifest (counts + entityTypes + SHA-256 hash per item, never a raw field value) to
 *     `docs/architecture/reviews/multi-user-b2b-wave-b2b12-scoping/`.
 *   Phase B (only with `--confirm`, and only after Phase A's snapshot write succeeds in the SAME
 *     invocation — fail-closed): deletes DynamoDB items in batches of <=25 via BatchWriteItem,
 *     retrying UnprocessedItems with exponential backoff+jitter (`retryWithBackoff`, defined
 *     locally — no reusable backoff helper exists elsewhere in this project, confirmed by
 *     `dispatch-outbox-relay/relay.ts`'s explicit "no backoff of its own" design); purges all 24
 *     SQS queues (native `PurgeQueue`); deletes S3 objects; deletes Cognito users ONLY with the
 *     additional `--include-cognito` flag (never a silent side effect of the DynamoDB reset).
 *     Ends with a second full read (Scan + queue attributes) — any non-zero count is a hard
 *     failure (fail-loud), never a silent partial success.
 *
 * Safety:
 *   - Table/session-table/bucket names are validated against a hardcoded allowlist, never a free
 *     parameter — this AWS account is shared with other unrelated projects
 *     (marcelo-goncalves-blog-dev-*, terraform-lock-stocks-ranking).
 *   - `sts:GetCallerIdentity` confirms the caller is the expected dev account before Phase B runs.
 *   - Phase A and `--dry-run` (the default; `--confirm` is required to write/delete anything) are
 *     pure reads.
 *
 * Usage:
 *   tsx scripts/reset-dev-data.ts [--confirm] [--include-cognito] [--user-pool-id <id>]
 *
 * Never auto-run on deploy/CI — manual, one-off operator invocation only, same posture as
 * scripts/backfill-reminder-policies.ts. Actually running this with --confirm (or
 * --include-cognito) against the real claude-dev account requires Marcelo's explicit
 * confirmation first (AGENTS.md §1 exception, registered in multi-user-b2b-wave-b2b12-scope.md) —
 * this script itself has no such gate baked in (a CLI flag cannot enforce a human confirmation
 * step), so the operator invoking it IS that confirmation.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BatchWriteCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { createDocumentClient } from "../src/shared/dynamodb/client.js";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from "@aws-sdk/client-s3";
import { SQSClient, GetQueueAttributesCommand, GetQueueUrlCommand, PurgeQueueCommand } from "@aws-sdk/client-sqs";
import { CognitoIdentityProviderClient, ListUsersCommand, AdminDeleteUserCommand } from "@aws-sdk/client-cognito-identity-provider";

export const ALLOWED_MAIN_TABLE = "exptrk-dev-table";
export const ALLOWED_SESSION_TABLE = "exptrk-dev-bff-session";
export const ALLOWED_BUCKET = "exptrk-dev-extraction-transient";
export const EXPECTED_ACCOUNT_ID = "975707451904";

export const QUEUE_BASE_NAMES = [
  "document-chasing-dispatch",
  "extraction-starter",
  "import-commit",
  "import-parse",
  "malware-result",
  "notification-email-deliver",
  "notification-router",
  "reminder-dispatch",
  "reminder-materialization-trigger",
  "ses-callback",
  "textract-completion",
  "upload-finalizer",
] as const;

export function queueNames(): string[] {
  return QUEUE_BASE_NAMES.flatMap((base) => [`exptrk-dev-${base}`, `exptrk-dev-${base}-dlq`]);
}

export interface Args {
  table: string;
  sessionTable: string;
  bucket: string;
  confirm: boolean;
  includeCognito: boolean;
  userPoolId?: string;
}

export function assertAllowedTable(name: string, allowed: string): void {
  if (name !== allowed) {
    throw new Error(`Refusing to operate on "${name}" — the only value allowed here is "${allowed}" (dev-only allowlist, never a free parameter).`);
  }
}

export function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const table = get("--table") ?? ALLOWED_MAIN_TABLE;
  const sessionTable = get("--session-table") ?? ALLOWED_SESSION_TABLE;
  const bucket = get("--bucket") ?? ALLOWED_BUCKET;
  assertAllowedTable(table, ALLOWED_MAIN_TABLE);
  assertAllowedTable(sessionTable, ALLOWED_SESSION_TABLE);
  assertAllowedTable(bucket, ALLOWED_BUCKET);
  return {
    table,
    sessionTable,
    bucket,
    confirm: argv.includes("--confirm"),
    includeCognito: argv.includes("--include-cognito"),
    userPoolId: get("--user-pool-id"),
  };
}

export async function assertExpectedAccount(getCallerIdentityAccountId: () => Promise<string | undefined>): Promise<void> {
  const account = await getCallerIdentityAccountId();
  if (account !== EXPECTED_ACCOUNT_ID) {
    throw new Error(`Refusing to proceed: caller identity account "${account}" does not match the expected dev account "${EXPECTED_ACCOUNT_ID}".`);
  }
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface BackoffOptions {
  retries: number;
  baseMs: number;
  jitterMs: number;
  sleep: (ms: number) => Promise<void>;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  retries: 5,
  baseMs: 200,
  jitterMs: 100,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Retries a BatchWriteItem-shaped delete until DynamoDB reports zero UnprocessedItems, with
 * exponential backoff + jitter between attempts. Throws (never silently gives up) once
 * `opts.retries` is exceeded — the caller (Phase B) treats that as a hard failure of the whole
 * reset, not a partial success.
 */
export async function deleteBatchWithRetry(
  batchWriteDelete: (tableName: string, keys: Record<string, unknown>[]) => Promise<Record<string, unknown>[]>,
  tableName: string,
  keys: Record<string, unknown>[],
  opts: BackoffOptions = DEFAULT_BACKOFF,
): Promise<void> {
  let remaining = keys;
  let attempt = 0;
  while (remaining.length > 0) {
    if (attempt > opts.retries) {
      throw new Error(`deleteBatchWithRetry: giving up after ${attempt} attempts, ${remaining.length} item(s) still unprocessed for table "${tableName}".`);
    }
    if (attempt > 0) {
      const delay = opts.baseMs * 2 ** (attempt - 1) + Math.floor(Math.random() * opts.jitterMs);
      await opts.sleep(delay);
    }
    remaining = await batchWriteDelete(tableName, remaining);
    attempt += 1;
  }
}

export function extractKey(item: Record<string, unknown>): Record<string, unknown> {
  const { PK, SK } = item as { PK?: unknown; SK?: unknown };
  if (PK === undefined || SK === undefined) {
    throw new Error("extractKey: item is missing PK/SK — cannot build a delete key for it.");
  }
  return { PK, SK };
}

export async function deleteAllItems(
  batchWriteDelete: (tableName: string, keys: Record<string, unknown>[]) => Promise<Record<string, unknown>[]>,
  tableName: string,
  items: Record<string, unknown>[],
  opts: BackoffOptions = DEFAULT_BACKOFF,
): Promise<{ deleted: number; batches: number }> {
  const batches = chunk(items.map(extractKey), 25);
  for (const batch of batches) {
    await deleteBatchWithRetry(batchWriteDelete, tableName, batch, opts);
  }
  return { deleted: items.length, batches: batches.length };
}

/** Stable (sorted-key) JSON, so the same item always hashes to the same digest regardless of
 * property insertion order. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
        return acc;
      }, {});
  }
  return value;
}

export function hashItem(item: unknown): string {
  return createHash("sha256").update(JSON.stringify(sortKeysDeep(item))).digest("hex");
}

export interface ManifestEntry {
  source: string;
  itemCount: number;
  entityTypes: string[];
  hashes: string[];
}

/** Redacted manifest entry — counts/entityTypes/hashes only, NEVER a raw field value (this is
 * what's allowed into the Git-tracked `docs/architecture/reviews/` folder; the raw snapshot with
 * real PII/secrets stays in the gitignored `.local-artifacts/` path). */
export function buildManifestEntry(source: string, items: Array<Record<string, unknown>>): ManifestEntry {
  const entityTypes = Array.from(new Set(items.map((item) => String(item.entityType ?? "unknown")))).sort();
  return { source, itemCount: items.length, entityTypes, hashes: items.map(hashItem) };
}

export function assertAllEmpty(counts: Record<string, number>): void {
  const nonZero = Object.entries(counts).filter(([, n]) => n > 0);
  if (nonZero.length > 0) {
    throw new Error(`reset-dev-data: FINAL VERIFICATION FAILED — non-zero after Phase B: ${nonZero.map(([k, n]) => `${k}=${n}`).join(", ")}`);
  }
}

// --- Real AWS wiring (not unit tested directly — exercised manually via --dry-run against a
// real dev account, same convention as scripts/backfill-reminder-policies.ts's main()). Every
// pure/testable piece above takes plain data or an injected function, never an AWS SDK client
// directly, so test/unit/scripts/reset-dev-data.test.ts can cover it with fakes. -------------

async function scanAll(client: ReturnType<typeof createDocumentClient>, tableName: string): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await client.send(new ScanCommand({ TableName: tableName, ExclusiveStartKey: exclusiveStartKey }));
    items.push(...((result.Items ?? []) as Record<string, unknown>[]));
    exclusiveStartKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (exclusiveStartKey);
  return items;
}

async function realBatchWriteDelete(
  client: ReturnType<typeof createDocumentClient>,
  tableName: string,
  keys: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  if (keys.length === 0) return [];
  const result = await client.send(
    new BatchWriteCommand({ RequestItems: { [tableName]: keys.map((Key) => ({ DeleteRequest: { Key } })) } }),
  );
  const unprocessed = result.UnprocessedItems?.[tableName] ?? [];
  return unprocessed.map((req) => req.DeleteRequest!.Key! as Record<string, unknown>);
}

async function listAllS3Keys(s3: S3Client, bucket: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const result = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }));
    keys.push(...(result.Contents ?? []).map((obj) => obj.Key!).filter(Boolean));
    continuationToken = result.NextContinuationToken;
  } while (continuationToken);
  return keys;
}

async function resolveQueueUrls(sqs: SQSClient): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  for (const name of queueNames()) {
    const result = await sqs.send(new GetQueueUrlCommand({ QueueName: name }));
    if (result.QueueUrl) urls.set(name, result.QueueUrl);
  }
  return urls;
}

async function getQueueCounts(sqs: SQSClient, queueUrl: string): Promise<{ visible: number; notVisible: number }> {
  const result = await sqs.send(
    new GetQueueAttributesCommand({ QueueUrl: queueUrl, AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"] }),
  );
  return {
    visible: Number(result.Attributes?.ApproximateNumberOfMessages ?? "0"),
    notVisible: Number(result.Attributes?.ApproximateNumberOfMessagesNotVisible ?? "0"),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  console.log(`[reset-dev-data] table=${args.table} sessionTable=${args.sessionTable} bucket=${args.bucket} confirm=${args.confirm} includeCognito=${args.includeCognito}`);

  const sts = new STSClient({});
  await assertExpectedAccount(async () => (await sts.send(new GetCallerIdentityCommand({}))).Account);

  const docClient = createDocumentClient();
  const s3 = new S3Client({});
  const sqs = new SQSClient({});
  const cognito = new CognitoIdentityProviderClient({});

  // --- Phase A: read-only inventory + snapshot (always runs) ---------------------------------
  console.log("[reset-dev-data] Phase A: inventorying dev...");
  const mainItems = await scanAll(docClient, args.table);
  const sessionItems = await scanAll(docClient, args.sessionTable);
  const s3Keys = await listAllS3Keys(s3, args.bucket);
  const queueUrls = await resolveQueueUrls(sqs);
  const queueCounts = new Map<string, { visible: number; notVisible: number }>();
  for (const [name, url] of queueUrls) queueCounts.set(name, await getQueueCounts(sqs, url));

  let cognitoUsernames: string[] = [];
  if (args.userPoolId) {
    const result = await cognito.send(new ListUsersCommand({ UserPoolId: args.userPoolId }));
    cognitoUsernames = (result.Users ?? []).map((u) => u.Username!).filter(Boolean);
  } else {
    console.log("[reset-dev-data] WARNING: --user-pool-id not provided, skipping Cognito inventory.");
  }

  const rawDir = join(process.cwd(), ".local-artifacts", "dev-reset", timestamp);
  await mkdir(rawDir, { recursive: true });
  await writeFile(join(rawDir, "main-table.json"), JSON.stringify(mainItems, null, 2));
  await writeFile(join(rawDir, "session-table.json"), JSON.stringify(sessionItems, null, 2));
  await writeFile(join(rawDir, "s3-keys.json"), JSON.stringify(s3Keys, null, 2));
  await writeFile(join(rawDir, "cognito-usernames.json"), JSON.stringify(cognitoUsernames, null, 2));
  await writeFile(join(rawDir, "queue-counts.json"), JSON.stringify(Object.fromEntries(queueCounts), null, 2));

  const manifest = {
    generatedAt: new Date().toISOString(),
    rawSnapshotPath: rawDir,
    table: buildManifestEntry(args.table, mainItems),
    sessionTable: buildManifestEntry(args.sessionTable, sessionItems),
    s3: { bucket: args.bucket, objectCount: s3Keys.length },
    cognito: { userPoolId: args.userPoolId, userCount: cognitoUsernames.length },
    queues: Object.fromEntries(queueCounts),
  };
  const manifestPath = join(
    process.cwd(),
    "docs/architecture/reviews/multi-user-b2b-wave-b2b12-scoping",
    `dev-reset-manifest-${timestamp}.json`,
  );
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[reset-dev-data] Phase A done. Raw snapshot: ${rawDir} (gitignored). Manifest: ${manifestPath}`);

  if (!args.confirm) {
    console.log("[reset-dev-data] --confirm not set — dry-run only, nothing deleted. Re-run with --confirm to execute Phase B.");
    return;
  }

  // --- Phase B: destructive delete, gated by --confirm + a successful Phase A snapshot --------
  console.log("[reset-dev-data] Phase B: deleting...");
  const mainDelete = await deleteAllItems((t, k) => realBatchWriteDelete(docClient, t, k), args.table, mainItems);
  const sessionDelete = await deleteAllItems((t, k) => realBatchWriteDelete(docClient, t, k), args.sessionTable, sessionItems);
  console.log(`[reset-dev-data] deleted ${mainDelete.deleted} items from ${args.table} (${mainDelete.batches} batches), ${sessionDelete.deleted} from ${args.sessionTable} (${sessionDelete.batches} batches)`);

  if (s3Keys.length > 0) {
    for (const batch of chunk(s3Keys, 1000)) {
      await s3.send(new DeleteObjectsCommand({ Bucket: args.bucket, Delete: { Objects: batch.map((Key) => ({ Key })) } }));
    }
    console.log(`[reset-dev-data] deleted ${s3Keys.length} objects from ${args.bucket}`);
  }

  for (const url of queueUrls.values()) {
    await sqs.send(new PurgeQueueCommand({ QueueUrl: url }));
  }
  console.log(`[reset-dev-data] purged ${queueUrls.size} queues`);

  if (args.includeCognito && args.userPoolId && cognitoUsernames.length > 0) {
    for (const username of cognitoUsernames) {
      await cognito.send(new AdminDeleteUserCommand({ UserPoolId: args.userPoolId, Username: username }));
    }
    console.log(`[reset-dev-data] deleted ${cognitoUsernames.length} Cognito users`);
  } else if (cognitoUsernames.length > 0) {
    console.log(`[reset-dev-data] NOT deleting ${cognitoUsernames.length} Cognito user(s) — pass --include-cognito explicitly to include them.`);
  }

  // --- Final verification (fail-loud, never a silent partial success) -------------------------
  console.log("[reset-dev-data] Phase B done. Running final verification...");
  const mainAfter = await scanAll(docClient, args.table);
  const sessionAfter = await scanAll(docClient, args.sessionTable);
  const finalCounts: Record<string, number> = { [args.table]: mainAfter.length, [args.sessionTable]: sessionAfter.length };
  for (const [name, url] of queueUrls) {
    const counts = await getQueueCounts(sqs, url);
    finalCounts[name] = counts.visible + counts.notVisible;
  }
  assertAllEmpty(finalCounts);
  console.log("[reset-dev-data] DONE — final verification confirms everything is empty.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[reset-dev-data] FAILED:", err);
    process.exitCode = 1;
  });
}
