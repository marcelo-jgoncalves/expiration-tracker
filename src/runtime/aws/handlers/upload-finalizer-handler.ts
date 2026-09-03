/** Real handler for UploadFinalizerWorker (SQS, fed by S3 "Object Created" events on the
 * quarantine bucket routed through EventBridge). M6 design §3.2/§4. */
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildDocumentWorkerDeps } from "../composition/document.js";
import { finalizeUpload } from "../../../workers/upload-finalizer/finalizer.js";
import { parseQuarantineKey } from "../../../modules/document/domain/quarantine-key.js";
// M10 (D-037): branch puramente aditivo para o namespace de key de guest upload
// (`tenant/.../subject/...`) - nunca sobrepõe o formato item-anchored acima
// (`tenant/.../item/...`), que continua resolvido pelo parser/fluxo originais sem nenhuma
// mudança de comportamento.
import { parseSubmissionQuarantineKey } from "../../../modules/subject/domain/submission-quarantine-key.js";
import { finalizeSubmissionUpload } from "../../../workers/submission-finalizer/finalizer.js";
import { buildSubjectWorkerDeps } from "../composition/subject.js";
// D-193 ("Ingestão física", slice 1): terceiro branch aditivo para o namespace `document-
// archive/...` (D-163 §7) - o BUG REAL este slice corrige: nenhum dos dois parsers acima
// reconhece esse prefixo, então até este slice uma DocumentFile enviada via document-archive
// caía no "unrecognized key shape" abaixo e ficava presa em PENDING_UPLOAD para sempre.
import { parseDocumentArchiveQuarantineKey } from "../../../modules/document-archive/domain/document-archive-quarantine-key.js";
import { finalizeDocumentArchiveUpload } from "../../../workers/upload-finalizer/document-archive-finalizer.js";
import { buildDocumentArchiveWorkerDeps } from "../composition/document-archive.js";
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
const submissionDeps = buildSubjectWorkerDeps(client, tableName, cleanBucket, parserFunctionName);
const documentArchiveDeps = buildDocumentArchiveWorkerDeps(client, tableName, cleanBucket);
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

        // D-193 slice 1: tried FIRST since its `document-archive/` prefix never collides with
        // either of the two formats below (`tenant/.../item/...`, `tenant/.../subject/...`) -
        // order is not a correctness concern here, just documents which format is authoritative
        // for new uploads going forward (D-143).
        const parsedArchive = parseDocumentArchiveQuarantineKey(detail.object.key);
        if (parsedArchive) {
          await runWithContext({ correlationId: randomUUID(), tenantId: parsedArchive.tenantId }, async () => {
            const outcome = await finalizeDocumentArchiveUpload(documentArchiveDeps, {
              tenantId: parsedArchive.tenantId,
              documentId: parsedArchive.documentId,
              seq: parsedArchive.seq,
              fileId: parsedArchive.fileId,
              object: { bucket: detail.bucket.name, key: detail.object.key, versionId: detail.object["version-id"]! },
            });
            logger.info("upload-finalizer document-archive outcome", { documentId: parsedArchive.documentId, fileId: parsedArchive.fileId, outcome });
          });
          return;
        }

        const parsed = parseQuarantineKey(detail.object.key);
        if (parsed) {
          await runWithContext({ correlationId: randomUUID(), tenantId: parsed.tenantId }, async () => {
            const outcome = await finalizeUpload(deps, {
              tenantId: parsed.tenantId,
              itemId: parsed.itemId,
              documentId: parsed.documentId,
              object: { bucket: detail.bucket.name, key: detail.object.key, versionId: detail.object["version-id"]! },
            });
            logger.info("upload-finalizer outcome", { documentId: parsed.documentId, outcome });
          });
          return;
        }

        // M10: não é uma key item-anchored (M6) - tenta o namespace de guest submission antes
        // de desistir. Os dois formatos nunca colidem (segmentos "item" vs "subject").
        const parsedSubmission = parseSubmissionQuarantineKey(detail.object.key);
        if (!parsedSubmission) {
          // A key this handler doesn't recognize (never produced by either reserveUpload flow)
          // is not a retryable failure - it can never resolve on retry. Log and drop, never DLQ-loop.
          logger.error("upload-finalizer unrecognized key shape", { key: detail.object.key });
          return;
        }

        await runWithContext({ correlationId: randomUUID(), tenantId: parsedSubmission.tenantId }, async () => {
          const outcome = await finalizeSubmissionUpload(submissionDeps, {
            tenantId: parsedSubmission.tenantId,
            subjectId: parsedSubmission.subjectId,
            assignmentId: parsedSubmission.assignmentId,
            submissionId: parsedSubmission.submissionId,
            object: { bucket: detail.bucket.name, key: detail.object.key, versionId: detail.object["version-id"]! },
          });
          logger.info("upload-finalizer submission outcome", { submissionId: parsedSubmission.submissionId, outcome });
        });
      } catch (err) {
        // Real incident (2026-08-22): a bare `err.message` of "UnknownError" (AWS SDK v3's
        // fallback for a response it couldn't classify) gave zero diagnostic signal for a real
        // production-blocking promotion failure. Logging name/code/$metadata too - none of
        // these are secrets (HTTP status, request id, AWS error code), safe for SecureLogger.
        const e = err as { name?: string; message?: string; Code?: string; $metadata?: unknown } | undefined;
        logger.error("upload-finalizer failed", {
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
