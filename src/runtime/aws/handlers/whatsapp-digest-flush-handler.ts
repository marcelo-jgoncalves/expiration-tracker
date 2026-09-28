/** Real handler for WhatsAppDigestFlushWorker (EventBridge Scheduler) - D-347 §3.5. Same
 * "top-level `input`, never `event.detail`" contract as `scheduled-reports-scheduler-handler.ts`
 * (EventBridge Scheduler does NOT wrap the payload in a `detail` envelope the way legacy
 * EventBridge Rules do). Wired to real infra (Lambda resource + EventBridge Scheduler schedule +
 * IAM) in `infra/main.tf`. */
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildWhatsAppDigestFlushDeps } from "../composition/notification.js";
import { runWhatsAppDigestFlushTick, shouldAlarmWhatsAppDigestFlush } from "../../../workers/whatsapp-digest-flush/flush.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const deps = buildWhatsAppDigestFlushDeps(client, tableName);
const logger = new SecureLogger({ baseContext: { service: "whatsapp-digest-flush" } });

export interface WhatsAppDigestFlushSchedulerEvent {
  scheduledTime: string;
}

export async function handler(event: WhatsAppDigestFlushSchedulerEvent): Promise<void> {
  // Scheduler producer, no upstream request to inherit a correlationId from (same posture as
  // scheduled-reports-scheduler-handler.ts) - new correlationId per invocation.
  const correlationId = `whatsapp-digest-flush-${event.scheduledTime}`;
  await runWithContext({ correlationId }, () => handleTick(event));
}

async function handleTick(event: WhatsAppDigestFlushSchedulerEvent): Promise<void> {
  const result = await runWhatsAppDigestFlushTick(deps);
  logger.info("whatsapp-digest-flush tick complete", { scheduledTime: event.scheduledTime, ...result, failed: result.failed.length });
  const alarm = shouldAlarmWhatsAppDigestFlush(result);
  if (alarm.alarm) {
    throw new Error(alarm.reason);
  }
}
