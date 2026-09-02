/**
 * GSI8 backfill for transient-purge (D-179/D-188 slice 7, mirrors
 * `backfill-gsi8-security-audit-purge.ts` exactly, adapted for TWO entity types with DIFFERENT
 * dynamics — see `shared/transient-purge-gsi8.ts`'s file header). Writes the `GSI8PK`/`GSI8SK`
 * MaintenanceDueIndex pointer onto every pre-existing `WebhookInbox`/`UploadSlot` row — covering
 * BOTH already-past-due rows AND rows whose due date hasn't even passed yet: a row created 5
 * minutes ago is still a real future candidate. Skipping it here would mean it never gets a
 * pointer at all (the live write path only stamps GSI8 at the specific writers listed below),
 * silently falling out of the index forever once its due date arrives — the same mistake D-179's
 * Round 4 correction guards against, repeated by every prior slice's own backfill script.
 *
 * A `RESERVED` `UploadSlot` is explicitly EXCLUDED — never a purge candidate, never gets a pointer
 * (same as the live write paths: `advance-after-evidence.ts`'s CONSUMED transition,
 * `upload-slot-reconciliation/reconciliation.ts`'s EXPIRED transition; `RELEASED` follows the same
 * "incomplete" 24h window as `EXPIRED` per `deriveUploadSlotMaintenanceDue`).
 *
 * Deploy-safety, same posture as every prior slice's backfill script: never run automatically.
 * This script is the explicit, manual, one-off step that activates GSI8 discovery for the
 * installed base of rows that predate this worker's migration off `Scan`.
 *
 * **Real `version` field on both entities** (unlike security-audit-purge's append-only family):
 * the conditioned write below re-asserts `version` exactly as observed this page — same OCC fence
 * `purge.ts`'s own delete uses.
 *
 * Credential/role posture: runs with the operator's own `--profile claude-dev` credential, never
 * the worker Lambda's role (scoped by `LeadingKeys` to `WORK#TRANSIENT`/`DLQ#TRANSIENT` only).
 * `Scan`+`UpdateItem` on the base table only.
 *
 * Usage:
 *   tsx scripts/backfill-gsi8-transient-purge.ts --table <TableName> [--after <base64Token>]
 *     [--page-size 25] [--dry-run]
 *
 * --dry-run reports what WOULD be backfilled without writing any pointer.
 */
import { ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { fileURLToPath } from "node:url";
import { createDocumentClient } from "../src/shared/dynamodb/client.js";
import { deriveWebhookInboxMaintenanceDue, deriveUploadSlotMaintenanceDue, transientPurgeGsi8Keys, type TransientGsi8EntityType } from "../src/shared/transient-purge-gsi8.js";
import type { UploadSlotStatus } from "../src/modules/document/domain/upload-slot.js";

interface TransientRow {
  PK: string;
  SK: string;
  entityType: TransientGsi8EntityType;
  tenantId: string;
  createdAt?: string;
  reservedAt?: string;
  status?: UploadSlotStatus;
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

/** Same pure derivation the worker/live writers use - `undefined` for a `WebhookInbox` missing
 * `createdAt`, a `UploadSlot` missing `reservedAt`/`status`, or a `RESERVED` `UploadSlot`
 * (never a candidate). Throws on a genuinely malformed row (missing required field for its own
 * entityType) rather than silently skipping it. */
export function deriveDue(row: TransientRow): { dueAtIso: string } | undefined {
  if (row.entityType === "WebhookInbox") {
    if (!row.createdAt) throw new Error(`backfill-gsi8-transient-purge: WebhookInbox row ${row.PK}/${row.SK} missing createdAt.`);
    return deriveWebhookInboxMaintenanceDue({ createdAt: row.createdAt });
  }
  if (!row.reservedAt || !row.status) {
    throw new Error(`backfill-gsi8-transient-purge: UploadSlot row ${row.PK}/${row.SK} missing reservedAt/status.`);
  }
  return deriveUploadSlotMaintenanceDue({ reservedAt: row.reservedAt, status: row.status });
}

interface PageResult {
  candidatesFound: number;
  pointersWritten: number;
  alreadyPointed: number;
  skippedNotCandidate: number;
}

/** Pure per-page logic (testable without AWS) - `client`/`table` are only used for the actual
 * conditional write, never to decide WHETHER to write (that's `deriveDue()` alone, same pure
 * function the real write paths and the worker's revalidation both use). */
export async function processPage(
  rows: TransientRow[],
  dryRun: boolean,
  writePointer: (row: TransientRow, gsi8: { GSI8PK: string; GSI8SK: string }) => Promise<boolean>,
): Promise<PageResult> {
  let candidatesFound = 0;
  let pointersWritten = 0;
  let alreadyPointed = 0;
  let skippedNotCandidate = 0;

  for (const row of rows) {
    const due = deriveDue(row);
    if (!due) {
      // RESERVED UploadSlot - never a candidate, never gets a pointer (same as the live write
      // paths, see file header).
      skippedNotCandidate += 1;
      continue;
    }
    candidatesFound += 1;

    if (row.GSI8PK && row.GSI8SK) {
      alreadyPointed += 1;
      continue;
    }
    if (dryRun) continue;

    const gsi8 = transientPurgeGsi8Keys({ dueAtIso: due.dueAtIso, tenantId: row.tenantId, entityType: row.entityType, sk: row.SK });
    const written = await writePointer(row, gsi8);
    if (written) pointersWritten += 1;
  }

  return { candidatesFound, pointersWritten, alreadyPointed, skippedNotCandidate };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = createDocumentClient();

  console.log(`[backfill-gsi8-transient-purge] table=${args.table} pageSize=${args.pageSize} dryRun=${args.dryRun} resuming=${args.after ? "yes" : "no (from start)"}`);

  const scanResult = await client.send(
    new ScanCommand({
      TableName: args.table,
      FilterExpression: "#entityType = :webhookInbox OR #entityType = :uploadSlot",
      ExpressionAttributeNames: { "#entityType": "entityType" },
      ExpressionAttributeValues: { ":webhookInbox": "WebhookInbox", ":uploadSlot": "UploadSlot" },
      Limit: args.pageSize,
      ExclusiveStartKey: decodeKey(args.after),
    }),
  );

  const rows = (scanResult.Items ?? []) as TransientRow[];
  const page = await processPage(rows, args.dryRun, async (row, gsi8) => {
    try {
      await client.send(
        new UpdateCommand({
          TableName: args.table,
          Key: { PK: row.PK, SK: row.SK },
          UpdateExpression: "SET GSI8PK = :pk, GSI8SK = :sk",
          // Conditioned on the exact version this page observed - never overwrite a pointer a
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
    `[backfill-gsi8-transient-purge] page done: scannedByDynamo=${scanResult.ScannedCount ?? "?"} matchedRows=${rows.length} ` +
      `candidatesFound=${page.candidatesFound} pointersWritten=${page.pointersWritten} alreadyPointed=${page.alreadyPointed} skippedNotCandidate(RESERVED)=${page.skippedNotCandidate}`,
  );

  if (nextToken) {
    console.log(`[backfill-gsi8-transient-purge] MORE PAGES REMAIN. Resume with:`);
    console.log(`  tsx scripts/backfill-gsi8-transient-purge.ts --table ${args.table} --page-size ${args.pageSize}${args.dryRun ? " --dry-run" : ""} --after "${nextToken}"`);
  } else {
    console.log(`[backfill-gsi8-transient-purge] DONE - no more pages.`);
  }
}

// Only run when executed directly - not when imported for its pure helpers (parseArgs/
// decodeKey/encodeKey/processPage/deriveDue), which a unit test can exercise without a real
// table. `fileURLToPath` (not a raw `file://${argv[1]}` string comparison) - the string-comparison
// form used by 6 sibling scripts never matches on Windows (AGENTS.md §4's shell notes, bug found/
// fixed for D-186, still open in those 6 - out of scope here).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("[backfill-gsi8-transient-purge] FAILED:", err);
    process.exitCode = 1;
  });
}
