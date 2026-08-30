/**
 * HTTP handler for Wave B2B-10 (Tenant-aware Frontend, "settings" scope item) — updating
 * `Organization.displayName`/`timezone`. Same pipeline/error-mapping convention as
 * `membership-handlers.ts` (resolve -> service, which internally calls `authorize()`), kept in
 * its own file since it is a distinct concern from membership management, not a
 * `MembershipHttpDeps` addition.
 */
import { AppError, ValidationError, toAppError } from "../../../shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../identity/domain/authorization.js";
import { AuthorizationError } from "../../../shared/errors/app-error.js";
import { auditAuthorizationDenied } from "../../../shared/observability/security-audit.js";
import type { RequestContextResolver, ValidatedClaims } from "../../identity/application/resolve-request-context.js";
import type { UpdateOrganizationSettingsInput, UpdateOrganizationSettingsService } from "../application/update-organization-settings.js";

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

export interface OrganizationSettingsHttpDeps {
  resolver: RequestContextResolver;
  updateSettings: UpdateOrganizationSettingsService;
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

function requireExpectedVersion(req: HttpRequest): number {
  const raw = req.headers?.["if-match"];
  const version = Number(raw);
  if (!raw || Number.isNaN(version) || !Number.isInteger(version) || version < 1) {
    throw new ValidationError("Missing or invalid expected version (If-Match header).");
  }
  return version;
}

export async function handleUpdateOrganizationSettings(deps: OrganizationSettingsHttpDeps, req: HttpRequest<UpdateOrganizationSettingsInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    const expectedVersion = requireExpectedVersion(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    const organization = await deps.updateSettings.update(context, req.body, expectedVersion);
    return { statusCode: 200, body: { organizationId: organization.organizationId, displayName: organization.displayName, timezone: organization.timezone, version: organization.version } };
  });
}
