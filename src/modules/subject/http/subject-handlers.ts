/**
 * HTTP handlers do módulo subject — mesmo pipeline de expiration/http/item-handlers.ts
 * (resolve -> service, que já chama authorize() internamente; mesmo mapeamento AppError ->
 * status code, mesma quota de API_REQUEST antes de qualquer serviço de negócio).
 */
import { AppError, ValidationError, toAppError } from "../../../shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../identity/domain/authorization.js";
import { AuthorizationError } from "../../../shared/errors/app-error.js";
import { auditAuthorizationDenied } from "../../../shared/observability/security-audit.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import type { RequestContextResolver, ValidatedClaims } from "../../identity/application/resolve-request-context.js";
import type { RequestContext } from "../../identity/domain/request-context.js";
import type { TenantQuotaService } from "../../identity/application/quota.js";
import type { SubjectService } from "../application/subject-service.js";
import type { CreateSubjectInput, UpdateSubjectInput, TrackedSubjectStatus } from "../domain/tracked-subject.js";

async function consumeApiRequestQuota(quota: TenantQuotaService, context: RequestContext): Promise<void> {
  await quota.consume({ tenantId: context.tenant.tenantId, quotaType: "API_REQUEST", window: "current", limit: 100, windowSeconds: 60 });
}

function validateAgainstSchema(schemaId: string, body: unknown): void {
  const { valid, errors } = defaultSchemaRegistry.validate(schemaId, body);
  if (!valid) {
    throw new ValidationError("Request body failed schema validation.", { errors });
  }
}

const CREATE_SUBJECT_SCHEMA_ID = "https://expiration-tracker/schemas/api/create-subject-request.v1.json";
const UPDATE_SUBJECT_SCHEMA_ID = "https://expiration-tracker/schemas/api/update-subject-request.v1.json";

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

export interface SubjectHttpDeps {
  resolver: RequestContextResolver;
  subjects: SubjectService;
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
  const status = STATUS_BY_CATEGORY[appError.category] ?? 500;
  return { statusCode: status, body: appError.toJSON() };
}

export async function withErrorMapping(fn: () => Promise<HttpResponse>): Promise<HttpResponse> {
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

export function requireSubjectId(req: HttpRequest): string {
  const subjectId = req.pathParameters?.["subjectId"];
  if (!subjectId) throw new ValidationError("Missing subjectId path parameter.");
  return subjectId;
}

const SUBJECT_STATUSES = new Set(["ACTIVE", "ARCHIVED", "DELETED"]);

export function requireExpectedVersion(req: HttpRequest): number {
  const raw = req.headers?.["if-match"] ?? req.queryStringParameters?.["expectedVersion"];
  const version = Number(raw);
  if (!raw || Number.isNaN(version) || !Number.isInteger(version) || version < 1) {
    throw new ValidationError("Missing or invalid expected version (If-Match header).");
  }
  return version;
}

function requireListStatus(req: HttpRequest): TrackedSubjectStatus {
  const raw = req.queryStringParameters?.["status"] ?? "ACTIVE";
  if (!SUBJECT_STATUSES.has(raw)) {
    throw new ValidationError("Invalid status query parameter.", { allowed: [...SUBJECT_STATUSES] });
  }
  return raw as TrackedSubjectStatus;
}

export async function handleCreateSubject(deps: SubjectHttpDeps, req: HttpRequest<CreateSubjectInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(CREATE_SUBJECT_SCHEMA_ID, req.body);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps.quota, context);
    const subject = await deps.subjects.createSubject(context, req.body);
    return { statusCode: 201, body: { subject } };
  });
}

export async function handleGetSubject(deps: SubjectHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps.quota, context);
    const subject = await deps.subjects.getSubject(context, subjectId);
    return { statusCode: 200, body: { subject } };
  });
}

export async function handleUpdateSubject(deps: SubjectHttpDeps, req: HttpRequest<UpdateSubjectInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(UPDATE_SUBJECT_SCHEMA_ID, req.body);
    const expectedVersion = requireExpectedVersion(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps.quota, context);
    const subject = await deps.subjects.updateSubject(context, subjectId, req.body, expectedVersion);
    return { statusCode: 200, body: { subject } };
  });
}

export async function handleArchiveSubject(deps: SubjectHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const expectedVersion = requireExpectedVersion(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps.quota, context);
    await deps.subjects.archiveSubject(context, subjectId, expectedVersion);
    return { statusCode: 204, body: {} };
  });
}

export async function handleDeleteSubject(deps: SubjectHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const subjectId = requireSubjectId(req);
    const expectedVersion = requireExpectedVersion(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps.quota, context);
    await deps.subjects.deleteSubject(context, subjectId, expectedVersion);
    return { statusCode: 204, body: {} };
  });
}

export async function handleListSubjects(deps: SubjectHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const status = requireListStatus(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps.quota, context);
    const subjects = await deps.subjects.listSubjects(context, { status });
    return { statusCode: 200, body: { subjects } };
  });
}
