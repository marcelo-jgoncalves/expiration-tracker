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
import type { RequestContextResolver, ValidatedClaims } from "../../identity/application/resolve-request-context.js";
import type { TenantQuotaService } from "../../identity/application/quota.js";
import type { DocumentArchiveService } from "../application/document-archive-service.js";
import type { DocumentRequestRecurrenceService } from "../application/document-request-recurrence-service.js";
import type { CreateDocumentInput } from "../domain/document.js";
import type { DocumentVersionOrigin, RejectionReason } from "../domain/document-version.js";
import type { CreateRequirementInput, UpdateRequirementInput } from "../domain/requirement.js";
import type { CreateDocumentRequestSeriesInput } from "../domain/document-request-series.js";

function validateAgainstSchema(schemaId: string, body: unknown): void {
  const { valid, errors } = defaultSchemaRegistry.validate(schemaId, body);
  if (!valid) {
    throw new ValidationError("Request body failed schema validation.", { errors });
  }
}

const CREATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-create-request.v1.json";
const RESERVE_UPLOAD_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-reserve-upload-request.v1.json";
const COMMIT_UPLOAD_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-commit-upload-request.v1.json";
const CLAIM_REVIEW_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-claim-review-request.v1.json";
const ACCEPT_VERSION_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-accept-version-request.v1.json";
const REJECT_VERSION_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-reject-version-request.v1.json";
const REQUIREMENT_CREATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirement-create-request.v1.json";
const REQUIREMENT_UPDATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirement-update-request.v1.json";
const REQUIREMENT_LINK_EVIDENCE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirement-link-evidence-request.v1.json";
const REQUIREMENT_UNLINK_EVIDENCE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirement-unlink-evidence-request.v1.json";
const REQUIREMENT_DELETE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-requirement-delete-request.v1.json";
const SERIES_CREATE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-series-create-request.v1.json";
const SERIES_CANCEL_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-series-cancel-request.v1.json";
const SERIES_MATERIALIZE_SCHEMA_ID = "https://expiration-tracker/schemas/api/docarchive-series-materialize-request.v1.json";

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

