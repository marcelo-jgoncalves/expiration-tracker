/** Real handler for ReminderProducer (EventBridge Scheduler, 1 min), replacing the 501
 * placeholder. EventBridge Scheduler's Lambda target does NOT wrap the payload in a
 * `detail` envelope the way legacy EventBridge Rules do - the event IS whatever `input`
 * the schedule sets (infra/lib/reminder-schedule.ts), never `event.time` (a Rule-shaped
 * field that doesn't exist for Scheduler invocations - bug found by Codex implementation
 * review, event.time was always undefined -> Invalid Date). */
import { randomUUID } from "node:crypto";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildReminderProducerDeps } from "../composition/reminder.js";
import { runProducerTick, shouldAlarm } from "../../../workers/reminder-producer/producer.js";
import { defaultShardConfig } from "../../../modules/reminder/domain/shard-config.js";
import { runWithContext } from "../../../shared/observability/context.js";
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
  // m5-observability-design.md #2: EventBridge Scheduler producer, no upstream request to
  // inherit a correlationId from - new UUID per invocation.
  await runWithContext({ correlationId: randomUUID() }, async () => {
    const result = await runProducerTick({ ...deps, shardConfig: defaultShardConfig() }, tickMinute);
    logger.info("reminder-producer tick complete", {
      scanned: result.scanned,
      claimed: result.claimed.length,
      chasingClaimed: result.chasingClaimed.length,
      failed: result.failed.length,
      unknownEntityType: result.unknownEntityType,
      minutesScanned: result.minutesScanned,
    });
    // Achado real de revisão adversarial (Codex, D-039/D-046/D-048): o comentário original de
    // producer.ts prometia que `unknownEntityType` seria "surfaced via failed so a real alarm
    // can fire", mas nada de fato lançava por causa dele - uma linha de GSI3 com forma
    // desconhecida ficava silenciosa em produção. Corrigido: decisão de alarme extraída para
    // `shouldAlarm()` (função pura, testada diretamente), separada de `failed` (uma linha
    // desconhecida nunca teria occurrenceId/tenantId reais para colocar lá).
    const alarm = shouldAlarm(result);
    if (alarm.alarm) {
      throw new Error(alarm.reason);
    }
  });
}
