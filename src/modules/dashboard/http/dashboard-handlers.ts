/**
 * HTTP handler for GET /dashboard/summary (Roadmap P0.6, fatia 1). Mirrors
 * activity/http/activity-handlers.ts's pipeline (resolve -> service, which internally calls
 * authorize()) and its AppError -> status-code mapping, so this route fails the same way as
 * every other route in the system. No query parameters — tenant-wide, unfiltered.
 */
import { AppError, toAppError } from "../../../shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../identity/domain/authorization.js";
import { AuthorizationError } from "../../../shared/errors/app-error.js";
import { auditAuthorizationDenied } from "../../../shared/observability/security-audit.js";
import type { RequestContextResolver, ValidatedClaims } from "../../identity/application/resolve-request-context.js";
import type { TenantQuotaService } from "../../identity/application/quota.js";
import type { DashboardService } from "../application/dashboard-service.js";

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

export interface DashboardHttpDeps {
  resolver: RequestContextResolver;
  dashboard: DashboardService;
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

export async function handleGetDashboardSummary(deps: DashboardHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const context = await deps.resolver.resolve({
      claims: req.claims,
      requestId: req.requestId,
      correlationId: req.correlationId,
      organizationIdHint: req.headers?.["x-organization-id"],
    });
    await consumeApiRequestQuota(deps.quota, context.tenant.tenantId);
    const summary = await deps.dashboard.getSummary(context);
    return { statusCode: 200, body: { summary } };
  });
}
