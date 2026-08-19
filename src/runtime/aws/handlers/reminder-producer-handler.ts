/** Real handler for ReminderProducer (EventBridge Scheduler, 1 min), replacing the 501
 * placeholder. EventBridge Scheduler's Lambda target does NOT wrap the payload in a
 * `detail` envelope the way legacy EventBridge Rules do - the event IS whatever `input`
 * the schedule sets (infra/lib/reminder-schedule.ts), never `event.time` (a Rule-shaped
 * field that doesn't exist for Scheduler invocations - bug found by Codex implementation
 * review, event.time was always undefined -> Invalid Date). */
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildReminderProducerDeps } from "../composition/reminder.js";
import { runProducerTick } from "../../../workers/reminder-producer/producer.js";
import { defaultShardConfig } from "../../../modules/reminder/domain/shard-config.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { ValidationError } from "../../../shared/errors/app-error.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const deps = buildReminderProducerDeps(client, tableName);
const logger = new SecureLogger({ baseContext: { service: "reminder-producer" } });

export interface ReminderProducerEvent {
  scheduledTime: string;
}

export async function handler(event: ReminderProducerEvent): Promise<void> {
  if (!event.scheduledTime) {
    throw new ValidationError("reminder-producer: missing scheduledTime in event payload.");
  }
  const tickMinute = new Date(event.scheduledTime);
  if (Number.isNaN(tickMinute.getTime())) {
    throw new ValidationError("reminder-producer: scheduledTime is not a valid date.", { scheduledTime: event.scheduledTime });
  }
  const result = await runProducerTick({ ...deps, shardConfig: defaultShardConfig() }, tickMinute);
  logger.info("reminder-producer tick complete", {
    scanned: result.scanned,
    claimed: result.claimed.length,
    failed: result.failed.length,
    minutesScanned: result.minutesScanned,
  });
  if (result.failed.length > 0) {
    // Non-conditional failures (not claim-race losses) - surfaced so CloudWatch alarms on
    // Lambda errors fire; the next tick's lookback window still covers these occurrences.
    throw new Error(`reminder-producer: ${result.failed.length} occurrence(s) failed to claim`);
  }
}
