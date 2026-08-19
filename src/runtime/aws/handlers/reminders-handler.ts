/** Real handler for /reminders/policies* routes (M3), replacing the 501 placeholder. */
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildIdentityDeps } from "../composition/identity.js";
import { buildReminderHttpDeps } from "../composition/reminder.js";
import {
  handleCreatePolicy,
  handleDisablePolicy,
  handleGetPolicy,
  handleUpdatePolicy,
  type ReminderHttpDeps,
} from "../../../modules/reminder/http/policy-handlers.js";
import { extractClaims, parseBody, toApiGatewayResult } from "../http-adapter.js";
import { toAppError, ValidationError } from "../../../shared/errors/app-error.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const { resolver } = buildIdentityDeps(client, tableName);
const { policies } = buildReminderHttpDeps(client, tableName);
const deps: ReminderHttpDeps = { resolver, policies };

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
  const claims = extractClaims(event);
  const base = { requestId: event.requestContext.requestId, correlationId: ulid(), claims, pathParameters: event.pathParameters, headers: event.headers };
  const routeKey = event.routeKey;

  const response = await (async () => {
    try {
      switch (routeKey) {
        case "POST /reminders/policies":
          return await handleCreatePolicy(deps, { ...base, body: parseBody(event) });
        case "GET /reminders/policies/{policyId}":
          return await handleGetPolicy(deps, base);
        case "PUT /reminders/policies/{policyId}":
          return await handleUpdatePolicy(deps, { ...base, body: parseBody(event) });
        case "POST /reminders/policies/{policyId}/disable":
          return await handleDisablePolicy(deps, base);
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
