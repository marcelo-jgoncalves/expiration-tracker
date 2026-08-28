/** HTTP handlers for UserProfile.requesterDisplayName (W5-01/GTR-01, D-060) - mirrors
 * notification/http/preferences-handlers.ts's pipeline and error mapping exactly. */
import { AppError, ValidationError, toAppError, AuthorizationError } from "../../../shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../domain/authorization.js";
import { auditAuthorizationDenied } from "../../../shared/observability/security-audit.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import type { RequestContextResolver, ValidatedClaims } from "../application/resolve-request-context.js";
import type { TenantQuotaService } from "../application/quota.js";
import type { RequestContext } from "../domain/request-context.js";
import type { ProfileService } from "../application/profile-service.js";

async function consumeApiRequestQuota(quota: TenantQuotaService, context: RequestContext): Promise<void> {
  await quota.consume({
    tenantId: context.tenant.tenantId,
    quotaType: "API_REQUEST",
    window: "current",
    limit: 100,
    windowSeconds: 60,
  });
}

function validateAgainstSchema(schemaId: string, body: unknown): void {
  const { valid, errors } = defaultSchemaRegistry.validate(schemaId, body);
  if (!valid) {
    throw new ValidationError("Request body failed schema validation.", { errors });
  }
}

const UPDATE_PROFILE_SCHEMA_ID = "https://expiration-tracker/schemas/api/update-profile-request.v1.json";

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

export interface ProfileHttpDeps {
  resolver: RequestContextResolver;
  profiles: ProfileService;
  quota: TenantQuotaService;
}

export interface UpdateProfileRequestBody {
  requesterDisplayName: string | null;
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

/** GET /profile - always returns 200 with the caller's own profile. Never a path parameter:
 * the resource is always "the calling user's own", same convention as GET /notifications/preferences. */
export async function handleGetProfile(deps: ProfileHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    await consumeApiRequestQuota(deps.quota, context);
    const profile = await deps.profiles.getProfile(context);
    return { statusCode: 200, body: { profile: { requesterDisplayName: profile.requesterDisplayName ?? null } } };
  });
}

export async function handleUpdateProfile(deps: ProfileHttpDeps, req: HttpRequest<UpdateProfileRequestBody>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(UPDATE_PROFILE_SCHEMA_ID, req.body);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    await consumeApiRequestQuota(deps.quota, context);
    const profile = await deps.profiles.setRequesterDisplayName(context, req.body.requesterDisplayName ?? undefined);
    return { statusCode: 200, body: { profile: { requesterDisplayName: profile.requesterDisplayName ?? null } } };
  });
}
