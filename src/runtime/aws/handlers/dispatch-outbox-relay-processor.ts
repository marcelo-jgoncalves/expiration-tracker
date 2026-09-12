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
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import { runWithContext } from "../../../shared/observability/context.js";
import type { SecureLogger } from "../../../shared/observability/logger.js";

// P2.1 (external audit 2026-09-11): this boundary used to go straight from `unmarshall` to a
// bare TypeScript cast, with no runtime check that the Streams image actually has the shape
// `OutboxRecord` claims - same class of gap `reminder-dispatch-handler.ts`'s
// `DISPATCH_COMMAND_SCHEMA_ID` validation already closes for its own SQS boundary, mirrored
// here rather than invented fresh.
const OUTBOX_RECORD_SCHEMA_ID = "https://expiration-tracker/schemas/events/outbox-record.v1.json";

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
      const raw: unknown = unmarshall(image as Record<string, never>);
      // Streams captures EVERY write to this table, not just OutboxEvent rows - this filter
      // stays BEFORE schema validation so every other entity type flowing through the same
      // stream is skipped silently, same as always, never validated against (and never
      // spamming a schema-invalid error for) a schema it was never meant to match.
      if ((raw as { entityType?: unknown }).entityType !== "OutboxEvent") continue;

      const { valid, errors } = defaultSchemaRegistry.validate(OUTBOX_RECORD_SCHEMA_ID, raw);
      if (!valid) {
        logger.error("dispatch-outbox-relay schema-invalid OutboxEvent image", { eventID: record.eventID, errors });
        batchItemFailures.push({ itemIdentifier: record.eventID ?? "" });
        continue;
      }
      const item = raw as OutboxRecord;

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
