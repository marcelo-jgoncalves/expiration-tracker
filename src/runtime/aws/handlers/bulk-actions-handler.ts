/**
 * D-206/D-207 (bulk reassign/archive, Roadmap P1 item 17). Dedicated Lambda, not routes
 * folded into items-handler.ts — same reasoning as export-handler.ts: items_handler's
 * Terraform module has no explicit `timeout_seconds` (default 10s), and processing up to
 * `BULK_ACTION_ITEM_CAP` (100) items sequentially, each its own strong GetItem +
 * TransactWriteItems, needs more budget than any single-item /items* route. This mechanism
 * uses `timeout_seconds = 25` (same value as export-handler, within the HTTP API v2's fixed
 * 30s integration ceiling) — see `docs/architecture/reviews/bulk-actions-scoping/
 * estado-final-consolidado.md` decision 8, which explicitly names the cap as an engineering
 * hypothesis to validate empirically, not a proven budget.
 */
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildIdentityDeps } from "../composition/identity.js";
import { buildExpirationDeps } from "../composition/expiration.js";
import { handleBulkArchiveItems, handleBulkReassignItems } from "../../../modules/expiration/http/bulk-action-handlers.js";
import type { ExpirationHttpDeps } from "../../../modules/expiration/http/item-handlers.js";
import { extractClaims, parseBody, toApiGatewayResult } from "../http-adapter.js";
import { ValidationError, toAppError } from "../../../shared/errors/app-error.js";
import { runWithContext } from "../../../shared/observability/context.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const { resolver, quota } = buildIdentityDeps(client, tableName);
const { expiration } = buildExpirationDeps(client, tableName);
const deps: ExpirationHttpDeps = { resolver, expiration, quota };

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
  return runWithContext({ correlationId: event.requestContext.requestId }, () => handleBulkActionsRoute(event));
}

async function handleBulkActionsRoute(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
  const claims = extractClaims(event);
  const base = { requestId: event.requestContext.requestId, correlationId: ulid(), claims, pathParameters: event.pathParameters, queryStringParameters: event.queryStringParameters, headers: event.headers };
  const routeKey = event.routeKey;

  const response = await (async () => {
    try {
      switch (routeKey) {
        case "POST /items/bulk-reassign":
          return await handleBulkReassignItems(deps, { ...base, body: parseBody(event) });
        case "POST /items/bulk-archive":
          return await handleBulkArchiveItems(deps, { ...base, body: parseBody(event) });
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
