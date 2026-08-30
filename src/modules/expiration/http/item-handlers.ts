/**
 * HTTP handlers for the Expiration module — mirrors identity's
 * http/test-route-handler.ts pipeline (resolve -> service, which internally calls
 * authorize()) and its AppError -> status-code mapping, so every route in the system
 * fails the same way.
 */
import { AppError, ValidationError, toAppError } from "../../../shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../identity/domain/authorization.js";
import { AuthorizationError } from "../../../shared/errors/app-error.js";
import { auditAuthorizationDenied } from "../../../shared/observability/security-audit.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import type { RequestContextResolver, ValidatedClaims } from "../../identity/application/resolve-request-context.js";
import type { RequestContext } from "../../identity/domain/request-context.js";
import type { TenantQuotaService } from "../../identity/application/quota.js";
import type { ExpirationService } from "../application/expiration-service.js";
import type { CreateItemInput, RenewItemInput, UpdateItemInput } from "../domain/expiration-item.js";

/**
 * full-audit round1/Seguranca criterio 9 (Resistencia a Abuso/DoS): TenantQuotaService
 * existia (M1) mas so era consumido por /test/ping - as rotas reais de negocio
 * (/items*) nao aplicavam nenhuma quota, permitindo um tenant autenticado gerar
 * leituras/escritas ilimitadas. Mesmo limite/janela do test-route-handler.ts
 * (100 req/60s) como ponto de partida - ajustavel por rota no futuro.
 */
async function consumeApiRequestQuota(quota: TenantQuotaService, context: RequestContext): Promise<void> {
  await quota.consume({
    tenantId: context.tenant.tenantId,
    quotaType: "API_REQUEST",
    window: "current",
    limit: 100,
    windowSeconds: 60,
  });
}

/**
 * full-audit round1/Seguranca criterio 5 ("Validacao de Entrada, Injection & Fail-Closed"):
 * a borda HTTP nao validava CreateItemInput/UpdateItemInput em runtime - so checava
 * presenca de req.body (linha `if (!req.body)` abaixo). TypeScript e apenas compile-time;
 * um chamador autenticado ainda podia mandar dueDate nao-ISO, tags sem limite, campos
 * extras etc. direto para o DynamoDB. Fail-closed real: rejeita 400 ANTES de tocar o
 * resolver/store quando o payload nao bate com o schema Ajv correspondente.
 */
function validateAgainstSchema(schemaId: string, body: unknown): void {
  const { valid, errors } = defaultSchemaRegistry.validate(schemaId, body);
  if (!valid) {
    throw new ValidationError("Request body failed schema validation.", { errors });
  }
}

const CREATE_ITEM_SCHEMA_ID = "https://expiration-tracker/schemas/api/create-item-request.v1.json";
const UPDATE_ITEM_SCHEMA_ID = "https://expiration-tracker/schemas/api/update-item-request.v1.json";
const RENEW_ITEM_SCHEMA_ID = "https://expiration-tracker/schemas/api/renew-item-request.v1.json";

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
      // Security audit trail (full-audit-round1-focused-round2-summary.md, achado real): a
      // negação real, não a excecao/resposta HTTP sozinha, agora produz um evento dedicado -
      // ver docs/architecture/reviews/security-audit-trail-design/.
      auditAuthorizationDenied({ reason: err.reason, action: err.action });
      return toResponse(new AuthorizationError(err.message, { reason: err.reason }));
    }
    const appError = err instanceof AppError ? err : toAppError(err);
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

const DASHBOARD_STATUSES = new Set(["ACTIVE", "ARCHIVED", "RENEWED", "DELETED"]);

function requireExpectedVersion(req: HttpRequest): number {
  const raw = req.headers?.["if-match"] ?? req.queryStringParameters?.["expectedVersion"];
  const version = Number(raw);
  // full-audit round1/Seguranca criterio 5 residual (Codex round2): Number() accepted
  // negative, fractional and Infinity values as a "valid" version - version is always a
  // positive integer (OCC counter, occ.ts), so only that shape is fail-closed here.
  if (!raw || Number.isNaN(version) || !Number.isInteger(version) || version < 1) {
    throw new ValidationError("Missing or invalid expected version (If-Match header).");
  }
  return version;
}

/** full-audit round1/Seguranca criterio 5 residual (Codex round2): the dashboard's
 * `status` query param was cast to the union type without validating it belongs to the
 * enum - a client could pass an arbitrary string that flows into gsi1Keys()'s GSI1PK. */
function requireDashboardStatus(req: HttpRequest): "ACTIVE" | "ARCHIVED" | "RENEWED" | "DELETED" {
  const raw = req.queryStringParameters?.["status"] ?? "ACTIVE";
  if (!DASHBOARD_STATUSES.has(raw)) {
    throw new ValidationError("Invalid status query parameter.", { allowed: [...DASHBOARD_STATUSES] });
  }
  return raw as "ACTIVE" | "ARCHIVED" | "RENEWED" | "DELETED";
}

export async function handleCreateItem(deps: ExpirationHttpDeps, req: HttpRequest<CreateItemInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(CREATE_ITEM_SCHEMA_ID, req.body);
    const idempotencyKey = req.headers?.["idempotency-key"];
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps.quota, context);
    const item = await deps.expiration.createItem(context, req.body, idempotencyKey);
    return { statusCode: 201, body: { item } };
  });
}

export async function handleGetItem(deps: ExpirationHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const itemId = requireItemId(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps.quota, context);
    const item = await deps.expiration.getItem(context, itemId);
    return { statusCode: 200, body: { item } };
  });
}

export async function handleUpdateItem(deps: ExpirationHttpDeps, req: HttpRequest<UpdateItemInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const itemId = requireItemId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(UPDATE_ITEM_SCHEMA_ID, req.body);
    const expectedVersion = requireExpectedVersion(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps.quota, context);
    const item = await deps.expiration.updateItem(context, itemId, req.body, expectedVersion);
    return { statusCode: 200, body: { item } };
  });
}

export async function handleArchiveItem(deps: ExpirationHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const itemId = requireItemId(req);
    const expectedVersion = requireExpectedVersion(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps.quota, context);
    await deps.expiration.archiveItem(context, itemId, expectedVersion);
    return { statusCode: 204, body: {} };
  });
}

export async function handleDeleteItem(deps: ExpirationHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const itemId = requireItemId(req);
    const expectedVersion = requireExpectedVersion(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps.quota, context);
    await deps.expiration.deleteItem(context, itemId, expectedVersion);
    return { statusCode: 204, body: {} };
  });
}

export async function handleRenewItem(deps: ExpirationHttpDeps, req: HttpRequest<RenewItemInput>): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const itemId = requireItemId(req);
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(RENEW_ITEM_SCHEMA_ID, req.body);
    const expectedVersion = requireExpectedVersion(req);
    const idempotencyKey = req.headers?.["idempotency-key"];
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps.quota, context);
    const { item, copiedReminderPolicyIds } = await deps.expiration.renewItem(context, itemId, req.body, expectedVersion, idempotencyKey);
    // reminder-delivery-pipeline.md §8 (Marcelo's decision, 2026-08-25): never a silent
    // copy - the caller/frontend gets an explicit, positive signal (never inferred from
    // absence) whenever a policy was carried over, so it can be surfaced as a "review your
    // reminders" notice rather than the user discovering it only much later.
    return { statusCode: 201, body: { item, copiedReminderPolicyIds } };
  });
}

export async function handleDashboard(deps: ExpirationHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const status = requireDashboardStatus(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps.quota, context);
    const items = await deps.expiration.listDashboard(context, { status });
    return { statusCode: 200, body: { items } };
  });
}
