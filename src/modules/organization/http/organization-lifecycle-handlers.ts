/**
 * HTTP handler for W3-07's organization closure (D-124, implementing D-121) — the single real
 * trigger surface for tenant deletion. Same pipeline and error-mapping convention as
 * `membership-handlers.ts`/`organization-settings-handlers.ts` (resolve -> service, which
 * internally calls `authorize()`), in its own file because closing the organization is a distinct
 * concern from both membership management and settings.
 *
 * The typed confirmation lives in the request body, not just the UI. A destructive, irreversible
 * action must not be triggerable by a bare POST that a mis-wired client (or a curious caller
 * poking the API directly) could issue by accident — the client-side confirm dialog is a
 * convenience, and the backend is the actual authority here, same posture as RBAC.
 */
import { AppError, ValidationError, toAppError } from "../../../shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../identity/domain/authorization.js";
import { AuthorizationError } from "../../../shared/errors/app-error.js";
import { auditAuthorizationDenied } from "../../../shared/observability/security-audit.js";
import type { RequestContextResolver, ValidatedClaims } from "../../identity/application/resolve-request-context.js";
import type { CloseOrganizationService } from "../application/close-organization.js";
import type { CancelOrganizationClosureService } from "../application/cancel-organization-closure.js";

export interface HttpRequest<TBody = unknown> {
  requestId: string;
  correlationId: string;
  claims: ValidatedClaims;
  headers?: Record<string, string | undefined>;
  body?: TBody;
}

export interface HttpResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

export interface OrganizationLifecycleHttpDeps {
  resolver: RequestContextResolver;
  closeOrganization: CloseOrganizationService;
  /** D-127. Optional so every existing call site of this interface keeps compiling; the cancel
   * route is simply unreachable (like `closeOrganization` above) when absent. */
  cancelOrganizationClosure?: CancelOrganizationClosureService;
}

export interface CloseOrganizationRequest {
  /** Must equal the organization's own id exactly — the type-to-confirm token. */
  confirmOrganizationId?: string;
}

export interface CancelOrganizationClosureRequest {
  /** Must equal the organization's own id exactly — same type-to-confirm convention as close. */
  confirmOrganizationId?: string;
}

const STATUS_BY_CATEGORY: Record<string, number> = {
  VALIDATION: 400,
  AUTH: 401,
  AUTHORIZATION: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  QUOTA_EXCEEDED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
  BUSINESS_RULE: 422,
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

export async function handleCloseOrganization(deps: OrganizationLifecycleHttpDeps, req: HttpRequest<CloseOrganizationRequest>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });

    // Compared against the RESOLVED tenantId, never against anything else the client sent - the
    // confirmation proves intent about the organization the caller is actually authenticated
    // into, so a stale browser tab pointed at a different org cannot close this one.
    if (req.body?.confirmOrganizationId !== context.tenant.tenantId) {
      throw new ValidationError("confirmOrganizationId must match the current organization id to confirm closure.");
    }

    const result = await deps.closeOrganization.close(context);
    return { statusCode: 202, body: { organizationId: result.tenantId, status: result.status } };
  });
}

/**
 * D-127: HTTP handler for cancelling an in-progress closure. Deliberately does NOT call
 * `deps.resolver.resolve()` — that is the whole point of `CancelOrganizationClosureService`'s own
 * identity-resolution path (see that file's header): a `HELD_FOR_RECOVERY` tenant cannot resolve
 * through the normal ACTIVE-only pipeline. `tenantId` therefore comes from the same
 * `X-Organization-Id` header every other BFF-derived hint uses (D-101), not from a resolved
 * `RequestContext.tenant.tenantId` — there is no resolved context on this path.
 */
export async function handleCancelOrganizationClosure(deps: OrganizationLifecycleHttpDeps, req: HttpRequest<CancelOrganizationClosureRequest>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!deps.cancelOrganizationClosure) {
      throw new ValidationError("Organization closure cancellation is not available.");
    }
    const tenantId = req.headers?.["x-organization-id"];
    if (!tenantId) {
      throw new ValidationError("X-Organization-Id header is required.");
    }
    if (req.body?.confirmOrganizationId !== tenantId) {
      throw new ValidationError("confirmOrganizationId must match the X-Organization-Id header to confirm cancellation.");
    }

    const result = await deps.cancelOrganizationClosure.cancel({ cognitoSub: req.claims.sub, tenantId });
    return { statusCode: 200, body: { organizationId: result.tenantId, status: result.status } };
  });
}
