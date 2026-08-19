/** Real handler for ReminderProducer (EventBridge Scheduler, 1 min), replacing the 501 placeholder. */
import type { ScheduledEvent } from "aws-lambda";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildReminderProducerDeps } from "../composition/reminder.js";
import { runProducerTick } from "../../../workers/reminder-producer/producer.js";
import { defaultShardConfig } from "../../../modules/reminder/domain/shard-config.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const deps = buildReminderProducerDeps(client, tableName);
const logger = new SecureLogger({ baseContext: { service: "reminder-producer" } });

export async function handler(event: ScheduledEvent): Promise<void> {
  const tickMinute = new Date(event.time);
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
