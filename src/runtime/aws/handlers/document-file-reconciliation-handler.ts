/** Real handler for DocumentFileReconciliationWorker (EventBridge Scheduler, 15 min - same
 * cadence as `UploadSlotReconciliationWorker`, which it generalizes). D-163 §6/D-166. */
import { randomUUID } from "node:crypto";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildDocumentArchiveDeps } from "../composition/document-archive.js";
import { DynamoDbDocumentFileReconciliationCandidateSource } from "../../../workers/document-file-reconciliation/dynamodb-candidate-source.js";
import { reconcileTimedOutDocumentFiles } from "../../../workers/document-file-reconciliation/reconciliation.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableNameEnv = process.env["TABLE_NAME"];
if (!tableNameEnv) throw new Error("TABLE_NAME env var is required.");
const tableName: string = tableNameEnv;

// This handler only reads/writes DocumentFile/DocumentVersion rows via `store`/`ids` - never
// calls `reserveFiles()`, so the quarantine bucket parameter is unused here (same posture as
// requirement-reindex-handler.ts).
const { store, ids } = buildDocumentArchiveDeps(client, tableName, "");
const candidates = new DynamoDbDocumentFileReconciliationCandidateSource(client, tableName);
const logger = new SecureLogger({ baseContext: { service: "document-file-reconciliation" } });

export async function handler(): Promise<void> {
  await runWithContext({ correlationId: randomUUID() }, async () => {
    const result = await reconcileTimedOutDocumentFiles({ store, candidates, tableName, ids, now: () => new Date().toISOString() });
    logger.info("document-file-reconciliation complete", { ...result });
  });
}
