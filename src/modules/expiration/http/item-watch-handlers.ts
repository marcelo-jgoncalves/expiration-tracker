/** HTTP handlers para /items/{itemId}/watchers* — mesmo pipeline de item-handlers.ts. */
import { AppError, ValidationError, toAppError } from "../../../shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../identity/domain/authorization.js";
import { AuthorizationError } from "../../../shared/errors/app-error.js";
import { auditAuthorizationDenied } from "../../../shared/observability/security-audit.js";
import type { RequestContextResolver, ValidatedClaims } from "../../identity/application/resolve-request-context.js";
import type { TenantQuotaService } from "../../identity/application/quota.js";
import type { ItemWatchService } from "../application/item-watch-service.js";

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

export interface ItemWatchHttpDeps {
  resolver: RequestContextResolver;
  watches: ItemWatchService;
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

function requireItemId(req: HttpRequest): string {
  const itemId = req.pathParameters?.["itemId"];
  if (!itemId) throw new ValidationError("Missing itemId path parameter.");
  return itemId;
}

function requireUserId(req: HttpRequest): string {
  const userId = req.pathParameters?.["userId"];
  if (!userId) throw new ValidationError("Missing userId path parameter.");
  return userId;
}

async function consumeApiRequestQuota(deps: ItemWatchHttpDeps, context: import("../../identity/domain/request-context.js").RequestContext): Promise<void> {
  await deps.quota.consume({ tenantId: context.tenant.tenantId, quotaType: "API_REQUEST", window: "current", limit: 100, windowSeconds: 60 });
}

export async function handleAddWatcher(deps: ItemWatchHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const itemId = requireItemId(req);
    const userId = requireUserId(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps, context);
    const watch = await deps.watches.addWatcher(context, itemId, userId);
    return { statusCode: 201, body: { watch } };
  });
}

export async function handleRemoveWatcher(deps: ItemWatchHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const itemId = requireItemId(req);
    const userId = requireUserId(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps, context);
    await deps.watches.removeWatcher(context, itemId, userId);
    return { statusCode: 204, body: {} };
  });
}

export async function handleListWatchers(deps: ItemWatchHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const itemId = requireItemId(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps, context);
    const watchers = await deps.watches.listWatchers(context, itemId);
    return { statusCode: 200, body: { watchers } };
  });
}
