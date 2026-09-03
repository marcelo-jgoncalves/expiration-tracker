/** Real handler for RequirementEvidenceDailySweep (EventBridge Scheduler, daily) — D-193 item
 * 7/9's authoritative repair net. Same "top-level `input`, never `event.detail`" contract as
 * `requirement-reindex-handler.ts`/`document-request-recurrence-handler.ts` (EventBridge
 * Scheduler does NOT wrap the payload in a `detail` envelope). Wired to real infra (Lambda
 * resource + EventBridge Scheduler schedule + IAM) in `infra/main.tf`. This handler's ONLY write
 * side effect is `sqs:SendMessage` onto `SQS_REQUIREMENT_EVIDENCE_REFRESH_V1` — it never issues a
 * DynamoDB write itself, matching the design's "colapsando o caminho de escrita a um único
 * lugar" constraint (item 6/9's `refresh.ts` owns every actual Requirement write). */
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildDocumentArchiveDeps } from "../composition/document-archive.js";
import { newCorrelationId } from "../ids.js";
import { runRequirementEvidenceDailySweep, type RequirementEvidenceDailySweepHint } from "../../../workers/requirement-evidence-daily-sweep/sweep.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const queueUrl = process.env["REQUIREMENT_EVIDENCE_REFRESH_QUEUE_URL"];
if (!queueUrl) throw new Error("REQUIREMENT_EVIDENCE_REFRESH_QUEUE_URL env var is required.");
// This handler only uses `store.scanRequirementsWithEvidence` — it never calls
// `documentArchive.reserveFiles()`, so the quarantine bucket parameter is unused (same posture as
// `document-request-recurrence-handler.ts`'s identical comment).
const { store } = buildDocumentArchiveDeps(client, tableName, "");
const sqsClient = new SQSClient({});
const logger = new SecureLogger({ baseContext: { service: "requirement-evidence-daily-sweep" } });

async function enqueueRefresh(hint: RequirementEvidenceDailySweepHint, correlationId: string): Promise<void> {
  await sqsClient.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      // Same bare-hint shape `requirement-evidence-refresh-handler.ts` parses — tenantId/
      // versionId only, nothing else, matching `RequirementEvidenceRefreshHint` exactly.
      MessageBody: JSON.stringify(hint),
      MessageAttributes: { correlationId: { DataType: "String", StringValue: correlationId } },
    }),
  );
}

export interface RequirementEvidenceDailySweepEvent {
  scheduledTime: string;
}

export async function handler(event: RequirementEvidenceDailySweepEvent): Promise<void> {
  // Scheduler producer, no upstream request to inherit a correlationId from (same posture as
  // requirement-reindex-handler.ts/document-request-recurrence-handler.ts) — new correlationId
  // per invocation.
  const correlationId = `requirement-evidence-daily-sweep-${event.scheduledTime}`;
  await runWithContext({ correlationId }, () => handleSweep(event));
}

async function handleSweep(event: RequirementEvidenceDailySweepEvent): Promise<void> {
  const result = await runRequirementEvidenceDailySweep({ store, enqueueRefresh, newCorrelationId });
  logger.info("requirement-evidence-daily-sweep complete", { scheduledTime: event.scheduledTime, ...result });
}
