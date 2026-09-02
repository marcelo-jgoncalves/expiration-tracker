/** Real handler for RequirementReindex (EventBridge Scheduler, daily) — D-143 Decision 5's
 * daily reindex job (`requirement.ts`'s module doc comment). Same "top-level `input`, never
 * `event.detail`" contract as reminder-reconciliation-handler.ts (EventBridge Scheduler does
 * NOT wrap the payload in a `detail` envelope the way legacy EventBridge Rules do). Wired to
 * real infra (Lambda resource + EventBridge Scheduler schedule + IAM) in `infra/main.tf`. */
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildDocumentArchiveDeps } from "../composition/document-archive.js";
import { runRequirementReindex } from "../../../workers/requirement-reindex/reindex.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
// This handler only uses `store` (the reindex job never calls `documentArchive.reserveFiles()`)
// — the quarantine bucket parameter is unused here.
const { store } = buildDocumentArchiveDeps(client, tableName, "");
const logger = new SecureLogger({ baseContext: { service: "requirement-reindex" } });

export interface RequirementReindexEvent {
  scheduledTime: string;
}

export async function handler(event: RequirementReindexEvent): Promise<void> {
  // Scheduler producer, no upstream request to inherit a correlationId from (same posture as
  // reminder-reconciliation-handler.ts) — new correlationId per invocation.
  const correlationId = `req-reindex-${event.scheduledTime}`;
  await runWithContext({ correlationId }, () => handleReindex(event));
}

async function handleReindex(event: RequirementReindexEvent): Promise<void> {
  const result = await runRequirementReindex({ store, tableName: tableName as string, now: () => new Date().toISOString() });
  logger.info("requirement-reindex complete", { scheduledTime: event.scheduledTime, ...result });
}
