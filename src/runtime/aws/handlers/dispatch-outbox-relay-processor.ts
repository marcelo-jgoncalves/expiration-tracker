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
import { emitMetric } from "../../../shared/observability/metrics.js";

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
        // Real bug found live during D-300 revalidation (2026-09-15): this used to push a
        // schema-invalid record onto batchItemFailures (retryable). For a DynamoDB Streams
        // event source mapping (unlike SQS), ReportBatchItemFailures retries starting AT the
        // earliest reported failure's position - NOT that record alone - so a PERMANENTLY
        // malformed record (one that will fail identical validation on every future retry,
        // since its image is an immutable historical snapshot no update to the live item can
        // retroactively change) blocks its entire stream shard forever with
        // MaximumRetryAttempts=-1 (infra/main.tf's dispatch_outbox_relay event source mapping):
        // every record after it in the same shard - including perfectly valid ones - starves
        // behind it, never delivered. Observed live: a single bad deploy produced ~dozens of
        // aggregateVersion:0 records (fixed in PR #338); even AFTER the fix deployed, brand
        // new valid records sat un-relayed for 15+ minutes because the shard was still stuck
        // retrying the OLD poisoned ones. A schema-invalid record can never become valid via
        // retry - this is a genuine poison-message case, not a transient one - so it must be
        // logged and SKIPPED (never added to batchItemFailures), same "terminal, not
        // retryable" treatment as the unparseable-image catch block below.
        logger.error("dispatch-outbox-relay schema-invalid OutboxEvent image - skipping (poison, not retryable)", { eventID: record.eventID, errors });
        continue;
      }
      const item = raw as OutboxRecord;

      // m5-observability-design.md #2: DynamoDB Streams fallback is the record's own
      // SequenceNumber, not eventId (that fallback is the sweeper's, via
      // outboxRecordCorrelationId - a different source per the design's table).
      const correlationId = item.correlationId ?? record.dynamodb?.SequenceNumber ?? record.eventID ?? "unknown";
      // E-018/E-021 (D-290): tenantId added here specifically so the outcome log line below
      // carries it - Logs Insights per-tenant investigation queries (`infra/modules/
      // observability-dashboard/`) rely on it, same as guest-credential-delivery-handler.ts
      // already did before this change (this was the one pipeline of the 3 missing it, Codex
      // round 2 finding).
      await runWithContext({ correlationId, tenantId: item.tenantId }, async () => {
        // try/catch stays INSIDE runWithContext so a failure log still carries this
        // record's correlationId - a catch wrapping runWithContext itself would run after
        // AsyncLocalStorage.run() already restored the outer (empty) context. This is also
        // what proves partial batch failure preserves isolation (§5): record N+1 gets its
        // own runWithContext call regardless of whether record N's callback threw.
        try {
          const outcome = await relayStreamRecord({ ...deps, leaseOwner: `relay-${record.eventID}` }, item);
          logger.info("dispatch-outbox-relay outcome", { eventId: item.eventId, outcome: outcome.kind });
          // Outcome is one of relay.ts's own 5 closed kinds (PUBLISHED/SKIPPED_WRONG_DESTINATION/
          // SKIPPED_ALREADY_PUBLISHED/SKIPPED_LEASE_HELD/FAILED) - never DeliverySucceeded/Failed,
          // this only proves the message reached the right queue, never that a recipient
          // actually received it (Codex round 1 naming finding).
          emitMetric("ExpirationTracker/DispatchOutboxRelay", { name: "OutboxPublishOutcome", value: 1, unit: "Count", dimensions: { Outcome: outcome.kind } });
          if (outcome.kind === "FAILED") {
            batchItemFailures.push({ itemIdentifier: record.eventID ?? "" });
          }
        } catch (err) {
          logger.error("dispatch-outbox-relay failed", { eventID: record.eventID, outcome: "HANDLER_ERROR", error: err instanceof Error ? err.message : String(err) });
          emitMetric("ExpirationTracker/DispatchOutboxRelay", { name: "OutboxPublishOutcome", value: 1, unit: "Count", dimensions: { Outcome: "HANDLER_ERROR" } });
          batchItemFailures.push({ itemIdentifier: record.eventID ?? "" });
        }
      });
    } catch (err) {
      // Genuinely unparseable Streams image - no correlationId available at all. Same poison-
      // message reasoning as the schema-invalid branch above: an image that fails to unmarshall
      // is an immutable historical snapshot, never retryable into success - skip, don't block
      // the shard forever.
      logger.error("dispatch-outbox-relay failed to parse Streams image - skipping (poison, not retryable)", { eventID: record.eventID, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return batchItemFailures;
}
