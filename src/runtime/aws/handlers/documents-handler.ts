/** Real handler for /items/{itemId}/documents* routes (M6). */
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildIdentityDeps } from "../composition/identity.js";
import { buildDocumentHttpDeps } from "../composition/document.js";
import { handleReserveUpload, handleDeleteDocument, type DocumentHttpDeps } from "../../../modules/document/http/document-handlers.js";
import { extractClaims, parseBody, toApiGatewayResult } from "../http-adapter.js";
import { toAppError, ValidationError } from "../../../shared/errors/app-error.js";
import { runWithContext } from "../../../shared/observability/context.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
const quarantineBucket = process.env["QUARANTINE_BUCKET_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
if (!quarantineBucket) throw new Error("QUARANTINE_BUCKET_NAME env var is required.");
const { resolver, quota } = buildIdentityDeps(client, tableName);
const { documents, deletion } = buildDocumentHttpDeps(client, tableName, quarantineBucket);
const deps: DocumentHttpDeps = { resolver, documents, deletion, quota };

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
  return runWithContext({ correlationId: event.requestContext.requestId }, () => handleDocumentsRoute(event));
}

async function handleDocumentsRoute(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
  const claims = extractClaims(event);
  const base = { requestId: event.requestContext.requestId, correlationId: event.requestContext.requestId, claims, pathParameters: event.pathParameters, headers: event.headers };
  const routeKey = event.routeKey;

  const response = await (async () => {
    try {
      switch (routeKey) {
        case "POST /items/{itemId}/documents":
          return await handleReserveUpload(deps, { ...base, body: parseBody(event) });
        case "DELETE /items/{itemId}/documents/{documentId}":
          return await handleDeleteDocument(deps, base);
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
