/** Real handler for UploadSlotReconciliationWorker (EventBridge Scheduler, 15 min). M6 design §3.5. */
import { randomUUID } from "node:crypto";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildDocumentCandidateSource } from "../composition/document.js";
import { DynamoDbDocumentStore } from "../../../modules/document/persistence/dynamodb-document-store.js";
import { buildIdentityDeps } from "../composition/identity.js";
import { reconcileExpiredUploadSlots } from "../../../workers/upload-slot-reconciliation/reconciliation.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableNameEnv = process.env["TABLE_NAME"];
if (!tableNameEnv) throw new Error("TABLE_NAME env var is required.");
const tableName: string = tableNameEnv;

const store = new DynamoDbDocumentStore(client, tableName);
const candidates = buildDocumentCandidateSource(client, tableName);
const { quota } = buildIdentityDeps(client, tableName);
const logger = new SecureLogger({ baseContext: { service: "upload-slot-reconciliation" } });

export async function handler(): Promise<void> {
  await runWithContext({ correlationId: randomUUID() }, async () => {
    const result = await reconcileExpiredUploadSlots({ store, candidates, quota, tableName, now: () => new Date().toISOString() });
    logger.info("upload-slot-reconciliation complete", { ...result });
  });
}
