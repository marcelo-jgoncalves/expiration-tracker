/** Real handler for ImportCommit (SQS ImportCommitQueue, M11, D-042). Schema-validates
 * against import-commit.v1.json before processing - same discipline as
 * reminder-dispatch-handler.ts (schema-invalid payload is a poison message, not retryable). */
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildImportCommitWorkerDeps } from "../composition/import.js";
import { commitImportJob } from "../../../modules/import/application/import-commit-service.js";
import type { ImportCommitCommand } from "../../../modules/import/application/import-service.js";
import type { RequestContext } from "../../../modules/identity/domain/request-context.js";
import { correlationIdFromSqsRecord, runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const planBucket = process.env["IMPORT_PLAN_BUCKET_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!planBucket) throw new Error("IMPORT_PLAN_BUCKET_NAME env var is required.");
const deps = buildImportCommitWorkerDeps(client, tableName, planBucket);
const logger = new SecureLogger({ baseContext: { service: "import-commit" } });

const IMPORT_COMMIT_SCHEMA_ID = "https://expiration-tracker/schemas/queues/import-commit.v1.json";

/** Este worker é uma retomada assíncrona de uma transição JÁ autorizada de forma síncrona em
 * ImportService.requestCommit() (JWT real, roles reais do usuário) - authorize() dentro de
 * SubjectService.createSubject() só verifica papel suficiente para "subject:create"
 * (WRITE_ROLES), nunca identidade/posse; um papel sintético OWNER aqui reflete fielmente que a
 * decisão de autorização real já ocorreu, não concede nada novo. */
function systemContextFor(command: ImportCommitCommand): RequestContext {
  return {
    requestId: command.messageId,
    correlationId: command.correlationId,
    principal: { userId: "system:import-commit", cognitoSubject: "system:import-commit", sessionId: "system:import-commit" },
    tenant: { tenantId: command.tenantId, roles: ["OWNER"] },
    auth: { issuedAt: command.createdAt, expiresAt: command.createdAt, tokenId: command.messageId },
  };
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    const fallbackCorrelationId = correlationIdFromSqsRecord(record);
    await runWithContext({ correlationId: fallbackCorrelationId }, async () => {
      try {
        const parsed: unknown = JSON.parse(record.body);
        const { valid, errors } = defaultSchemaRegistry.validate(IMPORT_COMMIT_SCHEMA_ID, parsed);
        if (!valid) {
          logger.error("import-commit schema-invalid payload", { messageId: record.messageId, errors });
          batchItemFailures.push({ itemIdentifier: record.messageId });
          return;
        }
        const command = parsed as ImportCommitCommand;
        await runWithContext({ correlationId: command.correlationId ?? fallbackCorrelationId, tenantId: command.tenantId }, async () => {
          const outcome = await commitImportJob(deps, systemContextFor(command), command.data.jobId);
          logger.info("import-commit outcome", { messageId: record.messageId, outcome: outcome.kind });
        });
      } catch (err) {
        logger.error("import-commit failed", { messageId: record.messageId, error: err instanceof Error ? err.message : String(err) });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    });
  }

  return { batchItemFailures };
}
