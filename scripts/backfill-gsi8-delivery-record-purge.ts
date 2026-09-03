/**
 * GSI8 backfill for delivery-record-purge (D-179/D-18x slice 8, mirrors
 * `backfill-gsi8-security-audit-purge.ts` closely, adapted for TWO entity types
 * (`NotificationIntent`/`NotificationAttempt`) and the `createdAt` fence with a real `version`
 * OCC counter present on both entities instead of none). Writes the `GSI8PK`/`GSI8SK`
 * MaintenanceDueIndex pointer onto every pre-existing `NotificationIntent`/`NotificationAttempt`
 * row — covering BOTH already-past-due rows AND rows whose `createdAt + 180 days` hasn't even
 * passed yet: a notification intent created 5 minutes ago is still a real future candidate.
 * Skipping it here would mean it never gets a pointer at all (the live write path only stamps
 * GSI8 at each of the 3 real creation sites - `reminder-dispatch/dispatch.ts`,
 * `notification-router-workflow.ts`'s `applyStaleDecision`/`applyRoutedDecision`), silently
 * falling out of the index forever once its due date arrives.
 *
 * Deploy-safety, same posture as every prior slice's backfill script: never run automatically.
 * This script is the explicit, manual, one-off step that activates GSI8 discovery for the
 * installed base of rows that predate this worker's migration off `Scan`.
 *
 * **`version` field present** (difference from security-audit-purge's 4 entities, which carry
 * none): the conditioned write below re-asserts `version` exactly as observed this page, the same
 * OCC fence `purge.ts`'s own delete uses - both entities are updated after creation in OTHER code
 * paths (router/delivery workflows), so `version` (not just `createdAt`) is the correct
 * "unchanged since observed" fence.
 *
 * **Known, accepted, out-of-scope gap (D-152)**: `NotificationAttemptLookup` is a derived
 * pointer this worker never purges - this backfill does not touch it either, same scope boundary
 * as the worker itself.
 *
 * Credential/role posture: runs with the operator's own `--profile claude-dev` credential, never
 * the worker Lambda's role (scoped by `LeadingKeys` to `WORK#DELIVERY_RECORD`/
 * `DLQ#DELIVERY_RECORD` only). `Scan`+`UpdateItem` on the base table only.
 *
 * Usage:
 *   tsx scripts/backfill-gsi8-delivery-record-purge.ts --table <TableName> [--after <base64Token>]
 *     [--page-size 25] [--dry-run]
 *
 * --dry-run reports what WOULD be backfilled without writing any pointer.
 */
import { ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { fileURLToPath } from "node:url";
import { createDocumentClient } from "../src/shared/dynamodb/client.js";
import { deriveDeliveryRecordMaintenanceDue, deliveryRecordGsi8Keys, type DeliveryRecordGsi8EntityType } from "../src/shared/delivery-record-gsi8.js";

interface DeliveryRecordRow {
  PK: string;
  SK: string;
  entityType: DeliveryRecordGsi8EntityType;
  tenantId: string;
  createdAt: string;
  version: number;
  GSI8PK?: string;
  GSI8SK?: string;
}

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
  candidatesFound: number;
  pointersWritten: number;
  alreadyPointed: number;
}

/** Pure per-page logic (testable without AWS) - `client`/`table` are only used for the actual
 * conditional write, never to decide WHETHER to write (that's `deriveDeliveryRecordMaintenanceDue()`
 * alone, same pure function the real write path and the worker's revalidation both use). */
export async function processPage(
  rows: DeliveryRecordRow[],
  dryRun: boolean,
  writePointer: (row: DeliveryRecordRow, gsi8: { GSI8PK: string; GSI8SK: string }) => Promise<boolean>,
): Promise<PageResult> {
  let candidatesFound = 0;
  let pointersWritten = 0;
  let alreadyPointed = 0;

  for (const row of rows) {
    const due = deriveDeliveryRecordMaintenanceDue({ createdAt: row.createdAt });
    candidatesFound += 1;

    if (row.GSI8PK && row.GSI8SK) {
      alreadyPointed += 1;
      continue;
    }
    if (dryRun) continue;

    const gsi8 = deliveryRecordGsi8Keys({ dueAtIso: due.dueAtIso, tenantId: row.tenantId, entityType: row.entityType, sk: row.SK });
    const written = await writePointer(row, gsi8);
    if (written) pointersWritten += 1;
  }

  return { candidatesFound, pointersWritten, alreadyPointed };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = createDocumentClient();

  console.log(`[backfill-gsi8-delivery-record-purge] table=${args.table} pageSize=${args.pageSize} dryRun=${args.dryRun} resuming=${args.after ? "yes" : "no (from start)"}`);

  const scanResult = await client.send(
    new ScanCommand({
      TableName: args.table,
      FilterExpression: "(#entityType = :intent OR #entityType = :attempt) AND attribute_exists(#createdAt)",
      ExpressionAttributeNames: { "#entityType": "entityType", "#createdAt": "createdAt" },
      ExpressionAttributeValues: { ":intent": "NotificationIntent", ":attempt": "NotificationAttempt" },
      Limit: args.pageSize,
      ExclusiveStartKey: decodeKey(args.after),
    }),
  );

  const rows = (scanResult.Items ?? []) as DeliveryRecordRow[];
  const page = await processPage(rows, args.dryRun, async (row, gsi8) => {
    try {
      await client.send(
        new UpdateCommand({
          TableName: args.table,
          Key: { PK: row.PK, SK: row.SK },
          UpdateExpression: "SET GSI8PK = :pk, GSI8SK = :sk",
          // Conditioned on the exact version this page observed (both entities carry a real OCC
          // counter, unlike security-audit-purge's 4 entities) - never overwrite a pointer a
          // concurrent write already set correctly.
          ConditionExpression: "version = :version",
          ExpressionAttributeValues: { ":pk": gsi8.GSI8PK, ":sk": gsi8.GSI8SK, ":version": row.version },
        }),
      );
      return true;
    } catch (err) {
      if (typeof err === "object" && err !== null && "name" in err && (err as { name?: unknown }).name === "ConditionalCheckFailedException") {
        return false; // row changed concurrently - next backfill run (or the worker's own
        // revalidation) will see whatever the current real state is; never a fatal error here.
      }
      throw err;
    }
  });
  const nextToken = encodeKey(scanResult.LastEvaluatedKey);

  console.log(
    `[backfill-gsi8-delivery-record-purge] page done: scannedByDynamo=${scanResult.ScannedCount ?? "?"} matchedRows=${rows.length} ` +
      `candidatesFound=${page.candidatesFound} pointersWritten=${page.pointersWritten} alreadyPointed=${page.alreadyPointed}`,
  );

  if (nextToken) {
    console.log(`[backfill-gsi8-delivery-record-purge] MORE PAGES REMAIN. Resume with:`);
    console.log(`  tsx scripts/backfill-gsi8-delivery-record-purge.ts --table ${args.table} --page-size ${args.pageSize}${args.dryRun ? " --dry-run" : ""} --after "${nextToken}"`);
  } else {
    console.log(`[backfill-gsi8-delivery-record-purge] DONE - no more pages.`);
  }
}

// Only run when executed directly - not when imported for its pure helpers (parseArgs/
// decodeKey/encodeKey/processPage), which a unit test can exercise without a real table.
// `fileURLToPath` (not a raw `file://${argv[1]}` string comparison) - the string-comparison form
// used by 6 sibling scripts never matches on Windows (AGENTS.md §4's shell notes).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("[backfill-gsi8-delivery-record-purge] FAILED:", err);
    process.exitCode = 1;
  });
}
