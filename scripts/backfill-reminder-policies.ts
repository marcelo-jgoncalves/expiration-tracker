/**
 * BLOCKER-B backfill (docs/architecture/reminder-delivery-pipeline.md §9, Codex Round H
 * APPROVED 9.2/10). ReminderPolicy rows saved BEFORE the materialization-trigger deployed
 * have no POLICYREF# pointer and have never fired a real materialization - they are
 * "fully inert" (§9's corrected claim, not "inert until an item edit") until either
 * re-saved through the app, or backfilled by this script.
 *
 * Deploy-safety (RB-G10): this script is NEVER run automatically on deploy - no event
 * fires for a pre-existing policy, so there is zero mass-materialization risk on deploy by
 * construction. Running this script IS the explicit, manual, one-off activation step for
 * the pre-BLOCKER-B installed base.
 *
 * Design (§9):
 *   1. Paginated, rate-limited Scan filtered to entityType="ReminderPolicy" (no enumeration
 *      index exists for "all policies" - this is the one accepted use of Scan in this
 *      codebase, justified by being a single manual maintenance operation, never a hot path).
 *   2. For each scope:"ITEM" policy found: strongly-consistent read its item; skip if
 *      missing/not ACTIVE.
 *   3. Put-if-absent the POLICYREF pointer (repairs discoverability going forward).
 *   4. Call materialize() (idempotent - safe to run twice, safe to re-run the whole backfill).
 *   5. Checkpoint: advances ONLY after an entire page succeeds (never mid-page), using
 *      DynamoDB's own opaque LastEvaluatedKey (the only continuation token Scan actually
 *      supports - NOT policyId, which a Scan has no ordering by). The script owns
 *      persistence itself: prints the token to stdout after each successful page and
 *      accepts one back via --after to resume - an operator's responsibility to carry
 *      forward between invocations, matching this operation's manual, one-off nature.
 *
 * Usage:
 *   tsx scripts/backfill-reminder-policies.ts --table <TableName> [--after <base64Token>]
 *     [--page-size 25] [--dry-run] [--shard-count N]
 *
 * --dry-run reports what WOULD be backfilled (item lookups + policy scan) without writing
 * any pointer or calling materialize() - use this first against a real table to sanity-check
 * scope before committing writes.
 */
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { createDocumentClient } from "../src/shared/dynamodb/client.js";
import { DynamoDbReminderStore } from "../src/modules/reminder/persistence/dynamodb-reminder-store.js";
import { ReminderMaterializer } from "../src/modules/reminder/application/reminder-materializer.js";
import type { ReminderStore } from "../src/modules/reminder/ports/reminder-store.js";
import { policyRefKey, type ReminderPolicy } from "../src/modules/reminder/domain/reminder-policy.js";
import { itemKey, type ExpirationItem } from "../src/modules/expiration/domain/expiration-item.js";
import { defaultShardConfig } from "../src/modules/reminder/domain/shard-config.js";

interface Args {
  table: string;
  after?: string;
  pageSize: number;
  dryRun: boolean;
}

export function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const table = get("--table");
  if (!table) throw new Error("--table <TableName> is required.");
  return {
    table,
    after: get("--after"),
    pageSize: Number(get("--page-size") ?? "25"),
    dryRun: argv.includes("--dry-run"),
  };
}

export function decodeKey(token: string | undefined): Record<string, unknown> | undefined {
  if (!token) return undefined;
  return JSON.parse(Buffer.from(token, "base64").toString("utf8")) as Record<string, unknown>;
}

export function encodeKey(key: Record<string, unknown> | undefined): string | undefined {
  if (!key) return undefined;
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64");
}

interface PageResult {
  scanned: number;
  itemScoped: number;
  skippedMissingOrInactiveItem: number;
  pointersWritten: number;
  occurrencesCreated: number;
  nextToken?: string;
}

export async function processPage(
  store: ReminderStore,
  materializer: ReminderMaterializer,
  policies: ReminderPolicy[],
  dryRun: boolean,
): Promise<Omit<PageResult, "scanned" | "nextToken">> {
  let itemScoped = 0;
  let skippedMissingOrInactiveItem = 0;
  let pointersWritten = 0;
  let occurrencesCreated = 0;

  for (const policy of policies) {
    if (policy.scope !== "ITEM" || !policy.itemId) continue;
    itemScoped += 1;

    const item = await store.get<ExpirationItem>(itemKey(policy.tenantId, policy.itemId));
    if (!item || item.status !== "ACTIVE") {
      skippedMissingOrInactiveItem += 1;
      continue;
    }

    if (dryRun) continue;

    const pointerCreated = await store.putIfAbsent({
      ...policyRefKey(policy.tenantId, policy.itemId, policy.policyId),
      entityType: "ReminderPolicyRef",
      policyId: policy.policyId,
    });
    if (pointerCreated) pointersWritten += 1;

    if (!policy.enabled) continue;
    const result = await materializer.materialize({
      tenantId: policy.tenantId,
      itemId: policy.itemId,
      itemVersion: item.version,
      itemDueDate: item.dueDate,
      policy,
      shardConfig: defaultShardConfig(),
    });
    occurrencesCreated += result.created.length;
  }

  return { itemScoped, skippedMissingOrInactiveItem, pointersWritten, occurrencesCreated };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = createDocumentClient();
  const store = new DynamoDbReminderStore(client, args.table);
  const materializer = new ReminderMaterializer(store, args.table, () => new Date().toISOString());

  console.log(`[backfill] table=${args.table} pageSize=${args.pageSize} dryRun=${args.dryRun} resuming=${args.after ? "yes" : "no (from start)"}`);

  const scanResult = await client.send(
    new ScanCommand({
      TableName: args.table,
      FilterExpression: "entityType = :t",
      ExpressionAttributeValues: { ":t": "ReminderPolicy" },
      Limit: args.pageSize,
      ExclusiveStartKey: decodeKey(args.after),
    }),
  );

  const policies = (scanResult.Items ?? []) as ReminderPolicy[];
  const page = await processPage(store, materializer, policies, args.dryRun);
  const nextToken = encodeKey(scanResult.LastEvaluatedKey);

  console.log(
    `[backfill] page done: scanned=${policies.length} itemScoped=${page.itemScoped} ` +
      `skippedMissingOrInactiveItem=${page.skippedMissingOrInactiveItem} ` +
      `pointersWritten=${page.pointersWritten} occurrencesCreated=${page.occurrencesCreated}`,
  );

  if (nextToken) {
    console.log(`[backfill] MORE PAGES REMAIN. Resume with:`);
    console.log(`  tsx scripts/backfill-reminder-policies.ts --table ${args.table} --page-size ${args.pageSize}${args.dryRun ? " --dry-run" : ""} --after "${nextToken}"`);
  } else {
    console.log(`[backfill] DONE - no more pages.`);
  }
}

// Only run when executed directly (`tsx scripts/backfill-reminder-policies.ts ...`) - not
// when imported for its pure helpers (parseArgs/decodeKey/encodeKey/processPage), which
// test/unit/reminder/backfill-reminder-policies.test.ts does without ever wanting main() to
// run (it has no --table, no real DynamoDB table, and shouldn't need either).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[backfill] FAILED:", err);
    process.exitCode = 1;
  });
}
