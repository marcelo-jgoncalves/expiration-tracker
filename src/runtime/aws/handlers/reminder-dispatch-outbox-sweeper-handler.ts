/** D-303: periodic (EventBridge Scheduler) catch-up sweep for the dedicated
 * ReminderDispatchOutboxTable - recovers publications the relay missed (Stream failure, crashed
 * relay invocation), same role the shared outbox-sweeper plays for the main table. Reuses
 * sweepPendingDispatch unmodified; deps come from buildReminderDispatchOutboxOnlyRelayDepsFromEnv
 * (composition/reminder.ts), whose single-entry senders map naturally limits the sweep to
 * SQS_REMINDER_DISPATCH_V1 only (sweepPendingDispatch defaults `destinations` to
 * `Object.keys(deps.senders)`) - never touches the main table or any other destination. */
import { randomUUID } from "node:crypto";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildReminderDispatchOutboxOnlyRelayDepsFromEnv } from "../composition/reminder.js";
import { sweepPendingDispatch } from "../../../workers/dispatch-outbox-relay/relay.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { runWithContext } from "../../../shared/observability/context.js";

const client = createDocumentClient();
const deps = buildReminderDispatchOutboxOnlyRelayDepsFromEnv(process.env, client);
const logger = new SecureLogger({ baseContext: { service: "reminder-dispatch-outbox-sweeper" } });

export async function handler(): Promise<void> {
  await runWithContext({ correlationId: randomUUID() }, async () => {
    const result = await sweepPendingDispatch({ ...deps, leaseOwner: `sweeper-${Date.now()}` });
    logger.info("reminder-dispatch-outbox-sweeper complete", { ...result });
  });
}
