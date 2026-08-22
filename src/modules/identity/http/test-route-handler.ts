/**
 * Authenticated test route — the M1 exit criterion ("rota autenticada de teste").
 * API Gateway HTTP API (JWT authorizer) -> this Lambda. Exercises the full M1 chain for
 * every request: resolveRequestContext -> authorize -> quota -> handler body. Deliberately
 * trivial business logic (echo tenant/user) so the milestone's test surface is the
 * identity/authz/quota pipeline itself, not a real feature (that's M2).
 */
import { AppError, AuthorizationError, toAppError } from "../../../shared/errors/app-error.js";
import { authorize, AuthorizationDeniedError } from "../domain/authorization.js";
import { auditAuthorizationDenied } from "../../../shared/observability/security-audit.js";
import type { RequestContextResolver, ValidatedClaims } from "../application/resolve-request-context.js";
import type { TenantQuotaService } from "../application/quota.js";

export interface TestRouteHttpRequest {
  requestId: string;
  correlationId: string;
  claims: ValidatedClaims;
}

export interface TestRouteHttpResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

export interface TestRouteDeps {
  resolver: RequestContextResolver;
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

export async function handleTestRoute(deps: TestRouteDeps, req: TestRouteHttpRequest): Promise<TestRouteHttpResponse> {
  try {
    const context = await deps.resolver.resolve({
      claims: req.claims,
      requestId: req.requestId,
      correlationId: req.correlationId,
    });

    // Authorization matrix gate: every route declares its action before touching data.
    authorize({ context, action: "system:ping", resource: { tenantId: context.tenant.tenantId } });

    // Quota gate: enforced at the API/Lambda boundary, after authz, before any work.
    await deps.quota.consume({
      tenantId: context.tenant.tenantId,
      quotaType: "API_REQUEST",
      window: "current",
      limit: 100,
      windowSeconds: 60,
    });

    return {
      statusCode: 200,
      body: {
        ok: true,
        tenantId: context.tenant.tenantId,
        userId: context.principal.userId,
        requestId: context.requestId,
      },
    };
  } catch (err) {
    if (err instanceof AuthorizationDeniedError) {
      // Security audit trail (full-audit-round1-focused-round2-summary.md, achado real) - ver
      // docs/architecture/reviews/security-audit-trail-design/.
      auditAuthorizationDenied({ reason: err.reason, action: err.action });
      const appError = new AuthorizationError(err.message, { reason: err.reason });
      return { statusCode: STATUS_BY_CATEGORY[appError.category] ?? 500, body: appError.toJSON() };
    }
    const appError = err instanceof AppError ? err : toAppError(err);
    const status = STATUS_BY_CATEGORY[appError.category] ?? 500;
    return { statusCode: status, body: appError.toJSON() };
  }
}
