/**
 * GSI8 backfill for core-user-data-purge (D-179/D-190, 9th and LAST slice, mirrors
 * `backfill-gsi8-delivery-record-purge.ts` closely, adapted for the `deletedAt`-TRANSITION fence
 * instead of a fixed `createdAt` clock). Writes the `GSI8PK`/`GSI8SK` MaintenanceDueIndex pointer
 * onto every pre-existing `ExpirationItem`/`ReminderPolicy` row that ALREADY has `deletedAt` set —
 * covering BOTH already-past-due rows AND rows whose `deletedAt + 30 days` hasn't even passed yet.
 * A row soft-deleted 2 days ago is exactly as real a candidate as one from 40 days ago; it just
 * has a `GSI8SK` in the future. Skipping it here would mean it never gets a pointer at all (the
 * live write path only stamps GSI8 at the moment of a NEW `deletedAt` transition — currently just
 * `expiration-service.ts#deleteItem`, see `shared/core-user-data-gsi8.ts`'s doc comment on
 * `ReminderPolicy`'s pre-existing gap), silently falling out of the index forever once its due
 * date arrives.
 *
 * Rows where `deletedAt` was NEVER set are NOT candidates and must NOT get a pointer at all — the
 * scan's own `attribute_exists(deletedAt)` filter enforces this at the source.
 *
 * Deploy-safety, same posture as every prior slice's backfill script: never run automatically.
 * This script is the explicit, manual, one-off step that activates GSI8 discovery for the
 * installed base of rows that predate this worker's migration off `Scan`.
 *
 * **`version` field present**: the conditioned write below re-asserts both `version` AND
 * `deletedAt` exactly as observed this page — same "unchanged since observed" fence `purge.ts`'s
 * own delete uses.
 *
 * Credential/role posture: runs with the operator's own `--profile claude-dev` credential, never
 * the worker Lambda's role (scoped by `LeadingKeys` to `WORK#CORE_USER_DATA`/`DLQ#CORE_USER_DATA`
 * only). `Scan`+`UpdateItem` on the base table only.
 *
 * Usage:
 *   tsx scripts/backfill-gsi8-core-user-data-purge.ts --table <TableName> [--after <base64Token>]
 *     [--page-size 25] [--dry-run]
 *
 * --dry-run reports what WOULD be backfilled without writing any pointer.
 */
import { ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { fileURLToPath } from "node:url";
import { createDocumentClient } from "../src/shared/dynamodb/client.js";
import { deriveCoreUserDataMaintenanceDue, coreUserDataGsi8Keys, type CoreUserDataGsi8EntityType } from "../src/shared/core-user-data-gsi8.js";

interface CoreUserDataRow {
  PK: string;
  SK: string;
  entityType: CoreUserDataGsi8EntityType;
  tenantId: string;
  deletedAt: string;
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
 * conditional write, never to decide WHETHER to write (that's `deriveCoreUserDataMaintenanceDue()`
 * alone, same pure function the real write path and the worker's revalidation both use). Rows
 * without `deletedAt` set never reach here at all (the base scan's own filter excludes them), but
 * `deriveCoreUserDataMaintenanceDue()` is still the single source of truth for "is this even a
 * candidate" — defense in depth, never assumed from the scan filter alone. */
export async function processPage(
  rows: CoreUserDataRow[],
  dryRun: boolean,
  writePointer: (row: CoreUserDataRow, gsi8: { GSI8PK: string; GSI8SK: string }) => Promise<boolean>,
): Promise<PageResult> {
  let candidatesFound = 0;
  let pointersWritten = 0;
  let alreadyPointed = 0;

  for (const row of rows) {
    const due = deriveCoreUserDataMaintenanceDue({ deletedAt: row.deletedAt });
    if (!due.dueAtIso) continue; // never a candidate before deletedAt is set
    candidatesFound += 1;

    if (row.GSI8PK && row.GSI8SK) {
      alreadyPointed += 1;
      continue;
    }
    if (dryRun) continue;

    const gsi8 = coreUserDataGsi8Keys({ dueAtIso: due.dueAtIso, tenantId: row.tenantId, entityType: row.entityType, sk: row.SK });
    const written = await writePointer(row, gsi8);
    if (written) pointersWritten += 1;
  }

  return { candidatesFound, pointersWritten, alreadyPointed };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = createDocumentClient();

  console.log(`[backfill-gsi8-core-user-data-purge] table=${args.table} pageSize=${args.pageSize} dryRun=${args.dryRun} resuming=${args.after ? "yes" : "no (from start)"}`);

  const scanResult = await client.send(
    new ScanCommand({
      TableName: args.table,
      FilterExpression: "(#entityType = :item OR #entityType = :policy) AND attribute_exists(#deletedAt)",
      ExpressionAttributeNames: { "#entityType": "entityType", "#deletedAt": "deletedAt" },
      ExpressionAttributeValues: { ":item": "ExpirationItem", ":policy": "ReminderPolicy" },
      Limit: args.pageSize,
      ExclusiveStartKey: decodeKey(args.after),
    }),
  );

  const rows = (scanResult.Items ?? []) as CoreUserDataRow[];
  const page = await processPage(rows, args.dryRun, async (row, gsi8) => {
    try {
      await client.send(
        new UpdateCommand({
          TableName: args.table,
          Key: { PK: row.PK, SK: row.SK },
          UpdateExpression: "SET GSI8PK = :pk, GSI8SK = :sk",
          // Conditioned on the exact version AND deletedAt this page observed - never overwrite a
          // pointer a concurrent write already set correctly, and never stamp a pointer onto a row
          // that got restored between the scan and this write.
          ConditionExpression: "version = :version AND deletedAt = :deletedAt",
          ExpressionAttributeValues: { ":pk": gsi8.GSI8PK, ":sk": gsi8.GSI8SK, ":version": row.version, ":deletedAt": row.deletedAt },
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
    `[backfill-gsi8-core-user-data-purge] page done: scannedByDynamo=${scanResult.ScannedCount ?? "?"} matchedRows=${rows.length} ` +
      `candidatesFound=${page.candidatesFound} pointersWritten=${page.pointersWritten} alreadyPointed=${page.alreadyPointed}`,
  );

  if (nextToken) {
    console.log(`[backfill-gsi8-core-user-data-purge] MORE PAGES REMAIN. Resume with:`);
    console.log(`  tsx scripts/backfill-gsi8-core-user-data-purge.ts --table ${args.table} --page-size ${args.pageSize}${args.dryRun ? " --dry-run" : ""} --after "${nextToken}"`);
  } else {
    console.log(`[backfill-gsi8-core-user-data-purge] DONE - no more pages.`);
  }
}

// Only run when executed directly - not when imported for its pure helpers (parseArgs/
// decodeKey/encodeKey/processPage), which a unit test can exercise without a real table.
// `fileURLToPath` (not a raw `file://${argv[1]}` string comparison) - the string-comparison form
// used by 6 sibling scripts never matches on Windows (AGENTS.md §4's shell notes).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("[backfill-gsi8-core-user-data-purge] FAILED:", err);
    process.exitCode = 1;
  });
}
