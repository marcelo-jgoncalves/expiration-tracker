/** Real handler for ImportParseWorker (SQS, fed by S3 "Object Created" events on the import
 * bucket routed through EventBridge, M11 design). Same shape as upload-finalizer-handler.ts. */
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildIdentityDeps } from "../composition/identity.js";
import { buildImportParseWorkerDeps } from "../composition/import.js";
import { parseImportJob } from "../../../modules/import/application/import-parse-service.js";
import { parseImportRawKey } from "../../../modules/import/domain/import-raw-key.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const rawBucket = process.env["IMPORT_RAW_BUCKET_NAME"];
const planBucket = process.env["IMPORT_PLAN_BUCKET_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!rawBucket) throw new Error("IMPORT_RAW_BUCKET_NAME env var is required.");
if (!planBucket) throw new Error("IMPORT_PLAN_BUCKET_NAME env var is required.");
const { quota } = buildIdentityDeps(client, tableName);
const deps = buildImportParseWorkerDeps(client, tableName, rawBucket, planBucket, quota);
const logger = new SecureLogger({ baseContext: { service: "import-parse" } });

/** Real EventBridge "Object Created" detail shape for an S3 source
 * (docs.aws.amazon.com/AmazonS3/latest/userguide/EventBridge.html). */
interface S3ObjectCreatedDetail {
  bucket: { name: string };
  object: { key: string };
}

/** D-192 slice 9: the SQS_IMPORT_PARSE_V1 envelope (`import-service.ts#submitImportMapping`'s
 * outbox dispatch) - bare `{tenantId, jobId}`, no S3 `detail` wrapper. Discriminated from the
 * S3-event shape ONLY here in the handler (never inside `parseImportJob()`, which stays a pure
 * function agnostic of which of the two triggers called it, per the design). */
interface ImportParseTriggerMessage {
  tenantId: string;
  jobId: string;
}

function isImportParseTriggerMessage(message: unknown): message is ImportParseTriggerMessage {
  const m = message as Partial<ImportParseTriggerMessage> | undefined;
  return typeof m?.tenantId === "string" && typeof m?.jobId === "string";
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    await runWithContext({ correlationId: randomUUID() }, async () => {
      try {
        const message = JSON.parse(record.body) as { detail?: S3ObjectCreatedDetail } & Partial<ImportParseTriggerMessage>;

        if (isImportParseTriggerMessage(message)) {
          await runWithContext({ correlationId: randomUUID(), tenantId: message.tenantId }, async () => {
            const outcome = await parseImportJob(deps, message.tenantId, message.jobId);
            logger.info("import-parse outcome (SQS_IMPORT_PARSE_V1 trigger)", { jobId: message.jobId, outcome });
          });
          return;
        }

        const detail = message.detail;
        if (!detail?.bucket?.name || !detail.object?.key) {
          logger.error("import-parse malformed message (neither S3 event nor SQS_IMPORT_PARSE_V1 trigger)", { messageId: record.messageId });
          batchItemFailures.push({ itemIdentifier: record.messageId });
          return;
        }

        const parsed = parseImportRawKey(detail.object.key);
        if (!parsed) {
          // Not a raw.csv key this handler recognizes (e.g. its own plan JSONL write) - never
          // retryable, never DLQ-loop. Same fail-closed posture as upload-finalizer-handler.ts.
          logger.info("import-parse ignoring unrecognized key shape", { key: detail.object.key });
          return;
        }

        await runWithContext({ correlationId: randomUUID(), tenantId: parsed.tenantId }, async () => {
          const outcome = await parseImportJob(deps, parsed.tenantId, parsed.jobId);
          logger.info("import-parse outcome (S3 event trigger)", { jobId: parsed.jobId, outcome });
        });
      } catch (err) {
        const e = err as { name?: string; message?: string; Code?: string; $metadata?: unknown } | undefined;
        logger.error("import-parse failed", {
          messageId: record.messageId,
          error: err instanceof Error ? err.message : String(err),
          errorName: e?.name,
          errorCode: e?.Code,
          errorMetadata: e?.$metadata,
        });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    });
  }

  return { batchItemFailures };
}
