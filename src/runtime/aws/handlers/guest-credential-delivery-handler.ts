/** Real handler for GuestCredentialDelivery (DynamoDB Streams NEW_IMAGE off the DEDICATED
 * `guest-credential-delivery` table, D-226 decision central item 5 — never the main table's
 * own outbox relay). D-228 closes the gap D-222/D-227 named: this worker did not exist before.
 * Event Source Mapping filters `eventName = INSERT` in Terraform (`infra/main.tf`) — the
 * `record.eventName` re-check below is defense-in-depth, same posture
 * `dispatch-outbox-relay-processor.ts` already applies to its own filtered stream. Thin AWS
 * entrypoint only — real logic lives in `workers/guest-credential-delivery/deliver.ts`. */
import type { DynamoDBBatchResponse, DynamoDBStreamEvent } from "aws-lambda";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildGuestCredentialDeliveryDeps } from "../composition/document-archive.js";
import { deliverGuestCredential } from "../../../workers/guest-credential-delivery/deliver.js";
import type { GuestCredentialDeliveryRecord } from "../../../modules/document-archive/domain/guest-credential-delivery.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const deliveryTableName = process.env["GUEST_CREDENTIAL_DELIVERY_TABLE_NAME"];
const sesFromAddress = process.env["SES_FROM_ADDRESS"];
const sesConfigurationSet = process.env["SES_CONFIGURATION_SET"];
const guestUploadBaseUrl = process.env["GUEST_UPLOAD_BASE_URL"];
const failuresQueueUrl = process.env["GUEST_CREDENTIAL_DELIVERY_FAILURES_QUEUE_URL"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!deliveryTableName) throw new Error("GUEST_CREDENTIAL_DELIVERY_TABLE_NAME env var is required.");
if (!sesFromAddress) throw new Error("SES_FROM_ADDRESS env var is required.");
if (!sesConfigurationSet) throw new Error("SES_CONFIGURATION_SET env var is required.");
if (!failuresQueueUrl) throw new Error("GUEST_CREDENTIAL_DELIVERY_FAILURES_QUEUE_URL env var is required.");
const deps = buildGuestCredentialDeliveryDeps(client, tableName, deliveryTableName, sesFromAddress, sesConfigurationSet, failuresQueueUrl, guestUploadBaseUrl);
const logger = new SecureLogger({ baseContext: { service: "guest-credential-delivery" } });

function isDeliveryRecord(value: unknown): value is GuestCredentialDeliveryRecord {
  const v = value as Partial<GuestCredentialDeliveryRecord> | undefined;
  return typeof v?.tenantId === "string" && typeof v?.subjectId === "string" && typeof v?.documentRequestId === "string" && typeof v?.issuanceGeneration === "number" && typeof v?.token === "string";
}

export async function handler(event: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const streamRecord of event.Records) {
    if (streamRecord.eventName !== "INSERT") continue;
    const image = streamRecord.dynamodb?.NewImage;
    if (!image) continue;

    await runWithContext({ correlationId: streamRecord.dynamodb?.SequenceNumber ?? streamRecord.eventID ?? "unknown" }, async () => {
      try {
        const record = unmarshall(image as Record<string, never>) as unknown;
        if (!isDeliveryRecord(record) || record.entityType !== "GuestCredentialDelivery") {
          logger.error("guest-credential-delivery malformed Streams image", { eventID: streamRecord.eventID });
          batchItemFailures.push({ itemIdentifier: streamRecord.eventID ?? "" });
          return;
        }
        await runWithContext({ correlationId: streamRecord.eventID ?? "unknown", tenantId: record.tenantId }, async () => {
          const outcome = await deliverGuestCredential(deps, record);
          logger.info("guest-credential-delivery outcome", { documentRequestId: record.documentRequestId, outcome: outcome.kind });
          // D-233: SKIPPED_LEASE_ACTIVE must be retried like SEND_FAILED, never treated as a
          // completed/successful invocation - it's how a redelivery keeps happening until the
          // claim's lease expires and reconciles (see deliver.ts's header comment).
          if (outcome.kind === "SEND_FAILED" || outcome.kind === "SKIPPED_LEASE_ACTIVE") {
            batchItemFailures.push({ itemIdentifier: streamRecord.eventID ?? "" });
          }
        });
      } catch (err) {
        logger.error("guest-credential-delivery failed", { eventID: streamRecord.eventID, error: err instanceof Error ? err.message : String(err) });
        batchItemFailures.push({ itemIdentifier: streamRecord.eventID ?? "" });
      }
    });
  }

  return { batchItemFailures };
}
