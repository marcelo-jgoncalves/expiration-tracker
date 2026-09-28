/**
 * HTTP handlers for M7 item 8's confirm/reject routes (§1.7) — mirrors expiration/http/
 * item-handlers.ts and document/http/document-handlers.ts's exact pipeline/error-mapping
 * convention, plus the one addition every other module's local copy doesn't need yet:
 * BUSINESS_RULE -> 422 (see shared/errors/app-error.ts's BusinessRuleError).
 */
import { AppError, ValidationError, toAppError, AuthorizationError } from "../../../shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../identity/domain/authorization.js";
import { auditAuthorizationDenied } from "../../../shared/observability/security-audit.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import type { RequestContextResolver, ValidatedClaims } from "../../identity/application/resolve-request-context.js";
import type { RequestContext } from "../../identity/domain/request-context.js";
import type { TenantQuotaService } from "../../identity/application/quota.js";
import { confirmField, rejectField, type ConfirmRejectFieldDeps } from "../application/confirm-reject-field.js";
import { confirmFieldForDocumentArchive, rejectFieldForDocumentArchive, type ConfirmRejectFieldDocumentArchiveDeps } from "../application/confirm-reject-field-document-archive.js";
import {
  getExtractionDisclosureForItem,
  getExtractionDisclosureForDocumentArchive,
  type GetExtractionDisclosureForItemDeps,
  type GetExtractionDisclosureForDocumentArchiveDeps,
} from "../application/read-extraction-disclosure.js";
import type { ExtractedField } from "../domain/extracted-field.js";

const CONFIRM_SCHEMA_ID = "https://expiration-tracker/schemas/api/confirm-extracted-field-request.v1.json";
const REJECT_SCHEMA_ID = "https://expiration-tracker/schemas/api/reject-extracted-field-request.v1.json";
const CONFIRM_DOCUMENT_ARCHIVE_SCHEMA_ID = "https://expiration-tracker/schemas/api/confirm-extracted-field-document-archive-request.v1.json";
const REJECT_DOCUMENT_ARCHIVE_SCHEMA_ID = "https://expiration-tracker/schemas/api/reject-extracted-field-document-archive-request.v1.json";

async function consumeApiRequestQuota(quota: TenantQuotaService, context: RequestContext): Promise<void> {
  await quota.consume({ tenantId: context.tenant.tenantId, quotaType: "API_REQUEST", window: "current", limit: 100, windowSeconds: 60 });
}

function validateAgainstSchema(schemaId: string, body: unknown): void {
  const { valid, errors } = defaultSchemaRegistry.validate(schemaId, body);
  if (!valid) throw new ValidationError("Request body failed schema validation.", { errors });
}

export interface HttpRequest<TBody = unknown> {
  requestId: string;
  correlationId: string;
  claims: ValidatedClaims;
  pathParameters?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
  body?: TBody;
}

export interface HttpResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

export interface ExtractionHttpDeps {
  resolver: RequestContextResolver;
  quota: TenantQuotaService;
  fields: ConfirmRejectFieldDeps;
  fieldsDocumentArchive: ConfirmRejectFieldDocumentArchiveDeps;
  disclosureForItem: GetExtractionDisclosureForItemDeps;
  disclosureForDocumentArchive: GetExtractionDisclosureForDocumentArchiveDeps;
}

const STATUS_BY_CATEGORY: Record<string, number> = {
  VALIDATION: 400,
  AUTH: 401,
  AUTHORIZATION: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  BUSINESS_RULE: 422,
  QUOTA_EXCEEDED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL: 500,
};

function toResponse(appError: AppError): HttpResponse {
  return { statusCode: STATUS_BY_CATEGORY[appError.category] ?? 500, body: appError.toJSON() };
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

/** D-349 achado real (mesma disciplina já documentada em `membership-handlers.ts`'s
 * `handleListMembers`, Wave B2B-14/D-120: nunca devolver o item bruto de DynamoDB por HTTP -
 * `PK`/`SK`/`entityType`/`tenantId` são estrutura interna de chave, não contrato de API). Projeta
 * `ExtractedField` para o subconjunto seguro que o disclosure de IA realmente precisa. */
function presentField(field: ExtractedField): Record<string, unknown> {
  return {
    fieldName: field.fieldName,
    valueType: field.valueType,
    candidateValue: field.candidateValue,
    confidence: field.confidence,
    sources: field.sources,
    agreement: field.agreement,
    state: field.state,
    confirmedValue: field.confirmedValue,
    confirmedBy: field.confirmedBy,
    confirmedAt: field.confirmedAt,
    version: field.version,
  };
}

function requirePathParam(req: HttpRequest, name: string): string {
  const value = req.pathParameters?.[name];
  if (!value) throw new ValidationError(`Missing ${name} path parameter.`);
  return value;
}

function requireIdempotencyKey(req: HttpRequest): string {
  const key = req.headers?.["idempotency-key"];
  if (!key) throw new ValidationError("Missing Idempotency-Key header.");
  return key;
}

interface ConfirmFieldBody {
  expectedItemVersion: number;
  expectedDocumentVersion: number;
  expectedRunVersion: number;
  expectedFieldVersion: number;
  confirmedValue: string;
}

interface RejectFieldBody {
  expectedDocumentVersion: number;
  expectedRunVersion: number;
  expectedFieldVersion: number;
  correctionReason?: string;
}

export async function handleConfirmField(deps: ExtractionHttpDeps, req: HttpRequest<ConfirmFieldBody>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(CONFIRM_SCHEMA_ID, req.body);
    const itemId = requirePathParam(req, "itemId");
    const documentId = requirePathParam(req, "documentId");
    const runId = requirePathParam(req, "runId");
    const fieldName = requirePathParam(req, "fieldName");
    const idempotencyKey = requireIdempotencyKey(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps.quota, context);
    const field = await confirmField(deps.fields, context, {
      itemId,
      documentId,
      runId,
      fieldName,
      expectedItemVersion: req.body.expectedItemVersion,
      expectedDocumentVersion: req.body.expectedDocumentVersion,
      expectedRunVersion: req.body.expectedRunVersion,
      expectedFieldVersion: req.body.expectedFieldVersion,
      confirmedValue: req.body.confirmedValue,
      idempotencyKey,
    });
    return { statusCode: 200, body: { field: presentField(field) } };
  });
}

/** D-349: `GET /items/{itemId}/documents/{documentId}/extractions` - the read contract A07's
 * disclosure UI needs. Authorization/tenant-scoping happens inside
 * `getExtractionDisclosureForItem` itself (`document:read`), same as every other read handler in
 * this codebase. Returns `{ disclosure: null }` (never a 404) when extraction hasn't produced a
 * run yet for this document's current version - that is a normal, expected state, not an error. */
export async function handleGetExtractionDisclosureForItem(deps: ExtractionHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const itemId = requirePathParam(req, "itemId");
    const documentId = requirePathParam(req, "documentId");
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    const disclosure = await getExtractionDisclosureForItem(deps.disclosureForItem, context, itemId, documentId);
    return { statusCode: 200, body: { disclosure: disclosure ? { runId: disclosure.runId, runStatus: disclosure.runStatus, fields: disclosure.fields.map(presentField) } : null } };
  });
}

/** D-349: `GET /document-archive/documents/{documentId}/versions/{seq}/extractions` - A12's
 * counterpart, same "no run yet is a normal null, never a 404" contract. */
export async function handleGetExtractionDisclosureForDocumentArchive(deps: ExtractionHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const documentId = requirePathParam(req, "documentId");
    const seq = Number(requirePathParam(req, "seq"));
    if (!Number.isInteger(seq) || seq < 1) throw new ValidationError("Invalid seq path parameter.");
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    const disclosure = await getExtractionDisclosureForDocumentArchive(deps.disclosureForDocumentArchive, context, documentId, seq);
    return { statusCode: 200, body: { disclosure: disclosure ? { runId: disclosure.runId, runStatus: disclosure.runStatus, fields: disclosure.fields.map(presentField) } : null } };
  });
}

interface ConfirmFieldDocumentArchiveBody {
  expectedDocumentVersionVersion: number;
  expectedRunVersion: number;
  expectedFieldVersion: number;
  confirmedValue: string;
}

interface RejectFieldDocumentArchiveBody {
  expectedRunVersion: number;
  expectedFieldVersion: number;
  correctionReason?: string;
}

/** D-349 / D-193 item 4/9: `document-archive`'s confirm route - the service
 * (`confirmFieldForDocumentArchive`) has existed since D-193, but was never reachable over HTTP
 * until now (Codex's read of the design confirmed this gap explicitly). */
export async function handleConfirmFieldDocumentArchive(deps: ExtractionHttpDeps, req: HttpRequest<ConfirmFieldDocumentArchiveBody>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(CONFIRM_DOCUMENT_ARCHIVE_SCHEMA_ID, req.body);
    const documentId = requirePathParam(req, "documentId");
    const seq = Number(requirePathParam(req, "seq"));
    if (!Number.isInteger(seq) || seq < 1) throw new ValidationError("Invalid seq path parameter.");
    const runId = requirePathParam(req, "runId");
    const fieldName = requirePathParam(req, "fieldName");
    const idempotencyKey = requireIdempotencyKey(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps.quota, context);
    const field = await confirmFieldForDocumentArchive(deps.fieldsDocumentArchive, context, {
      documentId,
      seq,
      runId,
      fieldName,
      expectedDocumentVersionVersion: req.body.expectedDocumentVersionVersion,
      expectedRunVersion: req.body.expectedRunVersion,
      expectedFieldVersion: req.body.expectedFieldVersion,
      confirmedValue: req.body.confirmedValue,
      correlationId: req.correlationId,
      idempotencyKey,
    });
    return { statusCode: 200, body: { field: presentField(field) } };
  });
}

export async function handleRejectFieldDocumentArchive(deps: ExtractionHttpDeps, req: HttpRequest<RejectFieldDocumentArchiveBody>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REJECT_DOCUMENT_ARCHIVE_SCHEMA_ID, req.body);
    const documentId = requirePathParam(req, "documentId");
    const runId = requirePathParam(req, "runId");
    const fieldName = requirePathParam(req, "fieldName");
    const idempotencyKey = requireIdempotencyKey(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps.quota, context);
    const field = await rejectFieldForDocumentArchive(deps.fieldsDocumentArchive, context, {
      documentId,
      runId,
      fieldName,
      expectedRunVersion: req.body.expectedRunVersion,
      expectedFieldVersion: req.body.expectedFieldVersion,
      correctionReason: req.body.correctionReason,
      idempotencyKey,
    });
    return { statusCode: 200, body: { field: presentField(field) } };
  });
}

export async function handleRejectField(deps: ExtractionHttpDeps, req: HttpRequest<RejectFieldBody>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(REJECT_SCHEMA_ID, req.body);
    const itemId = requirePathParam(req, "itemId");
    const documentId = requirePathParam(req, "documentId");
    const runId = requirePathParam(req, "runId");
    const fieldName = requirePathParam(req, "fieldName");
    const idempotencyKey = requireIdempotencyKey(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps.quota, context);
    const field = await rejectField(deps.fields, context, {
      itemId,
      documentId,
      runId,
      fieldName,
      expectedDocumentVersion: req.body.expectedDocumentVersion,
      expectedRunVersion: req.body.expectedRunVersion,
      expectedFieldVersion: req.body.expectedFieldVersion,
      correctionReason: req.body.correctionReason,
      idempotencyKey,
    });
    return { statusCode: 200, body: { field: presentField(field) } };
  });
}
