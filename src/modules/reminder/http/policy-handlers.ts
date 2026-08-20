/** HTTP handlers for ReminderPolicy - mirrors expiration/http/item-handlers.ts's pipeline and error mapping exactly. */
import { AppError, ValidationError, toAppError, AuthorizationError } from "../../../shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../identity/domain/authorization.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import type { RequestContextResolver, ValidatedClaims } from "../../identity/application/resolve-request-context.js";
import type { RequestContext } from "../../identity/domain/request-context.js";
import type { TenantQuotaService } from "../../identity/application/quota.js";
import type { ReminderPolicyService } from "../application/reminder-policy-service.js";
import type { PutPolicyInput } from "../domain/reminder-policy.js";

/** full-audit round1/Seguranca criterio 9 - same gap and fix as item-handlers.ts:
 * TenantQuotaService existed but was only consumed by /test/ping. */
async function consumeApiRequestQuota(quota: TenantQuotaService, context: RequestContext): Promise<void> {
  await quota.consume({
    tenantId: context.tenant.tenantId,
    quotaType: "API_REQUEST",
    window: "current",
    limit: 100,
    windowSeconds: 60,
  });
}

/** full-audit round1/Seguranca criterio 5 - same fix as item-handlers.ts: HTTP body had no
 * runtime schema validation before this. */
function validateAgainstSchema(schemaId: string, body: unknown): void {
  const { valid, errors } = defaultSchemaRegistry.validate(schemaId, body);
  if (!valid) {
    throw new ValidationError("Request body failed schema validation.", { errors });
  }
}

const PUT_POLICY_SCHEMA_ID = "https://expiration-tracker/schemas/api/put-policy-request.v1.json";

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

export interface ReminderHttpDeps {
  resolver: RequestContextResolver;
  policies: ReminderPolicyService;
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
    const appError =
      err instanceof AuthorizationDeniedError
        ? new AuthorizationError(err.message, { reason: err.reason })
        : err instanceof AppError
          ? err
          : toAppError(err);
    return toResponse(appError);
  }
}

function requirePolicyId(req: HttpRequest): string {
  const policyId = req.pathParameters?.["policyId"];
  if (!policyId) throw new ValidationError("Missing policyId path parameter.");
  return policyId;
}

function requireExpectedVersion(req: HttpRequest): number {
  const raw = req.headers?.["if-match"];
  const version = Number(raw);
  if (!raw || Number.isNaN(version)) throw new ValidationError("Missing or invalid expected version (If-Match header).");
  return version;
}

export async function handleCreatePolicy(deps: ReminderHttpDeps, req: HttpRequest<PutPolicyInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(PUT_POLICY_SCHEMA_ID, req.body);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    await consumeApiRequestQuota(deps.quota, context);
    const policy = await deps.policies.createPolicy(context, req.body);
    return { statusCode: 201, body: { policy } };
  });
}

export async function handleGetPolicy(deps: ReminderHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const policyId = requirePolicyId(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    await consumeApiRequestQuota(deps.quota, context);
    const policy = await deps.policies.getPolicy(context, policyId);
    return { statusCode: 200, body: { policy } };
  });
}

export async function handleUpdatePolicy(deps: ReminderHttpDeps, req: HttpRequest<PutPolicyInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const policyId = requirePolicyId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(PUT_POLICY_SCHEMA_ID, req.body);
    const expectedVersion = requireExpectedVersion(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    await consumeApiRequestQuota(deps.quota, context);
    const policy = await deps.policies.updatePolicy(context, policyId, req.body, expectedVersion);
    return { statusCode: 200, body: { policy } };
  });
}

export async function handleDisablePolicy(deps: ReminderHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const policyId = requirePolicyId(req);
    const expectedVersion = requireExpectedVersion(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId });
    await consumeApiRequestQuota(deps.quota, context);
    await deps.policies.disablePolicy(context, policyId, expectedVersion);
    return { statusCode: 204, body: {} };
  });
}
