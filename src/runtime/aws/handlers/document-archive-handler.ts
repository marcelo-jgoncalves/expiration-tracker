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
  handleReserveFiles,
  handleReserveUpload,
  handleCreateRequirement,
  handleGetRequirement,
  handleGetSubjectCompliance,
  handleListRequirements,
  handleSearchRequirements,
  handleListReviewQueue,
  handleGetStorageUsage,
  handleUpdateRequirement,
  handleLinkEvidence,
  handleUnlinkEvidence,
  handleDeleteRequirement,
  handleCreateDocumentRequest,
  handleListDocumentRequests,
  handleGetDocumentRequest,
  handleCreateSeries,
  handleGetSeries,
  handleListSeries,
  handleCancelSeries,
  handleMaterializeSeriesAttempt,
  handleUpdateSeriesRecipient,
  handleCreateDocumentType,
  handleGetDocumentType,
  handleListDocumentTypes,
  handleRenameDocumentType,
  handleDeprecateDocumentType,
  handleReactivateDocumentType,
  handleCreateDocumentTypeMetadataField,
  handleUpdateDocumentTypeMetadataField,
  handleUpdateDocumentMetadataValues,
  handleCreateRequirementTemplate,
  handleListRequirementTemplates,
  handleGetRequirementTemplate,
  handleUpdateRequirementTemplate,
  handleDuplicateRequirementTemplate,
  handleArchiveRequirementTemplate,
  handleUnarchiveRequirementTemplate,
  handlePreviewRequirementTemplate,
  handleApplyRequirementTemplate,
  handlePreviewDossierExport,
  handleConfirmDossierExport,
  handleDownloadDossierExport,
  handleCreateShareLink,
  handleRevokeShareLink,
  handleListShareLinks,
  type DocumentArchiveHttpDeps,
} from "../../../modules/document-archive/http/document-archive-handlers.js";
import { extractClaims, parseBody, toApiGatewayResult } from "../http-adapter.js";
import { toAppError, ValidationError } from "../../../shared/errors/app-error.js";
import { runWithContext } from "../../../shared/observability/context.js";

const client = createDocumentClient();
const tableName = process.env["TABLE_NAME"];
if (!tableName) throw new Error("TABLE_NAME env var is required.");
const quarantineBucket = process.env["QUARANTINE_BUCKET_NAME"];
if (!quarantineBucket) throw new Error("QUARANTINE_BUCKET_NAME env var is required.");
// D-205 fatia 3 (decision 9): only the dossier download route needs this - required so a real
// invocation of that route never silently falls back to the "not wired" throw in
// handleDownloadDossierExport.
const reportExportsBucketName = process.env["REPORT_EXPORTS_BUCKET_NAME"];
if (!reportExportsBucketName) throw new Error("REPORT_EXPORTS_BUCKET_NAME env var is required.");
// D-225/D-241 (ExternalShareLink slice 2/3) - own pepper, never shared with
// DOCARCHIVE_GUEST_ACCESS_PEPPER/GUEST_TOKEN_PEPPER (distinct credential shape, distinct blast
// radius, same reasoning those two already keep from each other).
const shareLinkPepper = process.env["DOCARCHIVE_SHARE_LINK_PEPPER"];
if (!shareLinkPepper) throw new Error("DOCARCHIVE_SHARE_LINK_PEPPER env var is required.");
const { resolver, quota } = buildIdentityDeps(client, tableName);
const { documentArchive, recurrence, dossierExportStore, shareLinks } = buildDocumentArchiveDeps(client, tableName, quarantineBucket, reportExportsBucketName, shareLinkPepper);
const deps: DocumentArchiveHttpDeps = { resolver, documentArchive, recurrence, quota, dossierExportStore, shareLinks };

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
        case "POST /document-archive/documents/{documentId}/versions/{seq}/files":
          return await handleReserveFiles(deps, { ...base, body: parseBody(event) });
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
        // D-194 Fatia 3 (search/filters) - literal segment, routed before
        // "GET /document-archive/requirements/{subjectId}" below.
        case "GET /document-archive/requirements/search":
          return await handleSearchRequirements(deps, base);
        case "GET /document-archive/requirements/{subjectId}":
          return await handleListRequirements(deps, base);
        // Roadmap P0.6, fatia 2 — literal segment, routed before "{requirementId}" below (same
        // "literal beats param at the same position" precedent as "search" above).
        case "GET /document-archive/requirements/{subjectId}/compliance":
          return await handleGetSubjectCompliance(deps, base);
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
        // G4 (D-247/D-24x): one-off ("avulso") DocumentRequest, outside any series.
        case "POST /document-archive/requirements/{subjectId}/{requirementId}/document-requests":
          return await handleCreateDocumentRequest(deps, { ...base, body: parseBody(event) });
        // A14 (Block 6, D-2xx): literal "document-requests" segment routed before the
        // "{requirementId}" param route above (same "literal beats param" precedent as
        // "compliance"/"search" elsewhere in this switch) — lists every DocumentRequest under a
        // Subject, avulso and series-materialized alike (see `listDocumentRequests`'s doc
        // comment for the real read gap this closes).
        case "GET /document-archive/requirements/{subjectId}/document-requests":
          return await handleListDocumentRequests(deps, base);
        case "GET /document-archive/requirements/{subjectId}/document-requests/{documentRequestId}":
          return await handleGetDocumentRequest(deps, base);
        // G2 (D-247/D-24x): review-queue listing (A13) - literal segment under /document-archive,
        // same Lambda, no path-parameter collision with anything above.
        case "GET /document-archive/reviews":
          return await handleListReviewQueue(deps, base);
        // storage-quota-scoping (D-2xx): tenant-wide storage usage summary - literal segment,
        // same "no path-parameter collision" reasoning as /reviews above.
        case "GET /document-archive/storage-usage":
          return await handleGetStorageUsage(deps, base);
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
        // D-230 — closes D-228's named pendency (recurrence path had no recipient contact).
        case "POST /document-archive/series/{subjectId}/{seriesId}/recipient":
          return await handleUpdateSeriesRecipient(deps, { ...base, body: parseBody(event) });
        // D-173 (DocumentType catalog), item 5 — tenant-facing catalog CRUD routes.
        case "POST /document-archive/document-types":
          return await handleCreateDocumentType(deps, { ...base, body: parseBody(event) });
        case "GET /document-archive/document-types":
          return await handleListDocumentTypes(deps, base);
        case "GET /document-archive/document-types/{documentTypeId}":
          return await handleGetDocumentType(deps, base);
        case "PATCH /document-archive/document-types/{documentTypeId}":
          return await handleRenameDocumentType(deps, { ...base, body: parseBody(event) });
        case "POST /document-archive/document-types/{documentTypeId}/deprecate":
          return await handleDeprecateDocumentType(deps, { ...base, body: parseBody(event) });
        case "POST /document-archive/document-types/{documentTypeId}/reactivate":
          return await handleReactivateDocumentType(deps, { ...base, body: parseBody(event) });
        // D-218 fatia 3 (Roadmap P1 "metadata configurável por Document Type").
        case "POST /document-archive/document-types/{documentTypeId}/metadata-fields":
          return await handleCreateDocumentTypeMetadataField(deps, { ...base, body: parseBody(event) });
        case "PATCH /document-archive/document-types/{documentTypeId}/metadata-fields/{fieldId}":
          return await handleUpdateDocumentTypeMetadataField(deps, { ...base, body: parseBody(event) });
        case "PATCH /document-archive/documents/{documentId}/metadata-values":
          return await handleUpdateDocumentMetadataValues(deps, { ...base, body: parseBody(event) });
        // P0.1 (RequirementTemplate) — tenant-facing catalog CRUD + preview/apply.
        case "POST /document-archive/requirement-templates":
          return await handleCreateRequirementTemplate(deps, { ...base, body: parseBody(event) });
        case "GET /document-archive/requirement-templates":
          return await handleListRequirementTemplates(deps, base);
        case "GET /document-archive/requirement-templates/{templateId}":
          return await handleGetRequirementTemplate(deps, base);
        case "PATCH /document-archive/requirement-templates/{templateId}":
          return await handleUpdateRequirementTemplate(deps, { ...base, body: parseBody(event) });
        case "POST /document-archive/requirement-templates/{templateId}/duplicate":
          return await handleDuplicateRequirementTemplate(deps, { ...base, body: parseBody(event) });
        case "POST /document-archive/requirement-templates/{templateId}/archive":
          return await handleArchiveRequirementTemplate(deps, { ...base, body: parseBody(event) });
        case "POST /document-archive/requirement-templates/{templateId}/unarchive":
          return await handleUnarchiveRequirementTemplate(deps, { ...base, body: parseBody(event) });
        case "POST /document-archive/requirement-templates/{templateId}/preview":
          return await handlePreviewRequirementTemplate(deps, { ...base, body: parseBody(event) });
        case "POST /document-archive/requirement-templates/{templateId}/apply":
          return await handleApplyRequirementTemplate(deps, { ...base, body: parseBody(event) });
        // D-205 fatia 1 (Roadmap P1 item 16, dossier export) — preview/confirm.
        case "POST /document-archive/subjects/{subjectId}/dossier":
          return await handlePreviewDossierExport(deps, base);
        case "POST /document-archive/subjects/{subjectId}/dossier/{runId}/confirm":
          return await handleConfirmDossierExport(deps, { ...base, body: parseBody(event) });
        // D-205 fatia 3 — download.
        case "GET /document-archive/subjects/{subjectId}/dossier/{runId}/download":
          return await handleDownloadDossierExport(deps, base);
        // D-225/D-241 (ExternalShareLink slice 2/3, backlog P1 item 8) - authenticated/admin
        // side only. The anonymous visitor's own route lives on a SEPARATE Lambda
        // (external-share-handler.ts), never here.
        case "POST /document-archive/documents/{documentId}/share-links":
          return await handleCreateShareLink(deps, { ...base, body: parseBody(event) });
        case "PATCH /document-archive/documents/{documentId}/share-links/{shareId}/revoke":
          return await handleRevokeShareLink(deps, { ...base, body: parseBody(event) });
        case "GET /document-archive/documents/{documentId}/share-links":
          return await handleListShareLinks(deps, base);
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
