/** Real handler for ReminderProducer (EventBridge Scheduler, 1 min), replacing the 501
 * placeholder. EventBridge Scheduler's Lambda target does NOT wrap the payload in a
 * `detail` envelope the way legacy EventBridge Rules do - the event IS whatever `input`
 * the schedule sets (infra/lib/reminder-schedule.ts), never `event.time` (a Rule-shaped
 * field that doesn't exist for Scheduler invocations - bug found by Codex implementation
 * review, event.time was always undefined -> Invalid Date).
 *
 * D-300 (`reminder-producer-implementation-plan-scoping/DECISION.md` §1/§8): this handler is now
 * DUAL-TRIGGER - EventBridge Scheduler (unchanged event shape above) AND the new SQS scan queue
 * (continuation messages `scan-page.ts`'s lease transitions write). `SCAN_MODE` (`LEGACY` |
 * `PAGED`) gates which EventBridge-side logic runs: `LEGACY` (the safe default this deploy ships
 * with, per DECISION.md §8's staged rollout) runs the ORIGINAL `runProducerTick` byte-for-byte
 * unchanged; `PAGED` runs the new enumeration+acquire/reclaim worker instead, and the actual GSI3
 * paging happens entirely in the SQS-triggered path below. `SCAN_MODE_EPOCH` fences residual SQS
 * messages from before a rollback (DECISION.md §8) - read once per invocation, passed straight
 * through to `runScanPage`/`runEnumerationTick`, never cached across invocations (a fresh Lambda
 * environment always re-reads its current env, and env var changes always trigger a genuinely new
 * deploy/version in this codebase's Lambdas). */
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { SQSClient } from "@aws-sdk/client-sqs";
import { buildReminderProducerDeps, buildReminderEnumerationDeps, buildReminderScanPageDeps } from "../composition/reminder.js";
import { runProducerTick, shouldAlarm } from "../../../workers/reminder-producer/producer.js";
import { runEnumerationTick } from "../../../workers/reminder-scan/enumerate-and-lease.js";
import { runScanPage } from "../../../workers/reminder-scan/scan-page.js";
import type { ReminderScanContinuationCommand } from "../../../workers/reminder-scan/lease.js";
import { defaultShardConfig } from "../../../modules/reminder/domain/shard-config.js";
import { runWithContext, correlationIdFromSqsRecord } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { emitMetric } from "../../../shared/observability/metrics.js";
import { timeSpan, withHandlerTiming } from "../../../shared/observability/handler-timing.js";
import { ValidationError } from "../../../shared/errors/app-error.js";
import { mapWithConcurrency } from "../../../shared/concurrency/map-with-concurrency.js";

const client = createDocumentClient();
const envTableName = process.env["TABLE_NAME"];
if (!envTableName) throw new Error("TABLE_NAME env var is required.");
const tableName: string = envTableName;
const deps = buildReminderProducerDeps(client, tableName);
const logger = new SecureLogger({ baseContext: { service: "reminder-producer" } });
const NAMESPACE = "ExpirationTracker/ReminderProducer";

/** `LEGACY` (default if unset - safe posture, DECISION.md §8) never touches the new lease/scan
 * machinery at all; `PAGED` is the fully-migrated behavior. There is no third value - an
 * unrecognized `SCAN_MODE` is treated as `LEGACY` (fail toward the already-proven behavior, never
 * toward the new one). */
function scanMode(): "LEGACY" | "PAGED" {
  return process.env["SCAN_MODE"] === "PAGED" ? "PAGED" : "LEGACY";
}

function rolloutEpoch(): number {
  const raw = process.env["SCAN_MODE_EPOCH"];
  const parsed = raw ? Number.parseInt(raw, 10) : 1;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function claimQueueUrl(): string {
  const url = process.env["REMINDER_CLAIM_QUEUE_URL"];
  if (!url) throw new Error("REMINDER_CLAIM_QUEUE_URL env var is required when SCAN_MODE=PAGED.");
  return url;
}

let sqsClient: SQSClient | undefined;
function getSqsClient(): SQSClient {
  sqsClient ??= new SQSClient({});
  return sqsClient;
}

export interface ReminderProducerEvent {
  scheduledTime: string;
}

function isSqsEvent(event: ReminderProducerEvent | SQSEvent): event is SQSEvent {
  return Array.isArray((event as SQSEvent).Records);
}

export const handler = withHandlerTiming<ReminderProducerEvent | SQSEvent, void | SQSBatchResponse>(NAMESPACE, "reminder-producer handler", async (event) => {
  if (isSqsEvent(event)) {
    return runScanQueueBatch(event);
  }
  return runEventBridgeTick(event);
});

async function runEventBridgeTick(event: ReminderProducerEvent): Promise<void> {
  const receivedAt = new Date().toISOString();
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
    if (scanMode() === "LEGACY") {
      const result = await timeSpan(NAMESPACE, "lambda.business_operation_ms", "reminder-producer business operation timing", () =>
        runProducerTick({ ...deps, shardConfig: defaultShardConfig() }, tickMinute),
      );
      logger.info("reminder-producer tick complete", {
        scanned: result.scanned,
        claimed: result.claimed.length,
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
      return;
    }

    // PAGED: enumeration + acquire/reclaim only - the actual GSI3 paging happens in the SQS
    // scan-queue path below, driven by the continuation message either transition writes.
    const enumerationDeps = buildReminderEnumerationDeps(client, tableName, rolloutEpoch());
    const result = await timeSpan(NAMESPACE, "lambda.business_operation_ms", "reminder-scan enumeration timing", () => runEnumerationTick(enumerationDeps, tickMinute));
    logger.info("reminder-scan enumeration tick complete", {
      scheduledTime: event.scheduledTime,
      receivedAt,
      acquired: result.acquired.length,
      reclaimed: result.reclaimed.length,
      contended: result.contended,
      completed: result.completed,
      lostRace: result.lostRace,
      minutesScanned: result.minutesScanned,
      shardPartitionsScanned: result.shardPartitionsScanned,
    });
    emitMetric(NAMESPACE, { name: "LeaseAcquireOutcome", value: result.acquired.length, unit: "Count", dimensions: { Outcome: "acquired" } });
    emitMetric(NAMESPACE, { name: "LeaseAcquireOutcome", value: result.reclaimed.length, unit: "Count", dimensions: { Outcome: "reclaimed" } });
    emitMetric(NAMESPACE, { name: "LeaseAcquireOutcome", value: result.contended, unit: "Count", dimensions: { Outcome: "contended" } });
  });
}

const SCAN_QUEUE_CONCURRENCY = 5;

async function runScanQueueBatch(event: SQSEvent): Promise<SQSBatchResponse> {
  const results = await mapWithConcurrency(event.Records, SCAN_QUEUE_CONCURRENCY, async (record) => {
    await processScanQueueRecord(record);
  });
  const batchItemFailures: { itemIdentifier: string }[] = [];
  results.forEach((result, i) => {
    if (!result.ok) batchItemFailures.push({ itemIdentifier: event.Records[i]!.messageId });
  });
  return { batchItemFailures };
}

async function processScanQueueRecord(record: SQSEvent["Records"][number]): Promise<void> {
  const fallbackCorrelationId = correlationIdFromSqsRecord(record);
  await runWithContext({ correlationId: fallbackCorrelationId }, async () => {
    let command: ReminderScanContinuationCommand;
    try {
      command = JSON.parse(record.body) as ReminderScanContinuationCommand;
    } catch {
      logger.error("reminder-scan schema-invalid continuation payload", { messageId: record.messageId });
      throw new ValidationError("reminder-scan: malformed continuation payload.", { messageId: record.messageId });
    }

    await runWithContext({ correlationId: command.correlationId ?? fallbackCorrelationId }, async () => {
      const scanPageDeps = buildReminderScanPageDeps(client, tableName, getSqsClient(), claimQueueUrl(), rolloutEpoch());
      const outcome = await timeSpan(NAMESPACE, "PageDurationMs", "reminder-scan page timing", () =>
        runScanPage(scanPageDeps, {
          ref: { shardFnVersion: command.data.shardFnVersion, shardId: command.data.shardId, minuteISO: command.data.minuteISO },
          ownerToken: command.data.ownerToken,
          startedFromLastEvaluatedKey: command.data.lastEvaluatedKey,
          messageRolloutEpoch: command.data.rolloutEpoch,
        }),
      );
      logger.info("reminder-scan page outcome", { messageId: record.messageId, outcome: outcome.kind });
      if (outcome.kind === "STALE_EPOCH_DROPPED") {
        emitMetric(NAMESPACE, { name: "StaleEpochMessageDropped", value: 1, unit: "Count" });
      }
      if (outcome.kind === "PROCESSED") {
        emitMetric(NAMESPACE, { name: "PagesScanned", value: 1, unit: "Count" });
        emitMetric(NAMESPACE, { name: "CandidatesPublishedPerPage", value: outcome.candidatesPublished, unit: "Count" });
      }
    });
  });
}
