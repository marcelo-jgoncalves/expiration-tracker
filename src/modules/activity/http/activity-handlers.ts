/**
 * HTTP handler for GET /activity (D-149, admin-activity-log-scoping/estado-final-consolidado.md).
 * Mirrors expiration/http/item-handlers.ts's pipeline (resolve -> service, which internally
 * calls authorize()) and its AppError -> status-code mapping, so this route fails the same way
 * as every other route in the system.
 */
import { AppError, ValidationError, toAppError } from "../../../shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../identity/domain/authorization.js";
import { AuthorizationError } from "../../../shared/errors/app-error.js";
import { auditAuthorizationDenied } from "../../../shared/observability/security-audit.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import type { RequestContextResolver, ValidatedClaims } from "../../identity/application/resolve-request-context.js";
import type { TenantQuotaService } from "../../identity/application/quota.js";
import type { ActivityService } from "../application/activity-service.js";

const LIST_ACTIVITY_SCHEMA_ID = "https://expiration-tracker/schemas/api/list-activity-request.v1.json";

export interface HttpRequest {
  requestId: string;
  correlationId: string;
  claims: ValidatedClaims;
  pathParameters?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
}

export interface HttpResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

export interface ActivityHttpDeps {
  resolver: RequestContextResolver;
  activity: ActivityService;
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

async function consumeApiRequestQuota(quota: TenantQuotaService, tenantId: string): Promise<void> {
  await quota.consume({ tenantId, quotaType: "API_REQUEST", window: "current", limit: 100, windowSeconds: 60 });
}

/** Builds the plain object handed to Ajv from raw (string | undefined) query params -
 * `additionalProperties:false` + omitted-when-undefined mirrors how every other schema in
 * this codebase treats "field absent" vs "field present but wrong shape". */
function buildQueryObject(qs: Record<string, string | undefined> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!qs) return out;
  for (const key of ["month", "resourceType", "limit", "cursor"] as const) {
    const value = qs[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export async function handleListActivity(deps: ActivityHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const queryObject = buildQueryObject(req.queryStringParameters);
    const { valid, errors } = defaultSchemaRegistry.validate(LIST_ACTIVITY_SCHEMA_ID, queryObject);
    if (!valid) {
      throw new ValidationError("Query parameters failed schema validation.", { errors });
    }
    const context = await deps.resolver.resolve({
      claims: req.claims,
      requestId: req.requestId,
      correlationId: req.correlationId,
      organizationIdHint: req.headers?.["x-organization-id"],
    });
    await consumeApiRequestQuota(deps.quota, context.tenant.tenantId);
    const page = await deps.activity.listActivity(context, {
      month: queryObject["month"],
      resourceType: queryObject["resourceType"],
      limit: queryObject["limit"] !== undefined ? Number(queryObject["limit"]) : undefined,
      cursor: queryObject["cursor"],
    });
    return { statusCode: 200, body: { entries: page.entries, cursor: page.cursor ?? null, hasMore: page.hasMore } };
  });
}
