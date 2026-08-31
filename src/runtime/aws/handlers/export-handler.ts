/**
 * D-123/D-126 (CSV data export). Dedicated Lambda, not a route added to items-handler.
 * items_handler's Terraform module has no explicit `timeout_seconds` (default 10s,
 * infra/modules/lambda-function/variables.tf), and every other route it serves is a fast
 * single-item CRUD op that has no reason to inherit a longer timeout. This export mechanism
 * needs `timeout_seconds = 25` (round-3 Achado #6 — 5s margin below the HTTP API
 * integration's fixed, non-raisable 30s ceiling) purely because it can page GSI1 up to 3
 * times and serialize up to 2.000 rows. A dedicated Lambda gives it that timeout without
 * changing the budget/behavior of any existing /items* route.
 */
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildIdentityDeps } from "../composition/identity.js";
import { buildExpirationDeps } from "../composition/expiration.js";
import { handleExportItems, type CsvHttpResponse } from "../../../modules/expiration/http/export-handler.js";
import type { ExpirationHttpDeps, HttpResponse } from "../../../modules/expiration/http/item-handlers.js";
import { extractClaims, toApiGatewayCsvResult, toApiGatewayResult } from "../http-adapter.js";
import { ValidationError } from "../../../shared/errors/app-error.js";
import { runWithContext } from "../../../shared/observability/context.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const { resolver, quota } = buildIdentityDeps(client, tableName);
const { expiration } = buildExpirationDeps(client, tableName);
const deps: ExpirationHttpDeps = { resolver, expiration, quota };

function isCsvResponse(response: HttpResponse | CsvHttpResponse): response is CsvHttpResponse {
  return "csv" in response;
}

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
  return runWithContext({ correlationId: event.requestContext.requestId }, () => handleExportRoute(event));
}

async function handleExportRoute(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
  const claims = extractClaims(event);
  const base = { requestId: event.requestContext.requestId, correlationId: ulid(), claims, pathParameters: event.pathParameters, queryStringParameters: event.queryStringParameters, headers: event.headers };
  const routeKey = event.routeKey;

  if (routeKey !== "GET /items/export") {
    return toApiGatewayResult({ statusCode: 400, body: new ValidationError(`Unknown route: ${routeKey}`).toJSON() });
  }

  const response = await handleExportItems(deps, base);
  return isCsvResponse(response) ? toApiGatewayCsvResult(response) : toApiGatewayResult(response);
}
