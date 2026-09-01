/** Real handler for /document-archive/* routes (D-143 Nucleus 1), same shape as
 * items-handler.ts. Wired to real infra (Lambda resource + API Gateway route + IAM policy)
 * in `infra/main.tf`/`infra/modules/api-gateway/main.tf` and to `scripts/build-lambdas.ts`/
 * `src/modules/bff/domain/proxy-allowlist.ts` — GSI2/GSI5 need no dedicated IAM policy beyond
 * the general tenant-facing grant (see `infra/main.tf`'s `document_archive_handler` comment). */
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyStructuredResultV2 } from "aws-lambda";
import { ulid } from "ulid";
import { createDocumentClient } from "../../../shared/dynamodb/client.js";
import { buildIdentityDeps } from "../composition/identity.js";
import { buildDocumentArchiveDeps } from "../composition/document-archive.js";
import {
  handleAcceptVersion,
  handleClaimReview,
  handleCommitUpload,
  handleCreateDocument,
  handleGetDocument,
  handleListVersions,
  handleRejectVersion,
  handleReserveUpload,
  handleCreateRequirement,
  handleGetRequirement,
  handleListRequirements,
  handleUpdateRequirement,
  handleLinkEvidence,
  handleUnlinkEvidence,
  handleDeleteRequirement,
  handleCreateSeries,
  handleGetSeries,
  handleListSeries,
  handleCancelSeries,
  handleMaterializeSeriesAttempt,
  type DocumentArchiveHttpDeps,
} from "../../../modules/document-archive/http/document-archive-handlers.js";
import { extractClaims, parseBody, toApiGatewayResult } from "../http-adapter.js";
import { toAppError, ValidationError } from "../../../shared/errors/app-error.js";
import { runWithContext } from "../../../shared/observability/context.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const { resolver, quota } = buildIdentityDeps(client, tableName);
const { documentArchive, recurrence } = buildDocumentArchiveDeps(client, tableName);
const deps: DocumentArchiveHttpDeps = { resolver, documentArchive, recurrence, quota };

export async function handler(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
  return runWithContext({ correlationId: event.requestContext.requestId }, () => handleDocumentArchiveRoute(event));
}

async function handleDocumentArchiveRoute(event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyStructuredResultV2> {
  const claims = extractClaims(event);
  const base = { requestId: event.requestContext.requestId, correlationId: ulid(), claims, pathParameters: event.pathParameters, queryStringParameters: event.queryStringParameters, headers: event.headers };
  const routeKey = event.routeKey; // e.g. "POST /document-archive/documents"

  const response = await (async () => {
    try {
      switch (routeKey) {
        case "POST /document-archive/documents":
          return await handleCreateDocument(deps, { ...base, body: parseBody(event) });
        case "GET /document-archive/documents/{documentId}":
          return await handleGetDocument(deps, base);
        case "GET /document-archive/documents/{documentId}/versions":
          return await handleListVersions(deps, base);
        case "POST /document-archive/documents/{documentId}/versions":
          return await handleReserveUpload(deps, { ...base, body: parseBody(event) });
        case "POST /document-archive/documents/{documentId}/versions/{seq}/commit":
          return await handleCommitUpload(deps, { ...base, body: parseBody(event) });
        case "POST /document-archive/documents/{documentId}/versions/{seq}/claim":
          return await handleClaimReview(deps, { ...base, body: parseBody(event) });
        case "POST /document-archive/documents/{documentId}/versions/{seq}/accept":
          return await handleAcceptVersion(deps, { ...base, body: parseBody(event) });
        case "POST /document-archive/documents/{documentId}/versions/{seq}/reject":
          return await handleRejectVersion(deps, { ...base, body: parseBody(event) });
        // D-143 Nucleus 2, Requirement (Decision 5 / D-145) — subject-scoped routes.
        case "POST /document-archive/requirements":
          return await handleCreateRequirement(deps, { ...base, body: parseBody(event) });
        case "GET /document-archive/requirements/{subjectId}":
          return await handleListRequirements(deps, base);
        case "GET /document-archive/requirements/{subjectId}/{requirementId}":
          return await handleGetRequirement(deps, base);
        case "PATCH /document-archive/requirements/{subjectId}/{requirementId}":
          return await handleUpdateRequirement(deps, { ...base, body: parseBody(event) });
        case "POST /document-archive/requirements/{subjectId}/{requirementId}/link-evidence":
          return await handleLinkEvidence(deps, { ...base, body: parseBody(event) });
        case "POST /document-archive/requirements/{subjectId}/{requirementId}/unlink-evidence":
          return await handleUnlinkEvidence(deps, { ...base, body: parseBody(event) });
        case "POST /document-archive/requirements/{subjectId}/{requirementId}/delete":
          return await handleDeleteRequirement(deps, { ...base, body: parseBody(event) });
        // D-143 Nucleus 2, entity 3/3, recurrence (Decision 8 / D-147) — subject-scoped series
        // routes. Tenant-facing only — the guest-facing surface stays on
        // document-archive-guest-handlers.ts, unchanged by this task.
        case "POST /document-archive/series":
          return await handleCreateSeries(deps, { ...base, body: parseBody(event) });
        case "GET /document-archive/series/{subjectId}":
          return await handleListSeries(deps, base);
        case "GET /document-archive/series/{subjectId}/{seriesId}":
          return await handleGetSeries(deps, base);
        case "POST /document-archive/series/{subjectId}/{seriesId}/cancel":
          return await handleCancelSeries(deps, { ...base, body: parseBody(event) });
        case "POST /document-archive/series/{subjectId}/{seriesId}/materialize":
          return await handleMaterializeSeriesAttempt(deps, { ...base, body: parseBody(event) });
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
