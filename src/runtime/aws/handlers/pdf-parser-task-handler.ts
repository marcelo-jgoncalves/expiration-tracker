/**
 * Real Lambda for `PdfParserTaskHandler` (M7 item 5, D-035 §1.3). Unlike `TextractTaskHandler`,
 * this is a single plain synchronous invocation - the ASL's `RunDeterministicParser` state is
 * `arn:aws:states:::lambda:invoke` (NOT `waitForTaskToken`), so there is no task token, no SQS
 * event source, and no `SendTaskSuccess/Failure` call anywhere in this handler. The Lambda's
 * return value IS the Step Functions Task output (via `OutputPath: "$.Payload"` in the ASL).
 *
 * No AI provider, no Textract, no DynamoDB access - purely deterministic regex/heuristic field
 * extraction over the OCR artifact (when present) plus the `needsBedrock()`/`AI_EXTRACTION`
 * decision inputs the next ASL states consume. `SecureLogger` only - never logs OCR text.
 */
import { randomUUID } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
import { buildPdfParserTaskWorkerDeps, createRealPdfParserTaskWorkerClients } from "../../../modules/extraction/composition/extraction.js";
import { runDeterministicParser, type RunDeterministicParserInput, type RunDeterministicParserOutput } from "../../../modules/extraction/application/run-deterministic-parser.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { toAppError } from "../../../shared/errors/app-error.js";

const extractionTransientBucket = process.env["EXTRACTION_TRANSIENT_BUCKET_NAME"];
const appConfigApplicationId = process.env["APPCONFIG_APPLICATION_ID"];
const appConfigEnvironmentId = process.env["APPCONFIG_ENVIRONMENT_ID"];
const appConfigConfigurationProfileId = process.env["APPCONFIG_CONFIGURATION_PROFILE_ID"];

if (!extractionTransientBucket) throw new Error("EXTRACTION_TRANSIENT_BUCKET_NAME env var is required.");
if (!appConfigApplicationId) throw new Error("APPCONFIG_APPLICATION_ID env var is required.");
if (!appConfigEnvironmentId) throw new Error("APPCONFIG_ENVIRONMENT_ID env var is required.");
if (!appConfigConfigurationProfileId) throw new Error("APPCONFIG_CONFIGURATION_PROFILE_ID env var is required.");

const s3 = new S3Client({});
const realClients = createRealPdfParserTaskWorkerClients();

const deps = buildPdfParserTaskWorkerDeps(
  { s3, appConfigData: realClients.appConfigData },
  {
    extractionTransientBucket,
    appConfig: { applicationId: appConfigApplicationId, environmentId: appConfigEnvironmentId, configurationProfileId: appConfigConfigurationProfileId },
  },
);

const logger = new SecureLogger({ baseContext: { service: "pdf-parser-task" } });

export async function handler(event: RunDeterministicParserInput): Promise<RunDeterministicParserOutput> {
  return runWithContext({ correlationId: randomUUID(), tenantId: event.tenantId }, async () => {
    try {
      const output = await runDeterministicParser(deps.runDeterministicParser, event);
      logger.info("pdf-parser-task RunDeterministicParser succeeded", {
        documentId: event.documentId,
        runId: event.runId,
        ocrAvailable: output.ocrAvailable,
        needsBedrock: output.needsBedrock,
      });
      return output;
    } catch (err) {
      const appErr = toAppError(err);
      // Rethrown as a real Task failure - the ASL's Catch (ErrorEquals: States.ALL) routes
      // straight to MarkPendingConfirmation, never to Bedrock, per design §1.2.
      logger.error("pdf-parser-task RunDeterministicParser failed", { documentId: event.documentId, runId: event.runId, errorCode: appErr.code });
      throw appErr;
    }
  });
}
