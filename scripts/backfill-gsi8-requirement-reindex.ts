/**
 * GSI8 backfill for requirement-reindex (D-179 slice 4, mirrors
 * `backfill-gsi8-document-file-reconciliation.ts` exactly). Writes the `GSI8PK`/`GSI8SK`
 * MaintenanceDueIndex pointer onto every pre-existing `Requirement` row `deriveRequirementMaintenanceDue()`
 * can compute a due date for (`status === "SATISFIED"` with an `evidenceValidUntil`) — includes
 * FUTURE due dates, not only already-overdue ones (D-179 Round 3->4's correction, same posture
 * every prior worker's backfill already applies).
 *
 * Deploy-safety, same posture as the 3 prior backfill scripts: never run automatically.
 *
 * Credential/role posture: runs with the operator's own `--profile claude-dev` credential, never
 * the worker Lambda's role (scoped by `LeadingKeys` to `WORK#REQUIREMENT_REINDEX`/
 * `DLQ#REQUIREMENT_REINDEX` only). `Scan`+`UpdateItem` on the base table only.
 *
 * Usage:
 *   tsx scripts/backfill-gsi8-requirement-reindex.ts --table <TableName>
 *     [--after <base64Token>] [--page-size 25] [--dry-run]
 *
 * --dry-run reports what WOULD be backfilled without writing any pointer.
 */
import { ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createDocumentClient } from "../src/shared/dynamodb/client.js";
import { deriveRequirementMaintenanceDue, requirementGsi8Keys, type Requirement } from "../src/modules/document-archive/domain/requirement.js";

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
 * conditional write, never to decide WHETHER to write (that's `deriveRequirementMaintenanceDue()`
 * alone, same pure function the real write path and the worker's own processing both use). */
export async function processPage(
  requirements: Requirement[],
  dryRun: boolean,
  writePointer: (r: Requirement, gsi8: { GSI8PK: string; GSI8SK: string }) => Promise<boolean>,
): Promise<PageResult> {
  let candidatesFound = 0;
  let pointersWritten = 0;
  let alreadyPointed = 0;

  for (const requirement of requirements) {
    const due = deriveRequirementMaintenanceDue(requirement.status, requirement.evidenceValidUntil);
    if (!due) continue;
    candidatesFound += 1;

    if (requirement.GSI8PK && requirement.GSI8SK) {
      alreadyPointed += 1;
      continue;
    }
    if (dryRun) continue;

    const gsi8 = requirementGsi8Keys({ dueAtIso: due.dueAtIso, tenantId: requirement.tenantId, requirementId: requirement.requirementId });
    const written = await writePointer(requirement, gsi8);
    if (written) pointersWritten += 1;
  }

  return { candidatesFound, pointersWritten, alreadyPointed };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = createDocumentClient();

  console.log(`[backfill-gsi8-requirement-reindex] table=${args.table} pageSize=${args.pageSize} dryRun=${args.dryRun} resuming=${args.after ? "yes" : "no (from start)"}`);

  const scanResult = await client.send(
    new ScanCommand({
      TableName: args.table,
      FilterExpression: "entityType = :t AND #status = :s",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":t": "Requirement", ":s": "SATISFIED" },
      Limit: args.pageSize,
      ExclusiveStartKey: decodeKey(args.after),
    }),
  );

  const requirements = (scanResult.Items ?? []) as Requirement[];
  const page = await processPage(requirements, args.dryRun, async (requirement, gsi8) => {
    try {
      await client.send(
        new UpdateCommand({
          TableName: args.table,
          Key: { PK: requirement.PK, SK: requirement.SK },
          UpdateExpression: "SET GSI8PK = :pk, GSI8SK = :sk",
          // Conditioned on the exact version this page observed - never overwrite a pointer a
          // concurrent write (a fresh linkEvidence/unlinkEvidence/updateRequirement) already set
          // correctly.
          ConditionExpression: "version = :v",
          ExpressionAttributeValues: { ":pk": gsi8.GSI8PK, ":sk": gsi8.GSI8SK, ":v": requirement.version },
        }),
      );
      return true;
    } catch (err) {
      if (typeof err === "object" && err !== null && "name" in err && (err as { name?: unknown }).name === "ConditionalCheckFailedException") {
        return false; // row changed concurrently - next backfill run (or the worker's own
        // processing) will see whatever the current real state is; never a fatal error here.
      }
      throw err;
    }
  });
  const nextToken = encodeKey(scanResult.LastEvaluatedKey);

  console.log(
    `[backfill-gsi8-requirement-reindex] page done: scannedByDynamo=${scanResult.ScannedCount ?? "?"} matchedRequirement=${requirements.length} ` +
      `candidatesFound=${page.candidatesFound} pointersWritten=${page.pointersWritten} alreadyPointed=${page.alreadyPointed}`,
  );

  if (nextToken) {
    console.log(`[backfill-gsi8-requirement-reindex] MORE PAGES REMAIN. Resume with:`);
    console.log(`  tsx scripts/backfill-gsi8-requirement-reindex.ts --table ${args.table} --page-size ${args.pageSize}${args.dryRun ? " --dry-run" : ""} --after "${nextToken}"`);
  } else {
    console.log(`[backfill-gsi8-requirement-reindex] DONE - no more pages.`);
  }
}

// Only run when executed directly - not when imported for its pure helpers (parseArgs/
// decodeKey/encodeKey/processPage), which a unit test can exercise without a real table.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[backfill-gsi8-requirement-reindex] FAILED:", err);
    process.exitCode = 1;
  });
}
