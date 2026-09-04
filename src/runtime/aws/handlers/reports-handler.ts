/**
 * Roadmap P0.7 ("Relatórios, Exportação e Audit Trail"), fatias 1-3. Dedicated Lambda serving
 * all 7 `GET /reports/*` routes — same reasoning as `export-handler.ts` (D-123/D-126): a raw
 * CSV body/`Content-Disposition` response never belongs behind `items_handler`'s generic JSON
 * `toApiGatewayResult()` pipeline. Deliberately NOT proxied through the BFF (`proxy-allowlist.ts`)
 * — same as `/items/export` today: `ProxyService.forward()`'s `FORWARDED_RESPONSE_HEADERS`
 * (`content-type`/`etag`) would silently drop `content-disposition`/`x-report-truncated`,
 * breaking the download filename/truncation signal. Solving that (or an alternative delivery
 * mechanism) is the same open gap already registered for `/items/export`, not reopened here.
 */
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildIdentityDeps } from "../composition/identity.js";
import { buildReportsDeps } from "../composition/reports.js";
import { handleReportsRoute, type CsvHttpResponse, type HttpResponse } from "../../../modules/reports/http/reports-handler.js";
import { extractClaims, toApiGatewayCsvResult, toApiGatewayResult } from "../http-adapter.js";
import { runWithContext } from "../../../shared/observability/context.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const { resolver, quota } = buildIdentityDeps(client, tableName);
const { reports } = buildReportsDeps(client, tableName);
const deps = { resolver, reports, quota };

function isCsvResponse(response: HttpResponse | CsvHttpResponse): response is CsvHttpResponse {
  return "csv" in response;
}

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
  return runWithContext({ correlationId: event.requestContext.requestId }, () => handleReportsRequest(event));
}

async function handleReportsRequest(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
  const claims = extractClaims(event);
  const base = { requestId: event.requestContext.requestId, correlationId: ulid(), claims, pathParameters: event.pathParameters, queryStringParameters: event.queryStringParameters, headers: event.headers };
  const response = await handleReportsRoute(deps, event.routeKey, base);
  return isCsvResponse(response) ? toApiGatewayCsvResult(response) : toApiGatewayResult(response);
}
