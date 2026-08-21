/** Real handler for SesCallbackWorker (SQS SesCallbackQueue, subscribed to the SES
 * Configuration Set's SNS topic), M4. Parses the raw SNS envelope + SES event JSON into the
 * normalized ParsedSesCallbackEvent shape ses-callback-workflow.ts operates on - kept here,
 * not in the workflow, so the workflow stays testable without SES/SNS-specific parsing. */
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildSesCallbackDeps } from "../composition/notification.js";
import { processSesCallback, type ParsedSesCallbackEvent } from "../../../modules/notification/application/ses-callback-workflow.js";
import type { SesCallbackEventKind } from "../../../modules/notification/application/ses-callback-processor.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const providerAccountId = process.env["SES_ACCOUNT_ALIAS"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!providerAccountId) throw new Error("SES_ACCOUNT_ALIAS env var is required.");
const deps = buildSesCallbackDeps(client, tableName, providerAccountId);
const logger = new SecureLogger({ baseContext: { service: "ses-callback" } });

interface SnsEnvelope {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Message: string;
}

interface SesEventJson {
  eventType: "Delivery" | "Bounce" | "Complaint" | "Reject" | "Rendering Failure";
  mail: { messageId: string; timestamp: string; tags?: Record<string, string[]> };
}

const EVENT_KIND_BY_SES_TYPE: Partial<Record<SesEventJson["eventType"], SesCallbackEventKind>> = {
  Delivery: "DELIVERY",
  Bounce: "BOUNCE",
  Complaint: "COMPLAINT",
};

function firstTag(tags: Record<string, string[]> | undefined, name: string): string | undefined {
  return tags?.[name]?.[0];
}

/** Never throws on malformed input - an unparseable message is logged and skipped (not
 * retried into a redrive loop that will never succeed), never crashes the whole batch. */
function parseSesCallback(body: string): ParsedSesCallbackEvent | undefined {
  const envelope = JSON.parse(body) as SnsEnvelope;
  const sesEvent = JSON.parse(envelope.Message) as SesEventJson;
  const eventKind = EVENT_KIND_BY_SES_TYPE[sesEvent.eventType];
  if (!eventKind) return undefined; // Reject/Rendering Failure - not handled as attempt transitions in M4

  return {
    snsMessageId: envelope.MessageId,
    eventKind,
    providerMessageId: sesEvent.mail.messageId,
    tags: {
      attemptId: firstTag(sesEvent.mail.tags, "et_attempt_id"),
      intentId: firstTag(sesEvent.mail.tags, "et_intent_id"),
      tenantId: firstTag(sesEvent.mail.tags, "et_tenant_id"),
    },
    occurredAt: sesEvent.mail.timestamp,
  };
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    // m5-observability-design.md #2: no business correlationId travels in the SES/SNS
    // event JSON - fall back to the SQS messageId, same fallback used for any pre-M5 message.
    await runWithContext({ correlationId: record.messageId }, async () => {
      try {
        const parsedEvent = parseSesCallback(record.body);
        if (!parsedEvent) {
          logger.info("ses-callback unhandled event type, skipping", { messageId: record.messageId });
          return;
        }
        // m5-observability-design.md #2: nest tenantId once known from the SES message tags,
        // without mutating the outer per-record context (AsyncLocalStorage.run composition).
        await runWithContext({ correlationId: record.messageId, tenantId: parsedEvent.tags.tenantId }, async () => {
          const outcome = await processSesCallback(deps, parsedEvent);
          logger.info("ses-callback outcome", { messageId: record.messageId, outcome: outcome.kind });
        });
      } catch (err) {
        logger.error("ses-callback failed", { messageId: record.messageId, error: err instanceof Error ? err.message : String(err) });
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    });
  }

  return { batchItemFailures };
}
