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

const CONFIRM_SCHEMA_ID = "https://expiration-tracker/schemas/api/confirm-extracted-field-request.v1.json";
const REJECT_SCHEMA_ID = "https://expiration-tracker/schemas/api/reject-extracted-field-request.v1.json";

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
    return { statusCode: 200, body: { field } };
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
    return { statusCode: 200, body: { field } };
  });
}
