/** HTTP handlers for the Import module (M11, D-042) — mirrors
 * document/http/document-handlers.ts's pipeline and error mapping exactly. */
import { AppError, ValidationError, toAppError, AuthorizationError } from "../../../shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../identity/domain/authorization.js";
import { auditAuthorizationDenied } from "../../../shared/observability/security-audit.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import type { RequestContextResolver, ValidatedClaims } from "../../identity/application/resolve-request-context.js";
import type { RequestContext } from "../../identity/domain/request-context.js";
import type { TenantQuotaService } from "../../identity/application/quota.js";
import type { ImportService, ReserveImportInput } from "../application/import-service.js";
import type { ColumnMapping } from "../domain/import-job.js";

const RESERVE_IMPORT_SCHEMA_ID = "https://expiration-tracker/schemas/api/reserve-import-request.v1.json";
const IMPORT_MAPPING_SCHEMA_ID = "https://expiration-tracker/schemas/api/import-mapping-request.v1.json";

async function consumeApiQuota(quota: TenantQuotaService, context: RequestContext): Promise<void> {
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

export interface ImportHttpDeps {
  resolver: RequestContextResolver;
  imports: ImportService;
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

function requireJobId(req: HttpRequest): string {
  const jobId = req.pathParameters?.["jobId"];
  if (!jobId) throw new ValidationError("Missing jobId path parameter.");
  return jobId;
}

function requireIdempotencyKey(req: HttpRequest): string {
  const key = req.headers?.["idempotency-key"];
  if (!key) throw new ValidationError("Missing Idempotency-Key header.");
  return key;
}

function requireExpectedVersion(req: HttpRequest): number {
  const raw = req.headers?.["if-match"];
  const version = Number(raw);
  if (!raw || Number.isNaN(version) || !Number.isInteger(version) || version < 1) {
    throw new ValidationError("Missing or invalid expected version (If-Match header).");
  }
  return version;
}

export async function handleReserveImport(deps: ImportHttpDeps, req: HttpRequest<ReserveImportInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(RESERVE_IMPORT_SCHEMA_ID, req.body);
    const idempotencyKey = requireIdempotencyKey(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiQuota(deps.quota, context);
    const result = await deps.imports.reserveImport(context, req.body, idempotencyKey);
    return { statusCode: 201, body: { ...result } };
  });
}

export async function handleGetImportJob(deps: ImportHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const jobId = requireJobId(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiQuota(deps.quota, context);
    const job = await deps.imports.getImportJob(context, jobId);
    return { statusCode: 200, body: { job } };
  });
}

export async function handleGetImportJobSchema(deps: ImportHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const jobId = requireJobId(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiQuota(deps.quota, context);
    const schema = await deps.imports.getImportJobSchema(context, jobId);
    return { statusCode: 200, body: { ...schema } };
  });
}

export async function handleSubmitImportMapping(deps: ImportHttpDeps, req: HttpRequest<{ columnMapping: ColumnMapping }>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(IMPORT_MAPPING_SCHEMA_ID, req.body);
    const jobId = requireJobId(req);
    const expectedVersion = requireExpectedVersion(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiQuota(deps.quota, context);
    const result = await deps.imports.submitImportMapping(context, jobId, req.body.columnMapping, expectedVersion);
    return { statusCode: 200, body: { ...result } };
  });
}

export async function handleRequestImportCommit(deps: ImportHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const jobId = requireJobId(req);
    const expectedVersion = requireExpectedVersion(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiQuota(deps.quota, context);
    await deps.imports.requestCommit(context, jobId, expectedVersion);
    return { statusCode: 202, body: {} };
  });
}
