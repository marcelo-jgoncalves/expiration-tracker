/**
 * HTTP handlers for the Document Archive module (D-143 Nucleus 1) — mirrors
 * `src/modules/expiration/http/item-handlers.ts`'s exact pipeline (resolve context ->
 * service, which internally calls authorize() -> schema validation before the service call
 * -> AppError -> status-code mapping), so this module fails the same way as every other
 * route in the system.
 */
import { AppError, AuthorizationError, ValidationError, toAppError } from "../../../shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../identity/domain/authorization.js";
import { auditAuthorizationDenied } from "../../../shared/observability/security-audit.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import { encodeSearchCursor, decodeSearchCursor } from "../../../shared/domain/search-cursor.js";
import type { UnifiedValidityState } from "../../../shared/domain/validity-state.js";
import type { RequestContextResolver, ValidatedClaims } from "../../identity/application/resolve-request-context.js";
import type { TenantQuotaService } from "../../identity/application/quota.js";
import type { DocumentArchiveService } from "../application/document-archive-service.js";
import type { DocumentRequestRecurrenceService } from "../application/document-request-recurrence-service.js";
import type { CreateDocumentInput } from "../domain/document.js";
import type { FileUploadSpec } from "../domain/document-file.js";
import type { DocumentVersionOrigin, RejectionReason } from "../domain/document-version.js";
import type { CreateRequirementInput, RequirementStatus, UpdateRequirementInput } from "../domain/requirement.js";
import type { CreateDocumentRequestSeriesInput } from "../domain/document-request-series.js";
import type { CreateDocumentTypeInput, DocumentType } from "../domain/document-type.js";
import type { CreateRequirementTemplateInput, RequirementTemplate, UpdateRequirementTemplateInput } from "../domain/requirement-template.js";

function validateAgainstSchema(schemaId: string, body: unknown): void {
  const { valid, errors } = defaultSchemaRegistry.validate(schemaId, body);
  if (!valid) {
    throw new ValidationError("Request body failed schema validation.", { errors });
  }
}

const CREATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-create-request.v1.json";
const RESERVE_UPLOAD_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-reserve-upload-request.v1.json";
const RESERVE_FILES_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-reserve-files-request.v1.json";
const COMMIT_UPLOAD_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-commit-upload-request.v1.json";
const CLAIM_REVIEW_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-claim-review-request.v1.json";
const ACCEPT_VERSION_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-accept-version-request.v1.json";
const REJECT_VERSION_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-reject-version-request.v1.json";
const REQUIREMENT_CREATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirement-create-request.v1.json";
const REQUIREMENT_UPDATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirement-update-request.v1.json";
const REQUIREMENT_LINK_EVIDENCE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirement-link-evidence-request.v1.json";
const REQUIREMENT_UNLINK_EVIDENCE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirement-unlink-evidence-request.v1.json";
const REQUIREMENT_DELETE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirement-delete-request.v1.json";
const REQUIREMENT_SEARCH_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirement-search-request.v1.json";
const SERIES_CREATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-series-create-request.v1.json";
const SERIES_CANCEL_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-series-cancel-request.v1.json";
const SERIES_MATERIALIZE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-series-materialize-request.v1.json";
const DOCUMENTTYPE_CREATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-documenttype-create-request.v1.json";
const DOCUMENTTYPE_RENAME_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-documenttype-rename-request.v1.json";
const DOCUMENTTYPE_DEPRECATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-documenttype-deprecate-request.v1.json";
const DOCUMENTTYPE_REACTIVATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-documenttype-reactivate-request.v1.json";
const REQTEMPLATE_CREATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirementtemplate-create-request.v1.json";
const REQTEMPLATE_UPDATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirementtemplate-update-request.v1.json";
const REQTEMPLATE_DUPLICATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirementtemplate-duplicate-request.v1.json";
const REQTEMPLATE_ARCHIVE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirementtemplate-archive-request.v1.json";
const REQTEMPLATE_UNARCHIVE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirementtemplate-unarchive-request.v1.json";
const REQTEMPLATE_PREVIEW_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirementtemplate-preview-request.v1.json";
const REQTEMPLATE_APPLY_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirementtemplate-apply-request.v1.json";

export interface HttpRequest<TBody = unknown> {
  requestId: string;
  correlationId: string;
  claims: ValidatedClaims;
  pathParameters?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
  body?: TBody;
}

export interface HttpResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

export interface DocumentArchiveHttpDeps {
  resolver: RequestContextResolver;
  documentArchive: DocumentArchiveService;
  recurrence: DocumentRequestRecurrenceService;
  quota: TenantQuotaService;
}

const STATUS_BY_CATEGORY: Record<string, number> = {
  VALIDATION: 400,
  AUTH: 401,
  AUTHORIZATION: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  QUOTA_EXCEEDED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL: 500,
  BUSINESS_RULE: 422,
};

function toResponse(appError: AppError): HttpResponse {
  const status = STATUS_BY_CATEGORY[appError.category] ?? 500;
  return { statusCode: status, body: appError.toJSON() };
}

async function withErrorMapping(fn: () => Promise<HttpResponse>): Promise<HttpResponse> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AuthorizationDeniedError) {
      auditAuthorizationDenied({ reason: err.reason, action: err.action });
      return toResponse(new AuthorizationError(err.message, { reason: err.reason }));
    }
    const appError = err instanceof AppError ? err : toAppError(err);
    return toResponse(appError);
  }
}

/** full-audit round1/Seguranca criterio 9 (Resistencia a Abuso/DoS) — same limit/window as
 * every other business route (item-handlers.ts's consumeApiRequestQuota), applied here too
 * rather than leaving this module's real business writes unmetered. */
async function consumeApiRequestQuota(quota: TenantQuotaService, tenantId: string): Promise<void> {
  await quota.consume({ tenantId, quotaType: "API_REQUEST", window: "current", limit: 100, windowSeconds: 60 });
}

function requireDocumentId(req: HttpRequest): string {
  const documentId = req.pathParameters?.["documentId"];
  if (!documentId) throw new ValidationError("Missing documentId path parameter.");
  return documentId;
}

function requireSeq(req: HttpRequest): number {
  const raw = req.pathParameters?.["seq"];
  const seq = Number(raw);
  if (!raw || !Number.isInteger(seq) || seq < 1) {
    throw new ValidationError("Missing or invalid seq path parameter.");
  }
  return seq;
}

function requireSubjectId(req: HttpRequest): string {
  const subjectId = req.pathParameters?.["subjectId"];
  if (!subjectId) throw new ValidationError("Missing subjectId path parameter.");
  return subjectId;
}

function requireRequirementId(req: HttpRequest): string {
  const requirementId = req.pathParameters?.["requirementId"];
  if (!requirementId) throw new ValidationError("Missing requirementId path parameter.");
  return requirementId;
}

function requireSeriesId(req: HttpRequest): string {
  const seriesId = req.pathParameters?.["seriesId"];
  if (!seriesId) throw new ValidationError("Missing seriesId path parameter.");
  return seriesId;
}

function requireDocumentTypeId(req: HttpRequest): string {
  const documentTypeId = req.pathParameters?.["documentTypeId"];
  if (!documentTypeId) throw new ValidationError("Missing documentTypeId path parameter.");
  return documentTypeId;
}

/** Defaults to ACTIVE (the catalog a document-create flow actually needs) rather than requiring
 * every caller to pass `?status=ACTIVE` explicitly — DEPRECATED is opt-in via the query param. */
function requireDocumentTypeStatus(req: HttpRequest): DocumentType["status"] {
  const raw = req.queryStringParameters?.["status"];
  if (!raw) return "ACTIVE";
  if (raw !== "ACTIVE" && raw !== "DEPRECATED") throw new ValidationError("Invalid status query parameter.", { status: raw });
  return raw;
}

async function resolve(deps: DocumentArchiveHttpDeps, req: HttpRequest) {
  const context = await deps.resolver.resolve({
    claims: req.claims,
    requestId: req.requestId,
    correlationId: req.correlationId,
    organizationIdHint: req.headers?.["x-organization-id"],
  });
  await consumeApiRequestQuota(deps.quota, context.tenant.tenantId);
  return context;
}

export async function handleCreateDocument(deps: DocumentArchiveHttpDeps, req: HttpRequest<CreateDocumentInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(CREATE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const document = await deps.documentArchive.createDocument(context, req.body);
    return { statusCode: 201, body: { document } };
  });
}

export async function handleGetDocument(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requireDocumentId(req);
    const context = await resolve(deps, req);
    const document = await deps.documentArchive.getDocument(context, documentId);
    return { statusCode: 200, body: { document } };
  });
}

export async function handleListVersions(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requireDocumentId(req);
    const context = await resolve(deps, req);
    const versions = await deps.documentArchive.listVersions(context, documentId);
    return { statusCode: 200, body: { versions } };
  });
}

export async function handleReserveUpload(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ origin: DocumentVersionOrigin }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requireDocumentId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(RESERVE_UPLOAD_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const version = await deps.documentArchive.reserveUpload(context, documentId, req.body.origin);
    return { statusCode: 201, body: { version } };
  });
}

export async function handleReserveFiles(
  deps: DocumentArchiveHttpDeps,
  req: HttpRequest<{ expectedVersion: number; files: readonly FileUploadSpec[] }>,
): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requireDocumentId(req);
    const seq = requireSeq(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(RESERVE_FILES_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const reserved = await deps.documentArchive.reserveFiles(context, documentId, seq, req.body.expectedVersion, req.body.files);
    return { statusCode: 201, body: { files: reserved } };
  });
}

export async function handleCommitUpload(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requireDocumentId(req);
    const seq = requireSeq(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(COMMIT_UPLOAD_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const version = await deps.documentArchive.commitUpload(context, documentId, seq, req.body.expectedVersion);
    return { statusCode: 200, body: { version } };
  });
}

export async function handleClaimReview(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requireDocumentId(req);
    const seq = requireSeq(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(CLAIM_REVIEW_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const version = await deps.documentArchive.claimReview(context, documentId, seq, req.body.expectedVersion);
    return { statusCode: 200, body: { version } };
  });
}

export async function handleAcceptVersion(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number; clientRequestToken: string }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requireDocumentId(req);
    const seq = requireSeq(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(ACCEPT_VERSION_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const result = await deps.documentArchive.acceptVersion(context, documentId, seq, req.body.expectedVersion, req.body.clientRequestToken);
    return { statusCode: 200, body: { ...result } };
  });
}

export async function handleRejectVersion(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number; reason: RejectionReason }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requireDocumentId(req);
    const seq = requireSeq(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REJECT_VERSION_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const version = await deps.documentArchive.rejectVersion(context, documentId, seq, req.body.expectedVersion, req.body.reason);
    return { statusCode: 200, body: { version } };
  });
}

// --- Requirement (D-143 Decision 5 / D9, D-145) ---------------------------------------------

export async function handleCreateRequirement(deps: DocumentArchiveHttpDeps, req: HttpRequest<CreateRequirementInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REQUIREMENT_CREATE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const requirement = await deps.documentArchive.createRequirement(context, req.body);
    return { statusCode: 201, body: { requirement } };
  });
}

export async function handleGetRequirement(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const requirementId = requireRequirementId(req);
    const context = await resolve(deps, req);
    const requirement = await deps.documentArchive.getRequirement(context, subjectId, requirementId);
    return { statusCode: 200, body: { requirement } };
  });
}

export async function handleListRequirements(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const context = await resolve(deps, req);
    const requirements = await deps.documentArchive.listRequirements(context, subjectId);
    return { statusCode: 200, body: { requirements } };
  });
}

/** Roadmap P0.6 (dashboard operacional/compliance básico), fatia 2 — GET
 * /document-archive/requirements/{subjectId}/compliance. Routed ABOVE
 * `/document-archive/requirements/{subjectId}/{requirementId}` in
 * `document-archive-handler.ts`'s switch (API Gateway itself resolves the literal `compliance`
 * segment over `{requirementId}` regardless of switch-case order - see that handler's own
 * routeKey comment) but the `PROXY_ALLOWLIST` array in `proxy-allowlist.ts` matches by
 * `.find()`, so THAT list must list this entry before the `{requirementId}` one. */
export async function handleGetSubjectCompliance(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const context = await resolve(deps, req);
    const compliance = await deps.documentArchive.getSubjectCompliance(context, subjectId);
    return { statusCode: 200, body: { compliance } };
  });
}

const REQUIREMENT_STATUSES = new Set(["MISSING", "PENDING", "SATISFIED", "NOT_SATISFIED", "NOT_APPLICABLE"]);
const VALIDITY_STATES = new Set(["PERMANENTE", "VALIDO", "VENCENDO", "VENCIDO", "AGUARDANDO_REVISAO"]);

/** D-194 Fatia 3 — GET /document-archive/requirements/search. Route lives ABOVE
 * `/document-archive/requirements/{subjectId}` in `main.tf`/the switch below on purpose — API
 * Gateway v2 prioritizes the literal `search` segment over the `{subjectId}` path parameter at
 * the same position (same precedent `main.tf`'s `GET /items/dashboard` comment documents). */
export async function handleSearchRequirements(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const qs = req.queryStringParameters ?? {};
    const queryObject: Record<string, string> = {};
    for (const key of ["status", "namePrefix", "assigneeUserId", "validityState", "cursor"] as const) {
      const value = qs[key];
      if (value !== undefined) queryObject[key] = value;
    }
    const { valid, errors } = defaultSchemaRegistry.validate(REQUIREMENT_SEARCH_SCHEMA_ID, queryObject);
    if (!valid) throw new ValidationError("Query parameters failed schema validation.", { errors });

    const status = queryObject["status"] as RequirementStatus | undefined;
    if (!status || !REQUIREMENT_STATUSES.has(status)) {
      throw new ValidationError("Invalid or missing status query parameter.", { allowed: [...REQUIREMENT_STATUSES] });
    }
    const validityState = queryObject["validityState"] as UnifiedValidityState | undefined;
    if (validityState !== undefined && !VALIDITY_STATES.has(validityState)) {
      throw new ValidationError("Invalid validityState query parameter.", { allowed: [...VALIDITY_STATES] });
    }
    const namePrefix = queryObject["namePrefix"];
    const assigneeUserId = queryObject["assigneeUserId"];
    const signature = { mode: "REQUIREMENT", status, namePrefix, assigneeUserId, validityState };
    const exclusiveStartKey = queryObject["cursor"] !== undefined ? decodeSearchCursor(queryObject["cursor"], signature) : undefined;

    const context = await resolve(deps, req);
    const page = await deps.documentArchive.searchRequirements(context, { status, namePrefix, assigneeUserId, validityState, exclusiveStartKey });
    return {
      statusCode: 200,
      body: {
        items: page.items,
        cursor: page.lastEvaluatedKey ? encodeSearchCursor(signature, page.lastEvaluatedKey) : null,
        scanLimitReached: page.scanLimitReached,
      },
    };
  });
}

export async function handleUpdateRequirement(deps: DocumentArchiveHttpDeps, req: HttpRequest<UpdateRequirementInput & { expectedVersion: number }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const requirementId = requireRequirementId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REQUIREMENT_UPDATE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const { expectedVersion, ...input } = req.body;
    const requirement = await deps.documentArchive.updateRequirement(context, subjectId, requirementId, expectedVersion, input);
    return { statusCode: 200, body: { requirement } };
  });
}

export async function handleLinkEvidence(
  deps: DocumentArchiveHttpDeps,
  req: HttpRequest<{ expectedVersion: number; documentId: string; versionId: string }>,
): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const requirementId = requireRequirementId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REQUIREMENT_LINK_EVIDENCE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const requirement = await deps.documentArchive.linkEvidence(context, subjectId, requirementId, req.body.expectedVersion, req.body.documentId, req.body.versionId);
    return { statusCode: 200, body: { requirement } };
  });
}

export async function handleUnlinkEvidence(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const requirementId = requireRequirementId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REQUIREMENT_UNLINK_EVIDENCE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const requirement = await deps.documentArchive.unlinkEvidence(context, subjectId, requirementId, req.body.expectedVersion);
    return { statusCode: 200, body: { requirement } };
  });
}

export async function handleDeleteRequirement(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const requirementId = requireRequirementId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REQUIREMENT_DELETE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    await deps.documentArchive.deleteRequirement(context, subjectId, requirementId, req.body.expectedVersion);
    return { statusCode: 204, body: {} };
  });
}

// --- Recurrence / DocumentRequestSeries (D-143 Decision 8, D-147) --------------------------
// Tenant-facing series management only — the resulting guest link/DocumentRequest surfaces
// through the EXISTING guest-facing handlers (document-archive-guest-handlers.ts), never here.

export async function handleCreateSeries(deps: DocumentArchiveHttpDeps, req: HttpRequest<CreateDocumentRequestSeriesInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(SERIES_CREATE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const series = await deps.recurrence.createSeries(context, req.body);
    return { statusCode: 201, body: { series } };
  });
}

export async function handleGetSeries(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const seriesId = requireSeriesId(req);
    const context = await resolve(deps, req);
    const series = await deps.recurrence.getSeries(context, subjectId, seriesId);
    return { statusCode: 200, body: { series } };
  });
}

export async function handleListSeries(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const context = await resolve(deps, req);
    const series = await deps.recurrence.listSeries(context, subjectId);
    return { statusCode: 200, body: { series } };
  });
}

export async function handleCancelSeries(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const seriesId = requireSeriesId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(SERIES_CANCEL_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const series = await deps.recurrence.cancelSeries(context, subjectId, seriesId, req.body.expectedVersion);
    return { statusCode: 200, body: { series } };
  });
}

export async function handleMaterializeSeriesAttempt(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const seriesId = requireSeriesId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(SERIES_MATERIALIZE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const result = await deps.recurrence.materializeAttempt(context, subjectId, seriesId, req.body.expectedVersion);
    return { statusCode: 200, body: { ...result } };
  });
}

// --- DocumentType catalog (D-173, item 5) ---------------------------------------------------

export async function handleCreateDocumentType(deps: DocumentArchiveHttpDeps, req: HttpRequest<CreateDocumentTypeInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(DOCUMENTTYPE_CREATE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const documentType = await deps.documentArchive.createDocumentType(context, req.body);
    return { statusCode: 201, body: { documentType } };
  });
}

export async function handleGetDocumentType(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentTypeId = requireDocumentTypeId(req);
    const context = await resolve(deps, req);
    const documentType = await deps.documentArchive.getDocumentType(context, documentTypeId);
    return { statusCode: 200, body: { documentType } };
  });
}

export async function handleListDocumentTypes(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const status = requireDocumentTypeStatus(req);
    const context = await resolve(deps, req);
    const { items, lastEvaluatedKey } = await deps.documentArchive.listDocumentTypes(context, status);
    return { statusCode: 200, body: { documentTypes: items, ...(lastEvaluatedKey ? { lastEvaluatedKey } : {}) } };
  });
}

export async function handleRenameDocumentType(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number; displayName: string }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentTypeId = requireDocumentTypeId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(DOCUMENTTYPE_RENAME_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const documentType = await deps.documentArchive.renameDocumentType(context, documentTypeId, req.body.expectedVersion, req.body.displayName);
    return { statusCode: 200, body: { documentType } };
  });
}

export async function handleDeprecateDocumentType(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentTypeId = requireDocumentTypeId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(DOCUMENTTYPE_DEPRECATE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const documentType = await deps.documentArchive.deprecateDocumentType(context, documentTypeId, req.body.expectedVersion);
    return { statusCode: 200, body: { documentType } };
  });
}

export async function handleReactivateDocumentType(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentTypeId = requireDocumentTypeId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(DOCUMENTTYPE_REACTIVATE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const documentType = await deps.documentArchive.reactivateDocumentType(context, documentTypeId, req.body.expectedVersion);
    return { statusCode: 200, body: { documentType } };
  });
}

// --- RequirementTemplate catalog (P0.1) -----------------------------------------------------
// Same pipeline as the DocumentType routes above (resolve context -> schema validation ->
// service, which authorizes internally -> AppError -> status mapping). Every mutation consumes
// the same API_REQUEST quota as every other business write in this module.

function requireTemplateId(req: HttpRequest): string {
  const templateId = req.pathParameters?.["templateId"];
  if (!templateId) throw new ValidationError("Missing templateId path parameter.");
  return templateId;
}

function requireTemplateStatus(req: HttpRequest): RequirementTemplate["status"] {
  const raw = req.queryStringParameters?.["status"] ?? "ACTIVE";
  if (raw !== "ACTIVE" && raw !== "ARCHIVED") {
    throw new ValidationError("Invalid status query parameter (expected ACTIVE or ARCHIVED).", { status: raw });
  }
  return raw;
}

export async function handleCreateRequirementTemplate(deps: DocumentArchiveHttpDeps, req: HttpRequest<CreateRequirementTemplateInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REQTEMPLATE_CREATE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    await consumeApiRequestQuota(deps.quota, context.tenant.tenantId);
    const template = await deps.documentArchive.createRequirementTemplate(context, req.body);
    return { statusCode: 201, body: { requirementTemplate: template } };
  });
}

export async function handleGetRequirementTemplate(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const templateId = requireTemplateId(req);
    const context = await resolve(deps, req);
    const template = await deps.documentArchive.getRequirementTemplate(context, templateId);
    return { statusCode: 200, body: { requirementTemplate: template } };
  });
}

export async function handleListRequirementTemplates(deps: DocumentArchiveHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const status = requireTemplateStatus(req);
    const context = await resolve(deps, req);
    const { items, lastEvaluatedKey } = await deps.documentArchive.listRequirementTemplates(context, status);
    return { statusCode: 200, body: { requirementTemplates: items, ...(lastEvaluatedKey ? { lastEvaluatedKey } : {}) } };
  });
}

export async function handleUpdateRequirementTemplate(
  deps: DocumentArchiveHttpDeps,
  req: HttpRequest<UpdateRequirementTemplateInput & { expectedVersion: number }>,
): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const templateId = requireTemplateId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REQTEMPLATE_UPDATE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    await consumeApiRequestQuota(deps.quota, context.tenant.tenantId);
    const { expectedVersion, ...input } = req.body;
    const template = await deps.documentArchive.updateRequirementTemplate(context, templateId, expectedVersion, input);
    return { statusCode: 200, body: { requirementTemplate: template } };
  });
}

export async function handleDuplicateRequirementTemplate(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ displayName: string }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const templateId = requireTemplateId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REQTEMPLATE_DUPLICATE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    await consumeApiRequestQuota(deps.quota, context.tenant.tenantId);
    const template = await deps.documentArchive.duplicateRequirementTemplate(context, templateId, req.body.displayName);
    return { statusCode: 201, body: { requirementTemplate: template } };
  });
}

export async function handleArchiveRequirementTemplate(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const templateId = requireTemplateId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REQTEMPLATE_ARCHIVE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    await consumeApiRequestQuota(deps.quota, context.tenant.tenantId);
    const template = await deps.documentArchive.archiveRequirementTemplate(context, templateId, req.body.expectedVersion);
    return { statusCode: 200, body: { requirementTemplate: template } };
  });
}

export async function handleUnarchiveRequirementTemplate(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ expectedVersion: number }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const templateId = requireTemplateId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REQTEMPLATE_UNARCHIVE_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    await consumeApiRequestQuota(deps.quota, context.tenant.tenantId);
    const template = await deps.documentArchive.unarchiveRequirementTemplate(context, templateId, req.body.expectedVersion);
    return { statusCode: 200, body: { requirementTemplate: template } };
  });
}

/** POST, not GET: it carries `subjectId` in the body and is a computation rather than an
 * addressable resource — and so it shares its validation shape with apply. Read-only, so no
 * write quota is consumed. */
export async function handlePreviewRequirementTemplate(deps: DocumentArchiveHttpDeps, req: HttpRequest<{ subjectId: string }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const templateId = requireTemplateId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REQTEMPLATE_PREVIEW_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    const plan = await deps.documentArchive.previewTemplateApplication(context, templateId, req.body.subjectId);
    return { statusCode: 200, body: { ...plan } };
  });
}

export async function handleApplyRequirementTemplate(
  deps: DocumentArchiveHttpDeps,
  req: HttpRequest<{ subjectId: string; expectedTemplateVersion?: number }>,
): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const templateId = requireTemplateId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REQTEMPLATE_APPLY_SCHEMA_ID, req.body);
    const context = await resolve(deps, req);
    await consumeApiRequestQuota(deps.quota, context.tenant.tenantId);
    const result = await deps.documentArchive.applyTemplate(context, templateId, req.body.subjectId, req.body.expectedTemplateVersion);
    // 200, not 201: an apply that creates nothing is a legitimate, idempotent success (re-applying
    // a template the Subject already satisfies), not a conflict.
    return { statusCode: 200, body: { ...result } };
  });
}

