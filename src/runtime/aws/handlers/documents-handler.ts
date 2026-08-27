/** Real handler for /items/{itemId}/documents* routes (M6). */
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildIdentityDeps } from "../composition/identity.js";
import { buildDocumentHttpDeps } from "../composition/document.js";
import { buildFieldConfirmationDeps } from "../composition/extraction.js";
import { handleReserveUpload, handleDeleteDocument, handleGetDocument, handleListDocuments, type DocumentHttpDeps } from "../../../modules/document/http/document-handlers.js";
import { handleConfirmField, handleRejectField, type ExtractionHttpDeps } from "../../../modules/extraction/http/extraction-handlers.js";
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
// M7 item 8 (§1.7): the two confirm/reject field routes live under the same /items/{itemId}/
// documents* API Gateway route group and Lambda (documents_handler already has full
// tenant_facing_read_write_policy_json on the table - no new IAM needed) - never a separate
// Lambda for two routes this narrow.
const extractionDeps: ExtractionHttpDeps = { resolver, quota, fields: buildFieldConfirmationDeps(client, tableName) };

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
        case "GET /items/{itemId}/documents":
          return await handleListDocuments(deps, base);
        case "GET /items/{itemId}/documents/{documentId}":
          return await handleGetDocument(deps, base);
        case "DELETE /items/{itemId}/documents/{documentId}":
          return await handleDeleteDocument(deps, base);
        case "POST /items/{itemId}/documents/{documentId}/extractions/{runId}/fields/{fieldName}/confirm":
          return await handleConfirmField(extractionDeps, { ...base, body: parseBody(event) });
        case "POST /items/{itemId}/documents/{documentId}/extractions/{runId}/fields/{fieldName}/reject":
          return await handleRejectField(extractionDeps, { ...base, body: parseBody(event) });
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
