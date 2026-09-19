/** D-303: real-time relay for the dedicated ReminderDispatchOutboxTable stream - physically
 * isolated from the shared dispatch-outbox-relay's main-table stream (see decisions-log.md
 * D-303, docs/architecture/reviews/reminder-dispatch-control-plane/DECISION.md). Reuses
 * dispatch-outbox-relay-processor.ts's processStreamRecords unmodified (same OutboxRecord
 * shape, same partial-batch-failure semantics) - only the deps composition differs
 * (buildReminderDispatchOutboxOnlyRelayDepsFromEnv, composition/reminder.ts), pointed at this
 * table's own env vars instead of the shared relay's ~10 destination queue URLs. */
import type { DynamoDBBatchResponse, DynamoDBStreamEvent } from "aws-lambda";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildReminderDispatchOutboxOnlyRelayDepsFromEnv } from "../composition/reminder.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { processStreamRecords } from "./dispatch-outbox-relay-processor.js";

const client = createDocumentClient();
const deps = buildReminderDispatchOutboxOnlyRelayDepsFromEnv(process.env, client);
const logger = new SecureLogger({ baseContext: { service: "reminder-dispatch-outbox-relay" } });

export async function handler(event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> {
  const batchItemFailures = await processStreamRecords(deps, logger, event.Records);
  return { batchItemFailures };
}
