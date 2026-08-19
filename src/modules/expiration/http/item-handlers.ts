/**
 * HTTP handlers for the Expiration module — mirrors identity's
 * http/test-route-handler.ts pipeline (resolve -> service, which internally calls
 * authorize()) and its AppError -> status-code mapping, so every route in the system
 * fails the same way.
 */
import { AppError, ValidationError, toAppError } from "../../../shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../identity/domain/authorization.js";
import { AuthorizationError } from "../../../shared/errors/app-error.js";
import type { RequestContextResolver, ValidatedClaims } from "../../identity/application/resolve-request-context.js";
import type { ExpirationService } from "../application/expiration-service.js";
import type { CreateItemInput, RenewItemInput, UpdateItemInput } from "../domain/expiration-item.js";

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

export interface ExpirationHttpDeps {
  resolver: RequestContextResolver;
  expiration: ExpirationService;
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
    const appError =
      err instanceof AuthorizationDeniedError
        ? new AuthorizationError(err.message, { reason: err.reason })
        : err instanceof AppError
          ? err
          : toAppError(err);
    return toResponse(appError);
  }
}

function requireItemId(req: HttpRequest): string {
  const itemId = req.pathParameters?.["itemId"];
  if (!itemId) {
    throw new ValidationError("Missing itemId path parameter.");
  }
  return itemId;
}

function requireExpectedVersion(req: HttpRequest): number {
  const raw = req.headers?.["if-match"] ?? req.queryStringParameters?.["expectedVersion"];
  const version = Number(raw);
  if (!raw || Number.isNaN(version)) {
    throw new ValidationError("Missing or invalid expected version (If-Match header).");
  }
  return version;
}

export async function handleCreateItem(deps: ExpirationHttpDeps, req: HttpRequest<CreateItemInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    const item = await deps.expiration.createItem(context, req.body);
    return { statusCode: 201, body: { item } };
  });
}

export async function handleGetItem(deps: ExpirationHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const itemId = requireItemId(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    const item = await deps.expiration.getItem(context, itemId);
    return { statusCode: 200, body: { item } };
  });
}

export async function handleUpdateItem(deps: ExpirationHttpDeps, req: HttpRequest<UpdateItemInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const itemId = requireItemId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    const expectedVersion = requireExpectedVersion(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    const item = await deps.expiration.updateItem(context, itemId, req.body, expectedVersion);
    return { statusCode: 200, body: { item } };
  });
}

export async function handleArchiveItem(deps: ExpirationHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const itemId = requireItemId(req);
    const expectedVersion = requireExpectedVersion(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    await deps.expiration.archiveItem(context, itemId, expectedVersion);
    return { statusCode: 204, body: {} };
  });
}

export async function handleDeleteItem(deps: ExpirationHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const itemId = requireItemId(req);
    const expectedVersion = requireExpectedVersion(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    await deps.expiration.deleteItem(context, itemId, expectedVersion);
    return { statusCode: 204, body: {} };
  });
}

export async function handleRenewItem(deps: ExpirationHttpDeps, req: HttpRequest<RenewItemInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const itemId = requireItemId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    const expectedVersion = requireExpectedVersion(req);
    const idempotencyKey = req.headers?.["idempotency-key"];
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    const item = await deps.expiration.renewItem(context, itemId, req.body, expectedVersion, idempotencyKey);
    return { statusCode: 201, body: { item } };
  });
}

export async function handleDashboard(deps: ExpirationHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const status = (req.queryStringParameters?.["status"] ?? "ACTIVE") as "ACTIVE" | "ARCHIVED" | "RENEWED" | "DELETED";
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    const items = await deps.expiration.listDashboard(context, { status });
    return { statusCode: 200, body: { items } };
  });
}
