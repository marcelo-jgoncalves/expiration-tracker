/** Real handler for /imports* routes (M11, D-042). */
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildIdentityDeps } from "../composition/identity.js";
import { buildImportHttpDeps } from "../composition/import.js";
import {
  handleReserveImport,
  handleGetImportJob,
  handleRequestImportCommit,
  handleGetImportJobSchema,
  handleSubmitImportMapping,
  type ImportHttpDeps,
} from "../../../modules/import/http/import-handlers.js";
import { extractClaims, parseBody, toApiGatewayResult } from "../http-adapter.js";
import { toAppError, ValidationError } from "../../../shared/errors/app-error.js";
import { runWithContext } from "../../../shared/observability/context.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const rawBucket = process.env["IMPORT_RAW_BUCKET_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!rawBucket) throw new Error("IMPORT_RAW_BUCKET_NAME env var is required.");
const { resolver, quota } = buildIdentityDeps(client, tableName);
const { imports } = buildImportHttpDeps(client, tableName, rawBucket, quota);
const deps: ImportHttpDeps = { resolver, imports, quota };

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
  return runWithContext({ correlationId: event.requestContext.requestId }, () => handleImportsRoute(event));
}

async function handleImportsRoute(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
  const claims = extractClaims(event);
  const base = { requestId: event.requestContext.requestId, correlationId: event.requestContext.requestId, claims, pathParameters: event.pathParameters, headers: event.headers };
  const routeKey = event.routeKey;

  const response = await (async () => {
    try {
      switch (routeKey) {
        case "POST /imports":
          return await handleReserveImport(deps, { ...base, body: parseBody(event) });
        case "GET /imports/{jobId}":
          return await handleGetImportJob(deps, base);
        case "POST /imports/{jobId}/commit":
          return await handleRequestImportCommit(deps, base);
        case "GET /import-jobs/{jobId}/schema":
          return await handleGetImportJobSchema(deps, base);
        case "POST /import-jobs/{jobId}/mapping":
          return await handleSubmitImportMapping(deps, { ...base, body: parseBody(event) });
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
