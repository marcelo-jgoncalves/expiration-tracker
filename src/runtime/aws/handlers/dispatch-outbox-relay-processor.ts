/** Pure(ish) per-batch processing logic for DispatchOutboxRelay, split out of
 * dispatch-outbox-relay-handler.ts so it has NO module-level side effects (no env var
 * reads, no real AWS client construction) - handler.ts modules in this codebase build real
 * clients at import time, which makes them impossible to import directly in a unit test.
 * This file exists specifically so m5-observability-design.md §5's "partial batch failure
 * preserva isolamento" test (test/unit/dispatch-outbox-relay-handler.test.ts) can inject a
 * fake RelayDeps/logger sink without touching AWS. */
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
        // try/catch stays INSIDE runWithContext so a failure log still carries this
        // record's correlationId - a catch wrapping runWithContext itself would run after
        // AsyncLocalStorage.run() already restored the outer (empty) context. This is also
        // what proves partial batch failure preserves isolation (§5): record N+1 gets its
        // own runWithContext call regardless of whether record N's callback threw.
        try {
          const outcome = await relayStreamRecord({ ...deps, leaseOwner: `relay-${record.eventID}` }, item);
          logger.info("dispatch-outbox-relay outcome", { eventId: item.eventId, outcome: outcome.kind });
          if (outcome.kind === "FAILED") {
            batchItemFailures.push({ itemIdentifier: record.eventID ?? "" });
          }
        } catch (err) {
          logger.error("dispatch-outbox-relay failed", { eventID: record.eventID, error: err instanceof Error ? err.message : String(err) });
          batchItemFailures.push({ itemIdentifier: record.eventID ?? "" });
        }
      });
    } catch (err) {
      // Genuinely unparseable Streams image - no correlationId available at all.
      logger.error("dispatch-outbox-relay failed to parse Streams image", { eventID: record.eventID, error: err instanceof Error ? err.message : String(err) });
      batchItemFailures.push({ itemIdentifier: record.eventID ?? "" });
    }
  }

  return batchItemFailures;
}
