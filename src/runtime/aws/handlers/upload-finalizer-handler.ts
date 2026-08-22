/** Real handler for UploadFinalizerWorker (SQS, fed by S3 "Object Created" events on the
 * quarantine bucket routed through EventBridge). M6 design §3.2/§4. */
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildDocumentWorkerDeps } from "../composition/document.js";
import { finalizeUpload } from "../../../workers/upload-finalizer/finalizer.js";
import { parseQuarantineKey } from "../../../modules/document/domain/quarantine-key.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const cleanBucket = process.env["CLEAN_BUCKET_NAME"];
const parserFunctionName = process.env["PARSER_SANDBOX_FUNCTION_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!cleanBucket) throw new Error("CLEAN_BUCKET_NAME env var is required.");
if (!parserFunctionName) throw new Error("PARSER_SANDBOX_FUNCTION_NAME env var is required.");
const deps = buildDocumentWorkerDeps(client, tableName, cleanBucket, parserFunctionName);
const logger = new SecureLogger({ baseContext: { service: "upload-finalizer" } });

/** Real EventBridge "Object Created" detail shape for an S3 source
 * (docs.aws.amazon.com/AmazonS3/latest/userguide/EventBridge.html). */
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
          logger.error("upload-finalizer malformed S3 event", { messageId: record.messageId });
          batchItemFailures.push({ itemIdentifier: record.messageId });
          return;
        }

        const parsed = parseQuarantineKey(detail.object.key);
        if (!parsed) {
          // A key this handler doesn't recognize (never produced by reserveUpload) is not a
          // retryable failure - it can never resolve on retry. Log and drop, never DLQ-loop.
          logger.error("upload-finalizer unrecognized key shape", { key: detail.object.key });
          return;
        }

        await runWithContext({ correlationId: randomUUID(), tenantId: parsed.tenantId }, async () => {
          const outcome = await finalizeUpload(deps, {
            tenantId: parsed.tenantId,
            itemId: parsed.itemId,
            documentId: parsed.documentId,
            object: { bucket: detail.bucket.name, key: detail.object.key, versionId: detail.object["version-id"]! },
          });
          logger.info("upload-finalizer outcome", { documentId: parsed.documentId, outcome });
        });
      } catch (err) {
        logger.error("upload-finalizer failed", { messageId: record.messageId, error: err instanceof Error ? err.message : String(err) });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    });
  }

  return { batchItemFailures };
}
