/** Real handler for ExtractionStarterWorker (SQS, fed by S3 "Object Created" events on the
 * clean bucket routed through EventBridge - same shape as UploadFinalizerWorker's quarantine
 * trigger). M7, `implementation-blueprint.md` §12.5. */
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildExtractionStarterWorkerDeps } from "../composition/extraction.js";
import { startExtractionRun } from "../../../modules/extraction/application/start-extraction-run.js";
import { parseCleanKey } from "../../../modules/document/domain/clean-key.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const stateMachineArn = process.env["EXTRACTION_STATE_MACHINE_ARN"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!stateMachineArn) throw new Error("EXTRACTION_STATE_MACHINE_ARN env var is required.");
const deps = buildExtractionStarterWorkerDeps(client, tableName, stateMachineArn);
const logger = new SecureLogger({ baseContext: { service: "extraction-starter" } });

/** Real EventBridge "Object Created" detail shape for an S3 source (same as
 * upload-finalizer-handler.ts's own copy of this shape). */
interface S3ObjectCreatedDetail {
  bucket: { name: string };
  object: { key: string; "version-id"?: string; size?: number };
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    await runWithContext({ correlationId: randomUUID() }, async () => {
      try {
        const message = JSON.parse(record.body) as { detail?: S3ObjectCreatedDetail };
        const detail = message.detail;
        if (!detail?.bucket?.name || !detail.object?.key || !detail.object["version-id"]) {
          logger.error("extraction-starter malformed S3 event", { messageId: record.messageId });
          batchItemFailures.push({ itemIdentifier: record.messageId });
          return;
        }

        const parsed = parseCleanKey(detail.object.key);
        if (!parsed) {
          // A key this handler doesn't recognize (never produced by advanceAfterEvidence's
          // promotion copy) is not a retryable failure - it can never resolve on retry.
          logger.error("extraction-starter unrecognized key shape", { key: detail.object.key });
          return;
        }

        await runWithContext({ correlationId: randomUUID(), tenantId: parsed.tenantId }, async () => {
          const outcome = await startExtractionRun(deps, {
            tenantId: parsed.tenantId,
            itemId: parsed.itemId,
            documentId: parsed.documentId,
            cleanObject: { bucket: detail.bucket.name, key: detail.object.key, versionId: detail.object["version-id"]! },
          });
          logger.info("extraction-starter outcome", { documentId: parsed.documentId, outcome });
        });
      } catch (err) {
        // DocumentNotCleanYetError (real race between the promotion copy and the Document's
        // own status transaction, see start-extraction-run.ts) lands here too, deliberately -
        // it's retryable, same batch-item-failure path as any other transient error.
        logger.error("extraction-starter failed", {
          messageId: record.messageId,
          error: err instanceof Error ? err.message : String(err),
          errorName: err instanceof Error ? err.name : undefined,
        });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    });
  }

  return { batchItemFailures };
}
