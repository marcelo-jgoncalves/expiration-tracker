/**
 * Real handler for the WhatsApp Cloud API webhook (D-197 fatia 3/5, D-7). Public, unauthenticated
 * API Gateway HTTP API route (no JWT authorizer - Meta calls this endpoint directly, there is no
 * user session) - `GET` is Meta's one-time webhook-registration handshake (verified against Meta
 * Cloud API docs, "Webhooks - Getting Started #verification-requests", 2026-09-07), `POST` is the
 * real delivery-status callback stream.
 *
 * G-V3 (quality gate for this fatia): signature verification happens BEFORE any persistence or
 * business logic, on the EXACT raw body bytes (never the re-serialized JSON) - `parseBody()`-
 * style JSON.parse only happens AFTER `verifyMetaSignature()` returns true. An invalid signature
 * short-circuits with 401 and writes nothing.
 *
 * Kill switch (D-10): checked ONLY to decide whether to persist/act on a valid, verified event -
 * the signature check and the 200 acknowledgement to Meta happen regardless of the flag (Meta
 * retries a webhook that doesn't return 2xx quickly - never want a kill switch flip to look like
 * an endpoint outage to Meta's own retry/backoff accounting). While disabled, a verified event is
 * logged and dropped without ever calling `processWhatsAppWebhook`.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { AppConfigDataClient } from "@aws-sdk/client-appconfigdata";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildWhatsAppWebhookDeps } from "../composition/notification.js";
import { processWhatsAppWebhook } from "../../../modules/notification/application/whatsapp-webhook-workflow.js";
import { verifyMetaSignature, verifyMetaWebhookChallenge, parseCloudApiWebhookEvents, type CloudApiWebhookPayload } from "../../../modules/notification/application/whatsapp-webhook-processor.js";
import { createSecretsManagerClient, loadWhatsAppSecrets, type WhatsAppSecrets } from "../../../modules/notification/persistence/secrets-manager-whatsapp-config.js";
import { AppConfigFeatureFlagsReader } from "../../../modules/extraction/persistence/appconfig-feature-flags-reader.js";
import { isWhatsAppDeliveryWorkerEnabled } from "../../../modules/notification/application/whatsapp-activation.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const whatsAppSecretId = process.env["WHATSAPP_SECRET_ID"];
const appConfigApplicationId = process.env["APPCONFIG_APPLICATION_ID"];
const appConfigEnvironmentId = process.env["APPCONFIG_ENVIRONMENT_ID"];
const appConfigConfigurationProfileId = process.env["APPCONFIG_CONFIGURATION_PROFILE_ID"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!whatsAppSecretId) throw new Error("WHATSAPP_SECRET_ID env var is required.");
if (!appConfigApplicationId) throw new Error("APPCONFIG_APPLICATION_ID env var is required.");
if (!appConfigEnvironmentId) throw new Error("APPCONFIG_ENVIRONMENT_ID env var is required.");
if (!appConfigConfigurationProfileId) throw new Error("APPCONFIG_CONFIGURATION_PROFILE_ID env var is required.");

const secretsClient = createSecretsManagerClient();
const featureFlagsReader = new AppConfigFeatureFlagsReader(new AppConfigDataClient({}), {
  applicationId: appConfigApplicationId,
  environmentId: appConfigEnvironmentId,
  configurationProfileId: appConfigConfigurationProfileId,
});

let secretsPromise: Promise<WhatsAppSecrets> | undefined;
async function getSecrets(): Promise<WhatsAppSecrets> {
  if (!secretsPromise) secretsPromise = loadWhatsAppSecrets(secretsClient, whatsAppSecretId!);
  return secretsPromise;
}

const workflowDeps = buildWhatsAppWebhookDeps(client, tableName);
const logger = new SecureLogger({ baseContext: { service: "whatsapp-webhook" } });

/** Extracts the exact raw body bytes API Gateway delivered, decoding base64 only when API
 * Gateway itself base64-encoded the payload - never re-serializing/re-encoding, since the
 * signature was computed over Meta's original bytes and any re-encoding could silently produce a
 * different byte sequence (e.g. different Unicode normalization or key order after a parse). */
function rawBody(event: APIGatewayProxyEventV2): string {
  if (!event.body) return "";
  return event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf-8") : event.body;
}

function jsonResult(statusCode: number, body: Record<string, unknown>): APIGatewayProxyStructuredResultV2 {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function textResult(statusCode: number, text: string): APIGatewayProxyStructuredResultV2 {
  return { statusCode, headers: { "content-type": "text/plain" }, body: text };
}

async function handleVerificationGet(event: APIGatewayProxyEventV2, verifyToken: string): Promise<APIGatewayProxyStructuredResultV2> {
  const qs = event.queryStringParameters ?? {};
  const result = verifyMetaWebhookChallenge({
    mode: qs["hub.mode"],
    verifyToken: qs["hub.verify_token"],
    challenge: qs["hub.challenge"],
    expectedVerifyToken: verifyToken,
  });
  if (!result.verified) {
    logger.warn("whatsapp-webhook GET verification failed", { mode: qs["hub.mode"] });
    return jsonResult(403, { error: "verification failed" });
  }
  return textResult(200, result.challenge);
}

async function handleStatusPost(event: APIGatewayProxyEventV2, secrets: WhatsAppSecrets): Promise<APIGatewayProxyStructuredResultV2> {
  const body = rawBody(event);
  // D-7: signature verification BEFORE any parsing or persistence - a missing/invalid signature
  // never reaches JSON.parse, never touches the store.
  const signatureHeader = event.headers["x-hub-signature-256"] ?? event.headers["X-Hub-Signature-256"];
  if (!verifyMetaSignature({ rawBody: body, signatureHeader, appSecret: secrets.appSecret })) {
    logger.warn("whatsapp-webhook signature verification failed - rejected before any processing");
    return jsonResult(401, { error: "invalid signature" });
  }

  let payload: CloudApiWebhookPayload;
  try {
    payload = JSON.parse(body) as CloudApiWebhookPayload;
  } catch {
    logger.error("whatsapp-webhook signature-valid but body is not valid JSON");
    // Still 200 - Meta only retries on a non-2xx response; a signature-valid-but-malformed body
    // is a Meta-side bug, not something retrying will fix, and never something to alarm-loop on.
    return jsonResult(200, { received: true });
  }

  let deliveryEnabled: boolean;
  try {
    const flags = await featureFlagsReader.getFlags();
    deliveryEnabled = isWhatsAppDeliveryWorkerEnabled(flags);
  } catch (err) {
    logger.error("whatsapp-webhook feature-flags read failed - fail-closed (treating as disabled)", { error: err instanceof Error ? err.message : String(err) });
    deliveryEnabled = false;
  }
  if (!deliveryEnabled) {
    logger.info("whatsapp-webhook kill switch off - verified event acknowledged but dropped without side effect");
    return jsonResult(200, { received: true });
  }

  const events = parseCloudApiWebhookEvents(payload);
  for (const statusEvent of events) {
    await runWithContext({ correlationId: `${statusEvent.wamid}#${statusEvent.statusType}`, tenantId: statusEvent.tags.tenantId }, async () => {
      try {
        const outcome = await processWhatsAppWebhook(workflowDeps, statusEvent);
        logger.info("whatsapp-webhook outcome", { wamid: statusEvent.wamid, statusType: statusEvent.statusType, outcome: outcome.kind });
      } catch (err) {
        // Never let one malformed/unexpected event fail the whole batch's 200 - Meta would
        // retry the ENTIRE payload (including events that already succeeded) on a non-2xx.
        // putIfAbsent's own idempotency means a safe retry is possible another way if needed;
        // logged loudly here since this path should be rare.
        logger.error("whatsapp-webhook event processing failed", { wamid: statusEvent.wamid, error: err instanceof Error ? err.message : String(err) });
      }
    });
  }

  return jsonResult(200, { received: true });
}

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  return runWithContext({ correlationId: event.requestContext.requestId }, async () => {
    const secrets = await (async () => {
      try {
        return await getSecrets();
      } catch (err) {
        logger.error("whatsapp-webhook failed to load secrets", { error: err instanceof Error ? err.message : String(err) });
        return undefined;
      }
    })();
    if (!secrets) return jsonResult(500, { error: "configuration error" });

    if (event.requestContext.http.method === "GET") {
      return handleVerificationGet(event, secrets.verifyToken);
    }
    if (event.requestContext.http.method === "POST") {
      return handleStatusPost(event, secrets);
    }
    return jsonResult(405, { error: "method not allowed" });
  });
}
