import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { SQSClient } from "@aws-sdk/client-sqs";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { DynamoDbScanControlStore } from "../../../workers/reminder-scan-control/store.js";
import { DynamoDbReminderDueWorkStore } from "../../../modules/reminder/persistence/dynamodb-reminder-due-work-store.js";
import { runControlScanPage } from "../../../workers/reminder-scan-control/scan-page.js";
import type { ScanContinuationV2 } from "../../../workers/reminder-scan-control/model.js";
import { buildReminderClaimQueuePort } from "../composition/reminder.js";
import { UlidIdGenerator, newCorrelationId } from "../ids.js";
import { mapWithConcurrency } from "../../../shared/concurrency/map-with-concurrency.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import { correlationIdFromSqsRecord, runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { emitMetric } from "../../../shared/observability/metrics.js";
import { toAppError, ValidationError } from "../../../shared/errors/app-error.js";

const controlName = process.env["REMINDER_SCAN_CONTROL_TABLE_NAME"];
const dueName = process.env["REMINDER_DUE_WORK_TABLE_NAME"];
const queueUrl = process.env["REMINDER_CLAIM_QUEUE_URL"];
if (!controlName || !dueName || !queueUrl) throw new Error("Reminder scan-page environment is incomplete");

const client = createDocumentClient();
const ids = new UlidIdGenerator();
const logger = new SecureLogger({ baseContext: { service: "reminder-scan-page-v2" } });
const NAMESPACE = "ExpirationTracker/ReminderScanPageV2";
const SCHEMA_ID = "https://expiration-tracker/schemas/queues/reminder-scan-continuation.v2.json";
const deps = {
  controlStore: new DynamoDbScanControlStore(client, controlName),
  dueStore: new DynamoDbReminderDueWorkStore(client, dueName),
  claimQueue: buildReminderClaimQueuePort(new SQSClient({}), queueUrl),
  tableName: controlName,
  pageSize: 200,
  leaseDurationMs: 200_000,
  rolloutEpoch: Number(process.env["SCAN_MODE_EPOCH"] ?? 1),
  now: () => new Date().toISOString(),
  newEventId: () => ids.newEventId(),
  correlationId: () => newCorrelationId(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const results = await mapWithConcurrency(event.Records, 4, processRecord);
  return { batchItemFailures: results.flatMap((result, index) => result.ok ? [] : [{ itemIdentifier: event.Records[index]!.messageId }]) };
}

async function processRecord(record: SQSEvent["Records"][number]): Promise<void> {
  const fallbackCorrelationId = correlationIdFromSqsRecord(record);
  await runWithContext({ correlationId: fallbackCorrelationId }, async () => {
    try {
      const parsed: unknown = JSON.parse(record.body);
      const validation = defaultSchemaRegistry.validate(SCHEMA_ID, parsed);
      if (!validation.valid) throw new ValidationError("Invalid reminder scan continuation.", { errors: validation.errors });
      const message = parsed as ScanContinuationV2;
      await runWithContext({ correlationId: message.correlationId ?? fallbackCorrelationId, tenantId: message.tenantId }, async () => {
        const outcome = await runControlScanPage(deps, message);
        logger.info("reminder-scan-page-v2 outcome", {
          messageId: record.messageId, shardFnVersion: message.data.shardFnVersion, shardId: message.data.shardId,
          minuteISO: message.data.minuteISO, leaseVersion: message.data.leaseVersion, outcome: outcome.kind,
          candidatesPublished: outcome.kind === "PROCESSED" ? outcome.candidatesPublished : 0,
        });
        emitMetric(NAMESPACE, { name: "ScanPageOutcome", value: 1, unit: "Count", dimensions: { outcome: outcome.kind } });
      });
    } catch (error) {
      const appError = toAppError(error);
      logger.error("reminder-scan-page-v2 failed", { messageId: record.messageId, errorCode: appError.code, retryable: appError.retryable });
      emitMetric(NAMESPACE, { name: "ScanPageOutcome", value: 1, unit: "Count", dimensions: { outcome: "HANDLER_ERROR" } });
      throw error;
    }
  });
}
