import type { DynamoDBBatchResponse, DynamoDBStreamEvent } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { DynamoDbScanControlStore } from "../../../workers/reminder-scan-control/store.js";
import { relayControlOutbox } from "../../../workers/reminder-scan-control/relay.js";
import type { ScanOutboxV2 } from "../../../workers/reminder-scan-control/model.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { toAppError } from "../../../shared/errors/app-error.js";

const tableName = process.env["REMINDER_SCAN_CONTROL_TABLE_NAME"];
const queueUrl = process.env["REMINDER_SCAN_QUEUE_URL"];
if (!tableName || !queueUrl) throw new Error("Control relay environment is incomplete");
const store = new DynamoDbScanControlStore(createDocumentClient(), tableName);
const sqs = new SQSClient({});
const logger = new SecureLogger({ baseContext: { service: "reminder-scan-control-relay" } });

export async function handler(event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> {
  const failures: { itemIdentifier: string }[] = [];
  for (const record of event.Records) {
    const recordId = record.eventID ?? record.dynamodb?.SequenceNumber ?? "unknown";
    await runWithContext({ correlationId: recordId }, async () => {
      try {
        if (record.eventName !== "INSERT" && record.eventName !== "MODIFY") return;
        const image = record.dynamodb?.NewImage;
        if (!image) return;
        const item = unmarshall(image as Record<string, never>) as ScanOutboxV2;
        if (item.entityType !== "REMINDER_SCAN_CONTINUATION_OUTBOX" || item.status !== "PENDING") return;
        await runWithContext({ correlationId: item.payload.correlationId, tenantId: item.payload.tenantId }, async () => {
          const outcome = await relayControlOutbox({
            send: async (payload) => {
              await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(payload),
                MessageAttributes: { correlationId: { DataType: "String", StringValue: payload.correlationId } } }));
            },
            markPublished: store.markPublished.bind(store), now: () => new Date().toISOString(),
          }, item);
          logger.info("reminder-scan-control-relay outcome", { recordId, eventId: item.eventId, outcome });
        });
      } catch (error) {
        const appError = toAppError(error);
        logger.error("reminder-scan-control-relay failed", { recordId, errorCode: appError.code, retryable: appError.retryable });
        failures.push({ itemIdentifier: recordId });
      }
    });
  }
  return { batchItemFailures: failures };
}
