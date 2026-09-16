/** Real handler for DispatchOutboxRelay (DynamoDB Streams NEW_IMAGE), replacing the 501
 * placeholder. Partial batch failure so a poison record doesn't block the rest of the
 * shard's batch (m3.5-runtime-design.md §"Decisão central"). Per-record processing logic
 * lives in dispatch-outbox-relay-processor.ts (no module-level side effects, unit-testable)
 * - this file is only the thin AWS entrypoint: real env vars, real clients, real deps.
 *
 * D-300 4th-bug incident (2026-09-16, `reminder-producer-implementation-plan-scoping/
 * DECISION.md` §8 second rollback): this file used to do its own env-var reads + call
 * `buildOutboxRelayDeps(...)` inline - and never grew a line for
 * `REMINDER_SCAN_CONTINUATION_QUEUE_URL` when D-300 added that destination, silently dropping
 * every `SQS_REMINDER_SCAN_CONTINUATION_V1` outbox record as SKIPPED_WRONG_DESTINATION from the
 * very first deploy. The env-to-deps composition now lives in
 * `buildDispatchOutboxRelayDepsFromEnv` (composition/reminder.ts) specifically so it's
 * unit-tested directly (test/unit/composition/reminder-outbox-relay-deps.test.ts) - a test
 * against the old inline code, or against `buildOutboxRelayDeps` alone, could never have caught
 * this exact omission. */
import type { DynamoDBBatchResponse, DynamoDBStreamEvent } from "aws-lambda";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildDispatchOutboxRelayDepsFromEnv } from "../composition/reminder.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { processStreamRecords } from "./dispatch-outbox-relay-processor.js";

const client = createDocumentClient();
const deps = buildDispatchOutboxRelayDepsFromEnv(process.env, client);
const logger = new SecureLogger({ baseContext: { service: "dispatch-outbox-relay" } });

export async function handler(event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> {
  const batchItemFailures = await processStreamRecords(deps, logger, event.Records);
  return { batchItemFailures };
}
