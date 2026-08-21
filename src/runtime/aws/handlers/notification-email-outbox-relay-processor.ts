/** Pure(ish) per-batch processing logic for NotificationEmailOutboxRelay, split out of
 * notification-email-outbox-relay-handler.ts for the same reason as
 * dispatch-outbox-relay-processor.ts: no module-level side effects, so it's importable
 * directly in a unit test without real AWS clients. */
import type { DynamoDBRecord } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { relayStreamRecord, type RelayDeps } from "../../../workers/dispatch-outbox-relay/relay.js";
import type { OutboxRecord } from "../../../shared/outbox/outbox.js";
import { runWithContext } from "../../../shared/observability/context.js";
import type { SecureLogger } from "../../../shared/observability/logger.js";

export async function processStreamRecords(
  deps: Omit<RelayDeps, "leaseOwner">,
  logger: SecureLogger,
  records: DynamoDBRecord[],
): Promise<{ itemIdentifier: string }[]> {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of records) {
    if (record.eventName !== "INSERT" && record.eventName !== "MODIFY") continue;
    const image = record.dynamodb?.NewImage;
    if (!image) continue;

    try {
      const item = unmarshall(image as Record<string, never>) as OutboxRecord;
      if (item.entityType !== "OutboxEvent") continue;

      // m5-observability-design.md #2: DynamoDB Streams fallback is the record's own
      // SequenceNumber, not eventId (that fallback is the sweeper's, via
      // outboxRecordCorrelationId - a different source per the design's table).
      const correlationId = item.correlationId ?? record.dynamodb?.SequenceNumber ?? record.eventID ?? "unknown";
      await runWithContext({ correlationId }, async () => {
        // try/catch stays INSIDE runWithContext - see dispatch-outbox-relay-processor.ts's
        // comment on why a catch wrapping runWithContext itself would lose the record's
        // correlationId, and on why this is what proves partial batch failure preserves
        // isolation (§5).
        try {
          const outcome = await relayStreamRecord({ ...deps, leaseOwner: `notification-relay-${record.eventID}` }, item);
          logger.info("notification-email-outbox-relay outcome", { eventId: item.eventId, outcome: outcome.kind });
          if (outcome.kind === "FAILED") {
            batchItemFailures.push({ itemIdentifier: record.eventID ?? "" });
          }
        } catch (err) {
          logger.error("notification-email-outbox-relay failed", { eventID: record.eventID, error: err instanceof Error ? err.message : String(err) });
          batchItemFailures.push({ itemIdentifier: record.eventID ?? "" });
        }
      });
    } catch (err) {
      logger.error("notification-email-outbox-relay failed to parse Streams image", { eventID: record.eventID, error: err instanceof Error ? err.message : String(err) });
      batchItemFailures.push({ itemIdentifier: record.eventID ?? "" });
    }
  }

  return batchItemFailures;
}
