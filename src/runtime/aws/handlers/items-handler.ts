/** Real handler for /items* routes (M2), replacing the 501 placeholder. */
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildIdentityDeps } from "../composition/identity.js";
import { buildExpirationDeps } from "../composition/expiration.js";
import {
  handleArchiveItem,
  handleCreateItem,
  handleDashboard,
  handleDeleteItem,
  handleGetItem,
  handleRenewItem,
  handleUpdateItem,
  type ExpirationHttpDeps,
} from "../../../modules/expiration/http/item-handlers.js";
import { extractClaims, parseBody, toApiGatewayResult } from "../http-adapter.js";
import { toAppError, ValidationError } from "../../../shared/errors/app-error.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const { resolver, quota } = buildIdentityDeps(client, tableName);
const { expiration } = buildExpirationDeps(client, tableName);
const deps: ExpirationHttpDeps = { resolver, expiration, quota };

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
  const claims = extractClaims(event);
  const base = { requestId: event.requestContext.requestId, correlationId: ulid(), claims, pathParameters: event.pathParameters, queryStringParameters: event.queryStringParameters, headers: event.headers };
  const routeKey = event.routeKey; // e.g. "POST /items", "GET /items/{itemId}"

  const response = await (async () => {
    try {
      switch (routeKey) {
        case "POST /items":
          return await handleCreateItem(deps, { ...base, body: parseBody(event) });
        case "GET /items/dashboard":
          return await handleDashboard(deps, base);
        case "GET /items/{itemId}":
          return await handleGetItem(deps, base);
        case "PUT /items/{itemId}":
          return await handleUpdateItem(deps, { ...base, body: parseBody(event) });
        case "DELETE /items/{itemId}":
          return await handleDeleteItem(deps, base);
        case "POST /items/{itemId}/archive":
          return await handleArchiveItem(deps, base);
        case "POST /items/{itemId}/renew":
          return await handleRenewItem(deps, { ...base, body: parseBody(event) });
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
