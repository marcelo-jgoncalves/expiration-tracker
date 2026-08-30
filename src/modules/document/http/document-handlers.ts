/** HTTP handlers for the Document module — mirrors expiration/http/item-handlers.ts's
 * pipeline and error mapping exactly (M6 design). */
import { AppError, ValidationError, toAppError, AuthorizationError } from "../../../shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../identity/domain/authorization.js";
import { auditAuthorizationDenied } from "../../../shared/observability/security-audit.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import type { RequestContextResolver, ValidatedClaims } from "../../identity/application/resolve-request-context.js";
import type { RequestContext } from "../../identity/domain/request-context.js";
import type { TenantQuotaService } from "../../identity/application/quota.js";
import type { DocumentService, ReserveUploadInput } from "../application/document-service.js";
import type { DocumentDeletionService } from "../application/document-deletion-service.js";

const RESERVE_UPLOAD_SCHEMA_ID = "https://expiration-tracker/schemas/api/reserve-document-upload-request.v1.json";

async function consumeUploadQuota(quota: TenantQuotaService, context: RequestContext): Promise<void> {
  await quota.consume({ tenantId: context.tenant.tenantId, quotaType: "UPLOAD_COUNT", window: "current", limit: 20, windowSeconds: 60 });
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

export interface DocumentHttpDeps {
  resolver: RequestContextResolver;
  documents: DocumentService;
  deletion: DocumentDeletionService;
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

function requireItemId(req: HttpRequest): string {
  const itemId = req.pathParameters?.["itemId"];
  if (!itemId) throw new ValidationError("Missing itemId path parameter.");
  return itemId;
}

function requireDocumentId(req: HttpRequest): string {
  const documentId = req.pathParameters?.["documentId"];
  if (!documentId) throw new ValidationError("Missing documentId path parameter.");
  return documentId;
}

function requireIdempotencyKey(req: HttpRequest): string {
  const key = req.headers?.["idempotency-key"];
  if (!key) throw new ValidationError("Missing Idempotency-Key header.");
  return key;
}

export async function handleReserveUpload(deps: DocumentHttpDeps, req: HttpRequest<ReserveUploadInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(RESERVE_UPLOAD_SCHEMA_ID, req.body);
    const itemId = requireItemId(req);
    const idempotencyKey = requireIdempotencyKey(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeUploadQuota(deps.quota, context);
    const result = await deps.documents.reserveUpload(context, itemId, req.body, idempotencyKey);
    return { statusCode: 201, body: { ...result } };
  });
}

export async function handleDeleteDocument(deps: DocumentHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const itemId = requireItemId(req);
    const documentId = requireDocumentId(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await deps.deletion.deleteDocument(context, itemId, documentId);
    return { statusCode: 204, body: {} };
  });
}

/** BLOCKER-A: GET /items/{itemId}/documents/{documentId}. */
export async function handleGetDocument(deps: DocumentHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const itemId = requireItemId(req);
    const documentId = requireDocumentId(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    const document = await deps.documents.getDocument(context, itemId, documentId);
    return { statusCode: 200, body: { ...document } };
  });
}

/** BLOCKER-A: GET /items/{itemId}/documents. */
export async function handleListDocuments(deps: DocumentHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const itemId = requireItemId(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    const documents = await deps.documents.listDocuments(context, itemId);
    return { statusCode: 200, body: { documents } };
  });
}
