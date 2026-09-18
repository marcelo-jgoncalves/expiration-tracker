import { randomUUID } from "node:crypto";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { DynamoDbScanControlStore } from "../../../workers/reminder-scan-control/store.js";
import { reconcileControlPlane } from "../../../workers/reminder-scan-control/reconciler.js";
import { UlidIdGenerator, newCorrelationId } from "../ids.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { toAppError } from "../../../shared/errors/app-error.js";

const tableNameValue = process.env["REMINDER_SCAN_CONTROL_TABLE_NAME"];
const queueUrlValue = process.env["REMINDER_SCAN_QUEUE_URL"];
if (!tableNameValue || !queueUrlValue) throw new Error("Control reconciler environment is incomplete");
const tableName: string = tableNameValue;
const queueUrl: string = queueUrlValue;
const store = new DynamoDbScanControlStore(createDocumentClient(), tableName);
const sqs = new SQSClient({});
const ids = new UlidIdGenerator();
const logger = new SecureLogger({ baseContext: { service: "reminder-scan-control-reconciler" } });

export async function handler(): Promise<Awaited<ReturnType<typeof reconcileControlPlane>>> {
  const correlationId = newCorrelationId();
  return runWithContext({ correlationId }, async () => {
    try {
      const result = await reconcileControlPlane({
        store, tableName, rolloutEpoch: Number(process.env["SCAN_MODE_EPOCH"] ?? 1), leaseDurationMs: 200_000,
        now: () => new Date().toISOString(), newEventId: () => ids.newEventId(), correlationId: () => correlationId,
        newOwnerToken: () => randomUUID(),
        send: async (payload) => {
          await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(payload),
            MessageAttributes: { correlationId: { DataType: "String", StringValue: payload.correlationId } } }));
        },
      });
      logger.info("reminder-scan-control-reconciler outcome", result);
      return result;
    } catch (error) {
      const appError = toAppError(error);
      logger.error("reminder-scan-control-reconciler failed", { errorCode: appError.code, retryable: appError.retryable });
      throw error;
    }
  });
}
