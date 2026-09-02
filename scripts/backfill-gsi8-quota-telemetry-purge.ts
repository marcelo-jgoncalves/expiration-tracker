/**
 * GSI8 backfill for quota-telemetry-purge (D-179/D-186 slice 5, mirrors
 * `backfill-gsi8-invitation-purge.ts` exactly, adapted for TWO entity types and no `version`
 * field). Writes the `GSI8PK`/`GSI8SK` MaintenanceDueIndex pointer onto every pre-existing
 * `TenantQuota`/`EphemeralTelemetryMutation` row — covering BOTH already-past-due rows AND rows
 * whose `resetAt + 30 days` hasn't even passed yet: a fresh quota bucket created 5 minutes ago is
 * still a real future candidate. Skipping it here would mean it never gets a pointer at all (the
 * live write path only stamps GSI8 inside `consume()`/`incrementTelemetryCounter()` themselves),
 * silently falling out of the index forever once its due date arrives — the same mistake D-179's
 * Round 4 correction guards against.
 *
 * Deploy-safety, same posture as `backfill-gsi8-invitation-purge.ts`: never run automatically.
 * This script is the explicit, manual, one-off step that activates GSI8 discovery for the
 * installed base of rows that predate this worker's migration off `Scan`.
 *
 * **No `version` field** (unlike Invitation/Membership): the conditioned write below re-asserts
 * `resetAt` exactly as observed this page — same OCC fence `purge.ts`'s own delete uses, per
 * `quota.ts`'s `TenantQuotaRecord`/`EphemeralTelemetryRecord` docstrings.
 *
 * Credential/role posture: runs with the operator's own `--profile claude-dev` credential, never
 * the worker Lambda's role (scoped by `LeadingKeys` to `WORK#QUOTA_TELEMETRY`/
 * `DLQ#QUOTA_TELEMETRY` only). `Scan`+`UpdateItem` on the base table only.
 *
 * Usage:
 *   tsx scripts/backfill-gsi8-quota-telemetry-purge.ts --table <TableName> [--after <base64Token>]
 *     [--page-size 25] [--dry-run]
 *
 * --dry-run reports what WOULD be backfilled without writing any pointer.
 */
import { ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createDocumentClient } from "../src/shared/dynamodb/client.js";
import { deriveQuotaTelemetryMaintenanceDue, quotaTelemetryGsi8Keys } from "../src/modules/identity/application/quota.js";

interface QuotaTelemetryRow {
  PK: string;
  SK: string;
  entityType: "TenantQuota" | "EphemeralTelemetryMutation";
  tenantId: string;
  resetAt: string;
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
 * conditional write, never to decide WHETHER to write (that's `deriveQuotaTelemetryMaintenanceDue()`
 * alone, same pure function the real write path and the worker's revalidation both use). */
export async function processPage(
  rows: QuotaTelemetryRow[],
  dryRun: boolean,
  writePointer: (row: QuotaTelemetryRow, gsi8: { GSI8PK: string; GSI8SK: string }) => Promise<boolean>,
): Promise<PageResult> {
  let candidatesFound = 0;
  let pointersWritten = 0;
  let alreadyPointed = 0;

  for (const row of rows) {
    const due = deriveQuotaTelemetryMaintenanceDue(row);
    candidatesFound += 1;

    if (row.GSI8PK && row.GSI8SK) {
      alreadyPointed += 1;
      continue;
    }
    if (dryRun) continue;

    const gsi8 = quotaTelemetryGsi8Keys({ dueAtIso: due.dueAtIso, tenantId: row.tenantId, entityType: row.entityType, sk: row.SK });
    const written = await writePointer(row, gsi8);
    if (written) pointersWritten += 1;
  }

  return { candidatesFound, pointersWritten, alreadyPointed };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = createDocumentClient();

  console.log(`[backfill-gsi8-quota-telemetry-purge] table=${args.table} pageSize=${args.pageSize} dryRun=${args.dryRun} resuming=${args.after ? "yes" : "no (from start)"}`);

  const scanResult = await client.send(
    new ScanCommand({
      TableName: args.table,
      FilterExpression: "#entityType IN (:tenantQuota, :ephemeralTelemetry) AND attribute_exists(#resetAt)",
      ExpressionAttributeNames: { "#entityType": "entityType", "#resetAt": "resetAt" },
      ExpressionAttributeValues: { ":tenantQuota": "TenantQuota", ":ephemeralTelemetry": "EphemeralTelemetryMutation" },
      Limit: args.pageSize,
      ExclusiveStartKey: decodeKey(args.after),
    }),
  );

  const rows = (scanResult.Items ?? []) as QuotaTelemetryRow[];
  const page = await processPage(rows, args.dryRun, async (row, gsi8) => {
    try {
      await client.send(
        new UpdateCommand({
          TableName: args.table,
          Key: { PK: row.PK, SK: row.SK },
          UpdateExpression: "SET GSI8PK = :pk, GSI8SK = :sk",
          // Conditioned on the exact resetAt this page observed (no version field, see file
          // header) - never overwrite a pointer a concurrent write (e.g. a fresh consume() via
          // the real app) already set correctly.
          ConditionExpression: "resetAt = :resetAt",
          ExpressionAttributeValues: { ":pk": gsi8.GSI8PK, ":sk": gsi8.GSI8SK, ":resetAt": row.resetAt },
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
    `[backfill-gsi8-quota-telemetry-purge] page done: scannedByDynamo=${scanResult.ScannedCount ?? "?"} matchedRows=${rows.length} ` +
      `candidatesFound=${page.candidatesFound} pointersWritten=${page.pointersWritten} alreadyPointed=${page.alreadyPointed}`,
  );

  if (nextToken) {
    console.log(`[backfill-gsi8-quota-telemetry-purge] MORE PAGES REMAIN. Resume with:`);
    console.log(`  tsx scripts/backfill-gsi8-quota-telemetry-purge.ts --table ${args.table} --page-size ${args.pageSize}${args.dryRun ? " --dry-run" : ""} --after "${nextToken}"`);
  } else {
    console.log(`[backfill-gsi8-quota-telemetry-purge] DONE - no more pages.`);
  }
}

// Only run when executed directly - not when imported for its pure helpers (parseArgs/
// decodeKey/encodeKey/processPage), which a unit test can exercise without a real table.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[backfill-gsi8-quota-telemetry-purge] FAILED:", err);
    process.exitCode = 1;
  });
}
