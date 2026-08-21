/** Real handler for /notifications/preferences routes (M4 backlog item closed: previously
 * NotificationPreferences was only ever created via onboarding, with no HTTP endpoint for a
 * user to read/edit them afterward). Same pattern as items-handler.ts/reminders-handler.ts. */
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildIdentityDeps } from "../composition/identity.js";
import { buildNotificationHttpDeps } from "../composition/notification.js";
import { handleGetPreferences, handleUpdatePreferences, type NotificationHttpDeps } from "../../../modules/notification/http/preferences-handlers.js";
import { extractClaims, parseBody, toApiGatewayResult } from "../http-adapter.js";
import { toAppError, ValidationError } from "../../../shared/errors/app-error.js";
import { runWithContext } from "../../../shared/observability/context.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const { resolver, quota } = buildIdentityDeps(client, tableName);
const { preferences } = buildNotificationHttpDeps(client, tableName);
const deps: NotificationHttpDeps = { resolver, preferences, quota };

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
