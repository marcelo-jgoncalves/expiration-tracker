/**
 * GSI8 backfill for security-audit-purge (D-179/D-187 slice 6, mirrors
 * `backfill-gsi8-quota-telemetry-purge.ts` exactly, adapted for FOUR entity types and the
 * `occurredAt` fence instead of `resetAt`). Writes the `GSI8PK`/`GSI8SK` MaintenanceDueIndex
 * pointer onto every pre-existing `AuditEvent`/`MembershipAuditEvent`/`SubjectAuditEvent`/
 * `TenantAuditEvent` row — covering BOTH already-past-due rows AND rows whose
 * `occurredAt + 365 days` hasn't even passed yet: an audit event created 5 minutes ago is still a
 * real future candidate. Skipping it here would mean it never gets a pointer at all (the live
 * write path only stamps GSI8 inside each entity's own `build*Event()`), silently falling out of
 * the index forever once its due date arrives — the same mistake D-179's Round 4 correction
 * guards against, repeated by every prior slice's own backfill script.
 *
 * Deploy-safety, same posture as every prior slice's backfill script: never run automatically.
 * This script is the explicit, manual, one-off step that activates GSI8 discovery for the
 * installed base of rows that predate this worker's migration off `Scan`.
 *
 * **No `version` field** (same as every `AuditEvent`-family entity): the conditioned write below
 * re-asserts `occurredAt` exactly as observed this page — same OCC fence `purge.ts`'s own delete
 * uses, per each domain file's own docstring (append-only, no `update()`/`delete()` exported).
 *
 * **`MembershipAuditEvent` normalization**: it carries `organizationId`, not `tenantId` (same
 * value, different field name — see `security-audit-purge/candidate-source.ts`'s doc comment).
 * Normalized to `tenantId` here, the one place a raw base-table row is read.
 *
 * Credential/role posture: runs with the operator's own `--profile claude-dev` credential, never
 * the worker Lambda's role (scoped by `LeadingKeys` to `WORK#SECURITY_AUDIT`/
 * `DLQ#SECURITY_AUDIT` only). `Scan`+`UpdateItem` on the base table only.
 *
 * Usage:
 *   tsx scripts/backfill-gsi8-security-audit-purge.ts --table <TableName> [--after <base64Token>]
 *     [--page-size 25] [--dry-run]
 *
 * --dry-run reports what WOULD be backfilled without writing any pointer.
 */
import { ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { fileURLToPath } from "node:url";
import { createDocumentClient } from "../src/shared/dynamodb/client.js";
import { deriveSecurityAuditMaintenanceDue, securityAuditGsi8Keys, type SecurityAuditGsi8EntityType } from "../src/shared/security-audit-gsi8.js";

interface SecurityAuditRow {
  PK: string;
  SK: string;
  entityType: SecurityAuditGsi8EntityType;
  tenantId?: string;
  organizationId?: string;
  occurredAt: string;
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

/** `organizationId` -> `tenantId` normalization for `MembershipAuditEvent` (same mapping as the
 * worker's own dynamodb-candidate-source.ts). Throws rather than silently backfilling a malformed
 * row missing both fields. */
export function normalizeTenantId(row: SecurityAuditRow): string {
  const tenantId = row.tenantId ?? row.organizationId;
  if (!tenantId) {
    throw new Error(`backfill-gsi8-security-audit-purge: row ${row.PK}/${row.SK} has neither tenantId nor organizationId.`);
  }
  return tenantId;
}

interface PageResult {
  candidatesFound: number;
  pointersWritten: number;
  alreadyPointed: number;
}

/** Pure per-page logic (testable without AWS) - `client`/`table` are only used for the actual
 * conditional write, never to decide WHETHER to write (that's `deriveSecurityAuditMaintenanceDue()`
 * alone, same pure function the real write path and the worker's revalidation both use). */
export async function processPage(
  rows: SecurityAuditRow[],
  dryRun: boolean,
  writePointer: (row: SecurityAuditRow, gsi8: { GSI8PK: string; GSI8SK: string }) => Promise<boolean>,
): Promise<PageResult> {
  let candidatesFound = 0;
  let pointersWritten = 0;
  let alreadyPointed = 0;

  for (const row of rows) {
    const due = deriveSecurityAuditMaintenanceDue({ occurredAt: row.occurredAt });
    candidatesFound += 1;

    if (row.GSI8PK && row.GSI8SK) {
      alreadyPointed += 1;
      continue;
    }
    if (dryRun) continue;

    const gsi8 = securityAuditGsi8Keys({ dueAtIso: due.dueAtIso, tenantId: normalizeTenantId(row), entityType: row.entityType, sk: row.SK });
    const written = await writePointer(row, gsi8);
    if (written) pointersWritten += 1;
  }

  return { candidatesFound, pointersWritten, alreadyPointed };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = createDocumentClient();

  console.log(`[backfill-gsi8-security-audit-purge] table=${args.table} pageSize=${args.pageSize} dryRun=${args.dryRun} resuming=${args.after ? "yes" : "no (from start)"}`);

  const scanResult = await client.send(
    new ScanCommand({
      TableName: args.table,
      FilterExpression:
        "(#entityType = :audit OR #entityType = :membership OR #entityType = :subject OR #entityType = :tenant) AND attribute_exists(#occurredAt)",
      ExpressionAttributeNames: { "#entityType": "entityType", "#occurredAt": "occurredAt" },
      ExpressionAttributeValues: {
        ":audit": "AuditEvent",
        ":membership": "MembershipAuditEvent",
        ":subject": "SubjectAuditEvent",
        ":tenant": "TenantAuditEvent",
      },
      Limit: args.pageSize,
      ExclusiveStartKey: decodeKey(args.after),
    }),
  );

  const rows = (scanResult.Items ?? []) as SecurityAuditRow[];
  const page = await processPage(rows, args.dryRun, async (row, gsi8) => {
    try {
      await client.send(
        new UpdateCommand({
          TableName: args.table,
          Key: { PK: row.PK, SK: row.SK },
          UpdateExpression: "SET GSI8PK = :pk, GSI8SK = :sk",
          // Conditioned on the exact occurredAt this page observed (no version field, see file
          // header) - never overwrite a pointer a concurrent write already set correctly.
          ConditionExpression: "occurredAt = :occurredAt",
          ExpressionAttributeValues: { ":pk": gsi8.GSI8PK, ":sk": gsi8.GSI8SK, ":occurredAt": row.occurredAt },
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
    `[backfill-gsi8-security-audit-purge] page done: scannedByDynamo=${scanResult.ScannedCount ?? "?"} matchedRows=${rows.length} ` +
      `candidatesFound=${page.candidatesFound} pointersWritten=${page.pointersWritten} alreadyPointed=${page.alreadyPointed}`,
  );

  if (nextToken) {
    console.log(`[backfill-gsi8-security-audit-purge] MORE PAGES REMAIN. Resume with:`);
    console.log(`  tsx scripts/backfill-gsi8-security-audit-purge.ts --table ${args.table} --page-size ${args.pageSize}${args.dryRun ? " --dry-run" : ""} --after "${nextToken}"`);
  } else {
    console.log(`[backfill-gsi8-security-audit-purge] DONE - no more pages.`);
  }
}

// Only run when executed directly - not when imported for its pure helpers (parseArgs/
// decodeKey/encodeKey/processPage/normalizeTenantId), which a unit test can exercise without a
// real table. `fileURLToPath` (not a raw `file://${argv[1]}` string comparison) - the
// string-comparison form used by 6 sibling scripts never matches on Windows (AGENTS.md §4's shell
// notes, bug found/fixed for D-186, still open in those 6 - out of scope here).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("[backfill-gsi8-security-audit-purge] FAILED:", err);
    process.exitCode = 1;
  });
}
