/**
 * GSI8 backfill for document-file-reconciliation (D-179 slice 3, mirrors
 * `backfill-gsi8-invitation-purge.ts` exactly). Writes the `GSI8PK`/`GSI8SK` MaintenanceDueIndex
 * pointer onto every pre-existing `DocumentFile` row still `PENDING_UPLOAD`/`SCANNING` that
 * `deriveDocumentFileMaintenanceDue()` can compute a due date for.
 *
 * Real-world relevance is narrow but not zero: before this migration, `reserveFiles()` never
 * wrote ANY reconciliation pointer at all (the old `fileReconciliationGsi5Keys()` mechanism had
 * no caller — see `document-file.ts`'s doc comment) — so any row created before this slice
 * deployed is exactly as unreachable today as it was under the old GSI5 mechanism, until this
 * script runs once.
 *
 * Deploy-safety, same posture as `backfill-gsi8-invitation-purge.ts`: never run automatically.
 *
 * Credential/role posture: runs with the operator's own `--profile claude-dev` credential, never
 * the worker Lambda's role (scoped by `LeadingKeys` to `WORK#DOCUMENT_FILE_RECONCILIATION`/
 * `DLQ#DOCUMENT_FILE_RECONCILIATION` only). `Scan`+`UpdateItem` on the base table only.
 *
 * Usage:
 *   tsx scripts/backfill-gsi8-document-file-reconciliation.ts --table <TableName>
 *     [--after <base64Token>] [--page-size 25] [--dry-run]
 *
 * --dry-run reports what WOULD be backfilled without writing any pointer.
 */
import { fileURLToPath } from "node:url";
import { ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createDocumentClient } from "../src/shared/dynamodb/client.js";
import { deriveDocumentFileMaintenanceDue, documentFileGsi8Keys, type DocumentFile } from "../src/modules/document-archive/domain/document-file.js";

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
 * conditional write, never to decide WHETHER to write (that's `deriveDocumentFileMaintenanceDue()`
 * alone, same pure function the real write path and the worker's own processing both use). */
export async function processPage(
  files: DocumentFile[],
  dryRun: boolean,
  writePointer: (f: DocumentFile, gsi8: { GSI8PK: string; GSI8SK: string }) => Promise<boolean>,
): Promise<PageResult> {
  let candidatesFound = 0;
  let pointersWritten = 0;
  let alreadyPointed = 0;

  for (const file of files) {
    const due = deriveDocumentFileMaintenanceDue(file);
    if (!due) continue;
    candidatesFound += 1;

    if (file.GSI8PK && file.GSI8SK) {
      alreadyPointed += 1;
      continue;
    }
    if (dryRun) continue;

    const gsi8 = documentFileGsi8Keys({ dueAtIso: due.dueAtIso, tenantId: file.tenantId, fileId: file.fileId });
    const written = await writePointer(file, gsi8);
    if (written) pointersWritten += 1;
  }

  return { candidatesFound, pointersWritten, alreadyPointed };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = createDocumentClient();

  console.log(`[backfill-gsi8-document-file-reconciliation] table=${args.table} pageSize=${args.pageSize} dryRun=${args.dryRun} resuming=${args.after ? "yes" : "no (from start)"}`);

  const scanResult = await client.send(
    new ScanCommand({
      TableName: args.table,
      FilterExpression: "entityType = :t",
      ExpressionAttributeValues: { ":t": "DocumentFile" },
      Limit: args.pageSize,
      ExclusiveStartKey: decodeKey(args.after),
    }),
  );

  const files = (scanResult.Items ?? []) as DocumentFile[];
  const page = await processPage(files, args.dryRun, async (file, gsi8) => {
    try {
      await client.send(
        new UpdateCommand({
          TableName: args.table,
          Key: { PK: file.PK, SK: file.SK },
          UpdateExpression: "SET GSI8PK = :pk, GSI8SK = :sk",
          // Conditioned on the exact version this page observed - never overwrite a pointer a
          // concurrent write (a fresh reserveFiles()/terminal transition) already set correctly.
          ConditionExpression: "version = :v",
          ExpressionAttributeValues: { ":pk": gsi8.GSI8PK, ":sk": gsi8.GSI8SK, ":v": file.version },
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
    `[backfill-gsi8-document-file-reconciliation] page done: scannedByDynamo=${scanResult.ScannedCount ?? "?"} matchedDocumentFile=${files.length} ` +
      `candidatesFound=${page.candidatesFound} pointersWritten=${page.pointersWritten} alreadyPointed=${page.alreadyPointed}`,
  );

  if (nextToken) {
    console.log(`[backfill-gsi8-document-file-reconciliation] MORE PAGES REMAIN. Resume with:`);
    console.log(`  tsx scripts/backfill-gsi8-document-file-reconciliation.ts --table ${args.table} --page-size ${args.pageSize}${args.dryRun ? " --dry-run" : ""} --after "${nextToken}"`);
  } else {
    console.log(`[backfill-gsi8-document-file-reconciliation] DONE - no more pages.`);
  }
}

// Only run when executed directly - not when imported for its pure helpers (parseArgs/
// decodeKey/encodeKey/processPage), which a unit test can exercise without a real table.
// `fileURLToPath` (not a raw `file://${argv[1]}` string comparison) - the string-comparison form
// never matches on Windows (AGENTS.md §4's shell notes).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("[backfill-gsi8-document-file-reconciliation] FAILED:", err);
    process.exitCode = 1;
  });
}
