/** Real handler for DocumentRequestRecurrenceMaterializer (EventBridge Scheduler, daily) — D-143
 * Decision 8's periodic "what's due" materializer (D-147). Same "top-level `input`, never
 * `event.detail`" contract as `requirement-reindex-handler.ts`/`reminder-reconciliation-handler.ts`
 * (EventBridge Scheduler does NOT wrap the payload in a `detail` envelope). Wired to real infra
 * (Lambda resource + EventBridge Scheduler schedule + IAM) in `infra/main.tf`. */
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildDocumentArchiveDeps } from "../composition/document-archive.js";
import { UlidIdGenerator } from "../ids.js";
import { runDocumentRequestRecurrenceMaterializer } from "../../../workers/document-request-recurrence/materializer.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const { store } = buildDocumentArchiveDeps(client, tableName);
const ids = new UlidIdGenerator();
const logger = new SecureLogger({ baseContext: { service: "document-request-recurrence-materializer" } });

export interface DocumentRequestRecurrenceEvent {
  scheduledTime: string;
}

export async function handler(event: DocumentRequestRecurrenceEvent): Promise<void> {
  // Scheduler producer, no upstream request to inherit a correlationId from (same posture as
  // requirement-reindex-handler.ts) — new correlationId per invocation.
  const correlationId = `docreq-recurrence-${event.scheduledTime}`;
  await runWithContext({ correlationId }, () => handleMaterialize(event));
}

async function handleMaterialize(event: DocumentRequestRecurrenceEvent): Promise<void> {
  const result = await runDocumentRequestRecurrenceMaterializer({ store, tableName: tableName as string, ids, now: () => new Date().toISOString() });
  logger.info("document-request-recurrence materializer complete", { scheduledTime: event.scheduledTime, ...result });
}
