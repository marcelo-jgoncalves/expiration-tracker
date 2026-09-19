/**
 * NEW Lambda - D-300 (`reminder-producer-implementation-plan-scoping/DECISION.md` §1): consumes
 * `SQS_REMINDER_CLAIM_CANDIDATE_V1` candidates published directly (never via the outbox -
 * DECISION.md §4/§5, no aggregate transaction backs a claim candidate) by `scan-page.ts`'s
 * `SendMessageBatch` calls. Routes each candidate to the correct claim helper by
 * `data.entityKind` (mirroring the discriminator `producer.ts`'s own scan loop already uses for
 * the SAME two entity types sharing GSI3) - `claimReminderOccurrence` for `"REMINDER"`,
 * `claimChasingOccurrence` for `"CHASING"`. DELIBERATELY built on `buildReminderClaimConsumerDeps`
 * (`DynamoDbReminderStore`, never `DynamoDbReminderProducerStore`) - this Lambda's IAM role
 * (Terraform) never grants `gsi3_read`, and this is the matching code-level guarantee: nothing in
 * this file's dependency graph can even structurally reach GSI3 (proven by
 * `infra/tests/stack.tftest.hcl`'s new run block, DECISION.md §6).
 */
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildReminderClaimConsumerDeps } from "../composition/reminder.js";
import { claimReminderOccurrence } from "../../../modules/reminder/application/reminder-claim.js";
import { claimChasingOccurrence } from "../../../modules/subject/application/document-chasing-producer.js";
import { correlationIdFromSqsRecord, runWithContext } from "../../../shared/observability/context.js";
import { timeSpan, withHandlerTiming } from "../../../shared/observability/handler-timing.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { emitMetric } from "../../../shared/observability/metrics.js";
import { toAppError, ValidationError } from "../../../shared/errors/app-error.js";
import { mapWithConcurrency } from "../../../shared/concurrency/map-with-concurrency.js";
import type { ClaimCandidateCommand } from "../../../workers/reminder-scan/scan-page.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const deps = buildReminderClaimConsumerDeps(client, tableName);
const logger = new SecureLogger({ baseContext: { service: "reminder-claim-consumer" } });

const NAMESPACE = "ExpirationTracker/ReminderClaimConsumer";

// D-170/D-300: same bounded-concurrency reasoning as reminder-dispatch-handler.ts - batch
// entries are independent occurrences, processing them sequentially would serialize every
// message's DynamoDB round trips behind the previous one for no correctness reason.
const BATCH_CONCURRENCY = 8;

export const handler = withHandlerTiming<SQSEvent, SQSBatchResponse>(NAMESPACE, "reminder-claim-consumer handler", async (event) => {
  const results = await mapWithConcurrency(event.Records, BATCH_CONCURRENCY, async (record) => {
    await processRecord(record);
  });

  const batchItemFailures: { itemIdentifier: string }[] = [];
  results.forEach((result, i) => {
    if (!result.ok) batchItemFailures.push({ itemIdentifier: event.Records[i]!.messageId });
  });
  return { batchItemFailures };
});

async function processRecord(record: SQSEvent["Records"][number]): Promise<void> {
  const fallbackCorrelationId = correlationIdFromSqsRecord(record);
  await runWithContext({ correlationId: fallbackCorrelationId }, async () => {
    let command: ClaimCandidateCommand;
    try {
      command = JSON.parse(record.body) as ClaimCandidateCommand;
    } catch {
      logger.error("reminder-claim-consumer schema-invalid candidate payload", { messageId: record.messageId });
      throw new ValidationError("reminder-claim-consumer: malformed candidate payload.", { messageId: record.messageId });
    }

    await runWithContext({ correlationId: command.correlationId ?? fallbackCorrelationId, tenantId: command.tenantId }, async () => {
      try {
        const outcome = await timeSpan(NAMESPACE, "lambda.business_operation_ms", "reminder-claim-consumer business operation timing", async () => {
          if (command.data.entityKind === "CHASING") {
            return claimChasingOccurrence(
              { store: deps.store, tableName: deps.tableName, dueWorkTableName: deps.dueWorkTableName, now: deps.now, claimTtlMs: deps.claimTtlMs, newEventId: deps.newEventId, correlationId: deps.correlationId },
              { PK: command.data.PK, SK: command.data.SK },
            );
          }
          return claimReminderOccurrence(deps, { PK: command.data.PK, SK: command.data.SK }, command.tenantId);
        });
        logger.info("reminder-claim-consumer outcome", { messageId: record.messageId, entityKind: command.data.entityKind, outcome: outcome.kind });
        emitMetric(NAMESPACE, { name: "ClaimOutcome", value: 1, unit: "Count", dimensions: { outcome: outcome.kind } });
      } catch (err) {
        const appErr = toAppError(err);
        logger.error("reminder-claim-consumer failed", { messageId: record.messageId, errorCode: appErr.code, retryable: appErr.retryable, errorMessage: appErr.message });
        emitMetric(NAMESPACE, { name: "ClaimOutcome", value: 1, unit: "Count", dimensions: { outcome: "HANDLER_ERROR" } });
        throw err;
      }
    });
  });
}
