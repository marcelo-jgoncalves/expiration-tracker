/**
 * Real Lambda for `TextractTaskHandler` (M7 items 3/4). Single deployable function dispatching
 * on an `operation` discriminator, per two very different real event shapes:
 *
 * - `START_OCR`: direct Step Functions invocation via `arn:aws:states:::lambda:invoke.
 *   waitForTaskToken` (`infra/state-machines/document-extraction.asl.json`'s `RunTextract`
 *   state) — event is `{ operation: "START_OCR", taskToken, input: {...StartOcrInput sans
 *   taskToken} }`.
 * - `COMPLETE_OCR`: SQS batch, fed by a queue subscribed to Textract's own SNS job-completion
 *   topic (`schemas/queues/textract-completion.v1.json` — raw SNS envelope, `Message` is
 *   Textract's own JSON string carrying `JobId`). Same `batchItemFailures` pattern as
 *   `extraction-starter-handler.ts`.
 *
 * `SecureLogger` only — never `console.*`, never logs task tokens or OCR text (design §1.9/
 * §20.5).
 */
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { S3Client } from "@aws-sdk/client-s3";
import { SFNClient } from "@aws-sdk/client-sfn";
import { buildTextractTaskWorkerDeps, createRealTextractTaskWorkerClients } from "../../../modules/extraction/composition/extraction.js";
import { startOcr, type StartOcrInput } from "../../../modules/extraction/application/start-ocr.js";
import { completeOcr } from "../../../modules/extraction/application/complete-ocr.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { toAppError } from "../../../shared/errors/app-error.js";

const tableName = process.env["TABLE_NAME"];
const extractionTransientBucket = process.env["EXTRACTION_TRANSIENT_BUCKET_NAME"];
const taskTokenKmsKeyId = process.env["TASK_TOKEN_KMS_KEY_ID"];
const textractSnsTopicArn = process.env["TEXTRACT_SNS_TOPIC_ARN"];
const textractSnsRoleArn = process.env["TEXTRACT_SNS_ROLE_ARN"];
const appConfigApplicationId = process.env["APPCONFIG_APPLICATION_ID"];
const appConfigEnvironmentId = process.env["APPCONFIG_ENVIRONMENT_ID"];
const appConfigConfigurationProfileId = process.env["APPCONFIG_CONFIGURATION_PROFILE_ID"];

if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!extractionTransientBucket) throw new Error("EXTRACTION_TRANSIENT_BUCKET_NAME env var is required.");
if (!taskTokenKmsKeyId) throw new Error("TASK_TOKEN_KMS_KEY_ID env var is required.");
if (!textractSnsTopicArn) throw new Error("TEXTRACT_SNS_TOPIC_ARN env var is required.");
if (!textractSnsRoleArn) throw new Error("TEXTRACT_SNS_ROLE_ARN env var is required.");
if (!appConfigApplicationId) throw new Error("APPCONFIG_APPLICATION_ID env var is required.");
if (!appConfigEnvironmentId) throw new Error("APPCONFIG_ENVIRONMENT_ID env var is required.");
if (!appConfigConfigurationProfileId) throw new Error("APPCONFIG_CONFIGURATION_PROFILE_ID env var is required.");

const dynamo = createDocumentClient();
const s3 = new S3Client({});
const sfn = new SFNClient({});
const realClients = createRealTextractTaskWorkerClients();

const deps = buildTextractTaskWorkerDeps(
  { dynamo, s3, sfn, kms: realClients.kms, appConfigData: realClients.appConfigData, textract: realClients.textract },
  {
    tableName,
    extractionTransientBucket,
    taskTokenKmsKeyId,
    textractSnsTopicArn,
    textractSnsRoleArn,
    appConfig: { applicationId: appConfigApplicationId, environmentId: appConfigEnvironmentId, configurationProfileId: appConfigConfigurationProfileId },
  },
);

const logger = new SecureLogger({ baseContext: { service: "textract-task" } });

interface StartOcrEvent {
  operation: "START_OCR";
  taskToken: string;
  input: Omit<StartOcrInput, "taskToken">;
}

interface TextractSnsMessage {
  JobId?: string;
}

function isStartOcrEvent(event: unknown): event is StartOcrEvent {
  return typeof event === "object" && event !== null && (event as { operation?: unknown }).operation === "START_OCR";
}

async function handleStartOcr(event: StartOcrEvent): Promise<void> {
  await runWithContext({ correlationId: randomUUID(), tenantId: event.input.tenantId }, async () => {
    try {
      await startOcr(deps.startOcr, { ...event.input, taskToken: event.taskToken });
      logger.info("textract-task START_OCR succeeded", { documentId: event.input.documentId, runId: event.input.runId });
    } catch (err) {
      const appErr = toAppError(err);
      // Rethrown to Step Functions as a real Task failure - the ASL's own Catch block
      // (ErrorEquals matching appErr.code) routes to RunDeterministicParser regardless of
      // which of these errors fired, per design §1.2.
      logger.error("textract-task START_OCR failed", { documentId: event.input.documentId, runId: event.input.runId, errorCode: appErr.code });
      throw appErr;
    }
  });
}

async function handleCompleteOcr(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    await runWithContext({ correlationId: randomUUID() }, async () => {
      try {
        const envelope = JSON.parse(record.body) as { Message?: string };
        if (!envelope.Message) {
          logger.error("textract-task COMPLETE_OCR malformed SNS envelope", { messageId: record.messageId });
          return; // not retryable - will never parse differently.
        }
        const message = JSON.parse(envelope.Message) as TextractSnsMessage;
        if (!message.JobId) {
          logger.error("textract-task COMPLETE_OCR message missing JobId", { messageId: record.messageId });
          return;
        }
        const outcome = await completeOcr(deps.completeOcr, { jobId: message.JobId });
        logger.info("textract-task COMPLETE_OCR outcome", { jobId: message.JobId, outcome });
      } catch (err) {
        const appErr = toAppError(err);
        logger.error("textract-task COMPLETE_OCR failed", { messageId: record.messageId, errorCode: appErr.code, retryable: appErr.retryable });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    });
  }

  return { batchItemFailures };
}

export async function handler(event: StartOcrEvent | SQSEvent): Promise<void | SQSBatchResponse> {
  if (isStartOcrEvent(event)) {
    return handleStartOcr(event);
  }
  return handleCompleteOcr(event as SQSEvent);
}
