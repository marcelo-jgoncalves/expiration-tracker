/** Real handler for DocumentChasingDispatch (SQS DocumentChasingDispatchQueue, M10 cluster 4,
 * D-039/D-046/D-048). Schema-validates against document-chasing-dispatch.v1.json before
 * processing - same discipline as reminder-dispatch-handler.ts (schema-invalid payload is a
 * poison message, not retryable). */
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildDocumentChasingDispatchDeps } from "../composition/subject.js";
import { dispatchChasingOccurrence } from "../../../workers/document-chasing-dispatch/dispatch.js";
import type { ChasingDispatchCommand } from "../../../modules/subject/application/document-chasing-producer.js";
import { correlationIdFromSqsRecord, runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const guestTokenPepper = process.env["GUEST_TOKEN_PEPPER"];
const sesFromAddress = process.env["SES_FROM_ADDRESS"];
const sesConfigurationSet = process.env["SES_CONFIGURATION_SET"];
const guestUploadBaseUrl = process.env["GUEST_UPLOAD_BASE_URL"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!guestTokenPepper) throw new Error("GUEST_TOKEN_PEPPER env var is required.");
if (!sesFromAddress) throw new Error("SES_FROM_ADDRESS env var is required.");
if (!sesConfigurationSet) throw new Error("SES_CONFIGURATION_SET env var is required.");
const deps = buildDocumentChasingDispatchDeps(client, tableName, guestTokenPepper, sesFromAddress, sesConfigurationSet, guestUploadBaseUrl);
const logger = new SecureLogger({ baseContext: { service: "document-chasing-dispatch" } });

const DISPATCH_COMMAND_SCHEMA_ID = "https://expiration-tracker/schemas/queues/document-chasing-dispatch.v1.json";

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    const fallbackCorrelationId = correlationIdFromSqsRecord(record);
    await runWithContext({ correlationId: fallbackCorrelationId }, async () => {
      try {
        const parsed: unknown = JSON.parse(record.body);
        const { valid, errors } = defaultSchemaRegistry.validate(DISPATCH_COMMAND_SCHEMA_ID, parsed);
        if (!valid) {
          logger.error("document-chasing-dispatch schema-invalid payload", { messageId: record.messageId, errors });
          batchItemFailures.push({ itemIdentifier: record.messageId });
          return;
        }
        const command = parsed as ChasingDispatchCommand;
        await runWithContext({ correlationId: command.correlationId ?? fallbackCorrelationId, tenantId: command.tenantId }, async () => {
          const outcome = await dispatchChasingOccurrence(deps, command);
          logger.info("document-chasing-dispatch outcome", { messageId: record.messageId, outcome: outcome.kind });
        });
      } catch (err) {
        logger.error("document-chasing-dispatch failed", { messageId: record.messageId, error: err instanceof Error ? err.message : String(err) });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    });
  }

  return { batchItemFailures };
}
