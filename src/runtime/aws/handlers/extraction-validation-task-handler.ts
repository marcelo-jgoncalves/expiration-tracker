/**
 * Real Lambda for `ExtractionValidationTaskHandler` (M7 item 7, D-035 §2/§3). A single plain
 * synchronous invocation per operation - the ASL's `ValidateSchema`/`CompareExtractors`/
 * `PersistExtractedFields`/`MarkPendingConfirmation`/`CompleteRun` states are all
 * `arn:aws:states:::lambda:invoke` (never `waitForTaskToken` - no task token anywhere in this
 * handler), same shape as items 5/6. The Lambda's return value IS the Step Functions Task
 * output (`ResultSelector`/`OutputPath` in the ASL unwrap it back onto `$`).
 *
 * `SecureLogger` only - never logs OCR text, candidate values, or document content (only field
 * names, counts, and identifiers).
 */
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { S3Client } from "@aws-sdk/client-s3";
import { buildExtractionValidationTaskWorkerDeps } from "../../../modules/extraction/composition/extraction.js";
import { runExtractionValidation, type ExtractionValidationOperation, type ValidationContext } from "../../../modules/extraction/application/run-extraction-validation.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { toAppError } from "../../../shared/errors/app-error.js";

const tableName = process.env["TABLE_NAME"];
const extractionTransientBucket = process.env["EXTRACTION_TRANSIENT_BUCKET_NAME"];

if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!extractionTransientBucket) throw new Error("EXTRACTION_TRANSIENT_BUCKET_NAME env var is required.");

const dynamo = createDocumentClient();
const s3 = new S3Client({});

const deps = buildExtractionValidationTaskWorkerDeps({ dynamo, s3 }, { tableName, extractionTransientBucket });

const logger = new SecureLogger({ baseContext: { service: "extraction-validation-task" } });

interface ExtractionValidationEvent {
  operation: ExtractionValidationOperation;
  input: ValidationContext;
}

export async function handler(event: ExtractionValidationEvent): Promise<ValidationContext> {
  // Uses the run's OWN correlationId, threaded through the Step Functions execution - never a
  // fresh randomUUID() here (see ExtractionExecutionInput's doc comment).
  return runWithContext({ correlationId: event.input.correlationId, tenantId: event.input.tenantId }, async () => {
    try {
      const output = await runExtractionValidation(deps.runExtractionValidation, event.operation, event.input);
      logger.info(`extraction-validation-task ${event.operation} succeeded`, {
        documentId: event.input.documentId,
        runId: event.input.runId,
        runOutcome: output.runOutcome,
        requiresReview: output.requiresReview,
      });
      return output;
    } catch (err) {
      const appErr = toAppError(err);
      logger.error(`extraction-validation-task ${event.operation} failed`, { documentId: event.input.documentId, runId: event.input.runId, errorCode: appErr.code });
      throw appErr;
    }
  });
}
