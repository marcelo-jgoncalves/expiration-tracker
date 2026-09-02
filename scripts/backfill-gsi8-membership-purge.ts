/**
 * GSI8 backfill for membership-purge (D-179/D-180 pilot slice, design §1/§3). Writes the
 * `GSI8PK`/`GSI8SK` MaintenanceDueIndex pointer onto every pre-existing `Membership` row that
 * `deriveMembershipMaintenanceDue()` can compute a due date for — NOT only the ones already past
 * their 30-day retention window. A `REMOVED` row from 2 days ago is exactly as real a candidate as
 * one from 40 days ago; it just has a `GSI8SK` in the future. Skipping it here would mean it never
 * gets a pointer at all (the write path only stamps GSI8 at the moment of a NEW removal), silently
 * falling out of the index forever once its due date arrives — the exact mistake the approved
 * design's Round 3 made and Round 4 corrected (estado-final-consolidado.md item 6).
 *
 * Deploy-safety, same posture as `backfill-reminder-policies.ts`: never run automatically. This
 * script is the explicit, manual, one-off step that activates GSI8 discovery for the installed
 * base of `Membership` rows that predate this worker's migration off `Scan`.
 *
 * Credential/role posture (design §3): runs with the operator's own `--profile claude-dev`
 * credential, never the worker Lambda's role (which is deliberately scoped by `LeadingKeys` to
 * `WORK#MEMBERSHIP_PURGE`/`DLQ#MEMBERSHIP_PURGE` only and would be unable to `Scan` the base
 * table or write an arbitrary pointer this broadly). `Scan`+`UpdateItem` on the base table only —
 * no GSI3/GSI4/GSI6 access needed.
 *
 * Usage:
 *   tsx scripts/backfill-gsi8-membership-purge.ts --table <TableName> [--after <base64Token>]
 *     [--page-size 25] [--dry-run]
 *
 * --dry-run reports what WOULD be backfilled without writing any pointer - use this first
 * against a real table to sanity-check scope before committing writes.
 */
import { ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createDocumentClient } from "../src/shared/dynamodb/client.js";
import { deriveMembershipMaintenanceDue, membershipGsi8Keys, type Membership } from "../src/modules/organization/domain/membership.js";

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
 * conditional write, never to decide WHETHER to write (that's `deriveMembershipMaintenanceDue()`
 * alone, same pure function the real write path and the worker's revalidation both use). */
export async function processPage(
  memberships: Membership[],
  dryRun: boolean,
  writePointer: (m: Membership, gsi8: { GSI8PK: string; GSI8SK: string }) => Promise<boolean>,
): Promise<PageResult> {
  let candidatesFound = 0;
  let pointersWritten = 0;
  let alreadyPointed = 0;

  for (const membership of memberships) {
    const due = deriveMembershipMaintenanceDue(membership);
    if (!due) continue;
    candidatesFound += 1;

    if (membership.GSI8PK && membership.GSI8SK) {
      alreadyPointed += 1;
      continue;
    }
    if (dryRun) continue;

    const gsi8 = membershipGsi8Keys({ dueAtIso: due.dueAtIso, tenantId: membership.organizationId, membershipId: membership.membershipId });
    const written = await writePointer(membership, gsi8);
    if (written) pointersWritten += 1;
  }

  return { candidatesFound, pointersWritten, alreadyPointed };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = createDocumentClient();

  console.log(`[backfill-gsi8-membership-purge] table=${args.table} pageSize=${args.pageSize} dryRun=${args.dryRun} resuming=${args.after ? "yes" : "no (from start)"}`);

  const scanResult = await client.send(
    new ScanCommand({
      TableName: args.table,
      FilterExpression: "entityType = :t",
      ExpressionAttributeValues: { ":t": "Membership" },
      Limit: args.pageSize,
      ExclusiveStartKey: decodeKey(args.after),
    }),
  );

  const memberships = (scanResult.Items ?? []) as Membership[];
  const page = await processPage(memberships, args.dryRun, async (membership, gsi8) => {
    try {
      await client.send(
        new UpdateCommand({
          TableName: args.table,
          Key: { PK: membership.PK, SK: membership.SK },
          UpdateExpression: "SET GSI8PK = :pk, GSI8SK = :sk",
          // Conditioned on the exact version this page observed - never overwrite a pointer a
          // concurrent write (e.g. a fresh removal via the real app) already set correctly in
          // the meantime.
          ConditionExpression: "version = :v",
          ExpressionAttributeValues: { ":pk": gsi8.GSI8PK, ":sk": gsi8.GSI8SK, ":v": membership.version },
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
    `[backfill-gsi8-membership-purge] page done: scannedByDynamo=${scanResult.ScannedCount ?? "?"} matchedMembership=${memberships.length} ` +
      `candidatesFound=${page.candidatesFound} pointersWritten=${page.pointersWritten} alreadyPointed=${page.alreadyPointed}`,
  );

  if (nextToken) {
    console.log(`[backfill-gsi8-membership-purge] MORE PAGES REMAIN. Resume with:`);
    console.log(`  tsx scripts/backfill-gsi8-membership-purge.ts --table ${args.table} --page-size ${args.pageSize}${args.dryRun ? " --dry-run" : ""} --after "${nextToken}"`);
  } else {
    console.log(`[backfill-gsi8-membership-purge] DONE - no more pages.`);
  }
}

// Only run when executed directly - not when imported for its pure helpers (parseArgs/
// decodeKey/encodeKey/processPage), which a unit test can exercise without a real table.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[backfill-gsi8-membership-purge] FAILED:", err);
    process.exitCode = 1;
  });
}
