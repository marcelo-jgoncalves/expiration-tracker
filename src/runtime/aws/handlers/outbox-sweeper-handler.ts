/** Real handler for the shared outbox sweeper (EventBridge Scheduler, 5 min), covering
 * BOTH SQS_REMINDER_DISPATCH_V1 (M3.5) and SQS_NOTIFICATION_EMAIL_V1 (M4) in a single
 * privileged role - docs/architecture/m4-notification-engine-design.md §7.4: "não proponho
 * outro GSI nem scan... o sweeper existente deve evoluir para um roteador explícito por
 * destination", not a second sweeper querying the same global GSI6 partition. Recovers
 * publications the relay missed (Stream failure, crashed relay invocation) for either
 * destination - m3.5-runtime-design.md §"Decisão central".
 *
 * D-300 4th-bug incident (2026-09-16, `reminder-producer-implementation-plan-scoping/
 * DECISION.md` §8 second rollback): this file used to build its `senders` map inline and never
 * added an entry for `SQS_REMINDER_SCAN_CONTINUATION_V1` when D-300 shipped that destination,
 * silently dropping every scan-continuation record this sweeper's own recovery pass ever saw.
 * The env-to-deps composition now lives in `buildOutboxSweeperDepsFromEnv`
 * (composition/reminder.ts) specifically so it's unit-tested directly
 * (test/unit/composition/reminder-outbox-relay-deps.test.ts) - a test against the old inline
 * code could never have caught this exact omission. `leaseOwner` stays here (genuinely
 * per-invocation state, not composition). */
import { randomUUID } from "node:crypto";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildOutboxSweeperDepsFromEnv } from "../composition/reminder.js";
import { sweepPendingDispatch } from "../../../workers/dispatch-outbox-relay/relay.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { runWithContext } from "../../../shared/observability/context.js";

const client = createDocumentClient();
const deps = buildOutboxSweeperDepsFromEnv(process.env, client);
const logger = new SecureLogger({ baseContext: { service: "outbox-sweeper" } });

export async function handler(): Promise<void> {
  // Security audit trail fix (full-audit-round1-focused-round2-summary.md, achado real): this
  // handler never called runWithContext, so the security.global_index_access event emitted by
  // DynamoDbOutboxRelayStore.listPendingReminderDispatch (GSI6) during the sweep had no real
  // correlationId - see docs/architecture/reviews/security-audit-trail-design/.
  await runWithContext({ correlationId: randomUUID() }, async () => {
    const result = await sweepPendingDispatch({ ...deps, leaseOwner: `sweeper-${Date.now()}` });
    logger.info("outbox-sweeper complete", { ...result });
  });
}
