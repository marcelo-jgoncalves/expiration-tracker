/** Real handler for DocumentRequestCredentialIssuance (SQS, fed by DispatchOutboxRelay/
 * OutboxSweeper's `SQS_DOCUMENT_REQUEST_CREDENTIAL_ISSUANCE_V1` destination) — D-226, closes
 * D-222 Achado 1. Runs on the GUEST Lambda deployment unit (has `DOCARCHIVE_GUEST_ACCESS_PEPPER`,
 * D-146) — same "thin AWS entrypoint, pure logic in application/" shape as
 * `requirement-evidence-refresh-handler.ts`. Never decodes anything beyond the 4 hint fields the
 * design specifies — `DocumentRequestCredentialIssuanceService.handle` always re-reads the
 * authoritative `DocumentRequest` before acting on it. */
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildDocumentRequestCredentialIssuanceDeps } from "../composition/document-archive.js";
import type { DocumentRequestCredentialIssuanceMessage } from "../../../modules/document-archive/application/document-request-credential-issuance-service.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const deliveryTableName = process.env["GUEST_CREDENTIAL_DELIVERY_TABLE_NAME"];
const guestAccessPepper = process.env["DOCARCHIVE_GUEST_ACCESS_PEPPER"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!deliveryTableName) throw new Error("GUEST_CREDENTIAL_DELIVERY_TABLE_NAME env var is required.");
if (!guestAccessPepper) throw new Error("DOCARCHIVE_GUEST_ACCESS_PEPPER env var is required.");
const service = buildDocumentRequestCredentialIssuanceDeps(client, tableName, deliveryTableName, guestAccessPepper);
const logger = new SecureLogger({ baseContext: { service: "document-request-credential-issuance" } });

function isCredentialIssuanceMessage(message: unknown): message is DocumentRequestCredentialIssuanceMessage {
  const m = message as Partial<DocumentRequestCredentialIssuanceMessage> | undefined;
  return typeof m?.tenantId === "string" && typeof m?.subjectId === "string" && typeof m?.documentRequestId === "string" && typeof m?.issuanceGeneration === "number";
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    await runWithContext({ correlationId: randomUUID() }, async () => {
      try {
        const raw = JSON.parse(record.body) as unknown;
        if (!isCredentialIssuanceMessage(raw)) {
          logger.error("document-request-credential-issuance malformed message", { messageId: record.messageId });
          batchItemFailures.push({ itemIdentifier: record.messageId });
          return;
        }
        const message: DocumentRequestCredentialIssuanceMessage = {
          tenantId: raw.tenantId,
          subjectId: raw.subjectId,
          documentRequestId: raw.documentRequestId,
          issuanceGeneration: raw.issuanceGeneration,
        };
        await runWithContext({ correlationId: randomUUID(), tenantId: message.tenantId }, async () => {
          const outcome = await service.handle(message);
          logger.info("document-request-credential-issuance outcome", { documentRequestId: message.documentRequestId, outcome: outcome.kind });
        });
      } catch (err) {
        logger.error("document-request-credential-issuance failed", { messageId: record.messageId, error: err instanceof Error ? err.message : String(err) });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    });
  }

  return { batchItemFailures };
}
