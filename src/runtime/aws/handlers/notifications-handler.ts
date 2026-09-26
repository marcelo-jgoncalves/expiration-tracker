/** Real handler for /notifications/preferences routes (M4 backlog item closed: previously
 * NotificationPreferences was only ever created via onboarding, with no HTTP endpoint for a
 * user to read/edit them afterward). Same pattern as items-handler.ts/reminders-handler.ts.
 *
 * Item 26 (NEXT_SESSION_PROMPT.md, 2026-09-23) added the two `whatsapp-opt-in/*` confirmation
 * routes, which need the WhatsApp Cloud API credentials + `WHATSAPP` flag — sourced the SAME way
 * `whatsapp-delivery-handler.ts` already does (Secrets Manager, AppConfig), loaded once per cold
 * start via the same memoized-promise pattern that file uses, rather than duplicating a second
 * bespoke wiring path. Unlike that worker, a missing/unconfigured WhatsApp secret here must never
 * crash the whole Lambda (this handler ALSO serves `/notifications/preferences`, which has nothing
 * to do with WhatsApp) — it fails closed instead, forcing `isWhatsAppChannelEnabled()` to `false`
 * so `WhatsAppPhoneConfirmationService.requestConfirmation()` returns a clean 503 rather than
 * crashing the send. */
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { AppConfigDataClient } from "@aws-sdk/client-appconfigdata";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildIdentityDeps } from "../composition/identity.js";
import { buildNotificationHttpDeps, buildWhatsAppPhoneConfirmationDeps } from "../composition/notification.js";
import {
  handleGetPreferences,
  handleUpdatePreferences,
  handleRecordWhatsAppOptIn,
  handleRequestWhatsAppPhoneConfirmation,
  handleConfirmWhatsAppPhoneConfirmation,
  type NotificationHttpDeps,
} from "../../../modules/notification/http/preferences-handlers.js";
import { extractClaims, parseBody, toApiGatewayResult } from "../http-adapter.js";
import { toAppError, ValidationError } from "../../../shared/errors/app-error.js";
import { runWithContext } from "../../../shared/observability/context.js";
import { SecureLogger } from "../../../shared/observability/logger.js";
import { WhatsAppCloudApiAdapter } from "../../../modules/notification/providers/whatsapp-cloud-api-adapter.js";
import type { WhatsAppProviderAdapter } from "../../../modules/notification/ports/whatsapp-provider.js";
import { createSecretsManagerClient, loadWhatsAppSecrets } from "../../../modules/notification/persistence/secrets-manager-whatsapp-config.js";
import { AppConfigFeatureFlagsReader } from "../../../modules/extraction/persistence/appconfig-feature-flags-reader.js";
import { isWhatsAppChannelEnabled } from "../../../modules/notification/application/whatsapp-activation.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const { resolver, quota } = buildIdentityDeps(client, tableName);
const { preferences, whatsAppOptIn } = buildNotificationHttpDeps(client, tableName);
const logger = new SecureLogger({ baseContext: { service: "notifications-handler" } });

// Same reused pepper as memberships-handler.ts's invitationTokenPepper (GUEST_TOKEN_PEPPER) - "no
// cross-family confusion, a brand new Secrets Manager secret would be disproportionate" for one
// more HMAC pepper, per organization.ts's own documented rationale.
const guestTokenPepper = process.env["GUEST_TOKEN_PEPPER"];
const whatsAppSecretId = process.env["WHATSAPP_SECRET_ID"];
const whatsAppApiVersion = process.env["WHATSAPP_API_VERSION"] ?? "v21.0";
const appConfigApplicationId = process.env["APPCONFIG_APPLICATION_ID"];
const appConfigEnvironmentId = process.env["APPCONFIG_ENVIRONMENT_ID"];
const appConfigConfigurationProfileId = process.env["APPCONFIG_CONFIGURATION_PROFILE_ID"];

const featureFlagsReader =
  appConfigApplicationId && appConfigEnvironmentId && appConfigConfigurationProfileId
    ? new AppConfigFeatureFlagsReader(new AppConfigDataClient({}), {
        applicationId: appConfigApplicationId,
        environmentId: appConfigEnvironmentId,
        configurationProfileId: appConfigConfigurationProfileId,
      })
    : undefined;

const secretsClient = whatsAppSecretId ? createSecretsManagerClient() : undefined;
let whatsAppProviderPromise: Promise<WhatsAppProviderAdapter> | undefined;
async function getWhatsAppProvider(): Promise<WhatsAppProviderAdapter> {
  if (!whatsAppProviderPromise) {
    whatsAppProviderPromise = (async () => {
      const secrets = await loadWhatsAppSecrets(secretsClient!, whatsAppSecretId!);
      return new WhatsAppCloudApiAdapter({ accessToken: secrets.accessToken, phoneNumberId: secrets.phoneNumberId, apiVersion: whatsAppApiVersion });
    })();
  }
  return whatsAppProviderPromise;
}

/** Fresh per call (never memoized past a single request) - a kill switch flip must take effect
 * immediately, same discipline `whatsapp-delivery-handler.ts` uses per SQS batch. Fails closed on
 * ANY gap (missing config, secret unavailable, AppConfig read error) - never assumes enabled. */
async function resolveWhatsAppChannelEnabled(): Promise<boolean> {
  if (!featureFlagsReader || !whatsAppSecretId || !guestTokenPepper) return false;
  try {
    const flags = await featureFlagsReader.getFlags();
    return isWhatsAppChannelEnabled(flags);
  } catch (err) {
    logger.error("notifications-handler feature-flags read failed - fail-closed (treating WhatsApp as disabled)", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

// Built once at module scope, not per-request - `isWhatsAppChannelEnabled` itself stays a lazy
// closure (evaluated only when `requestConfirmation()` actually runs), so routes unrelated to
// WhatsApp never pay for an AppConfig read.
const whatsAppPhoneConfirmation = buildWhatsAppPhoneConfirmationDeps(
  client,
  tableName,
  whatsAppOptIn,
  { send: async (input) => (await getWhatsAppProvider()).send(input) },
  guestTokenPepper ?? "",
  resolveWhatsAppChannelEnabled,
);
const deps: NotificationHttpDeps = { resolver, preferences, quota, whatsAppOptIn, whatsAppPhoneConfirmation };

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
  // m5-observability-design.md #2: API Gateway (HTTP API) - event.requestContext.requestId
  // is the ambient log correlationId; the pure business correlationId (ulid, below) that
  // flows into DomainEvent.correlationId is unrelated and stays exactly as before.
  return runWithContext({ correlationId: event.requestContext.requestId }, () => handleNotificationsRoute(event));
}

async function handleNotificationsRoute(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
  const claims = extractClaims(event);
  const base = { requestId: event.requestContext.requestId, correlationId: ulid(), claims, headers: event.headers };
  const routeKey = event.routeKey;

  const response = await (async () => {
    try {
      switch (routeKey) {
        case "GET /notifications/preferences":
          return await handleGetPreferences(deps, base);
        case "PUT /notifications/preferences":
          return await handleUpdatePreferences(deps, { ...base, body: parseBody(event) });
        case "POST /notifications/whatsapp-opt-in":
          return await handleRecordWhatsAppOptIn(deps, { ...base, body: parseBody(event) });
        case "POST /notifications/whatsapp-opt-in/request-confirmation":
          return await handleRequestWhatsAppPhoneConfirmation(deps, { ...base, body: parseBody(event) });
        case "POST /notifications/whatsapp-opt-in/confirm":
          return await handleConfirmWhatsAppPhoneConfirmation(deps, { ...base, body: parseBody(event) });
        default:
          throw new ValidationError(`Unknown route: ${routeKey}`);
      }
    } catch (err) {
      const appError = toAppError(err);
      return { statusCode: appError.category === "VALIDATION" ? 400 : 500, body: appError.toJSON() };
    }
  })();

  return toApiGatewayResult(response);
}
