/** HTTP handlers for NotificationPreferences - mirrors reminder/http/policy-handlers.ts's
 * pipeline and error mapping exactly. */
import { AppError, ValidationError, toAppError, AuthorizationError } from "../../../shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../identity/domain/authorization.js";
import { auditAuthorizationDenied } from "../../../shared/observability/security-audit.js";
import { defaultSchemaRegistry } from "../../../shared/contracts/schema-validator.js";
import type { RequestContextResolver, ValidatedClaims } from "../../identity/application/resolve-request-context.js";
import type { TenantQuotaService } from "../../identity/application/quota.js";
import type { RequestContext } from "../../identity/domain/request-context.js";
import type { NotificationPreferencesService, UpdateNotificationPreferencesInput } from "../application/notification-preferences-service.js";
import type { WhatsAppOptInService } from "../application/whatsapp-opt-in-service.js";
import type { WhatsAppOptInSource } from "../domain/whatsapp-opt-in.js";
import type { WhatsAppPhoneConfirmationService } from "../application/whatsapp-phone-confirmation-service.js";

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

const UPDATE_PREFERENCES_SCHEMA_ID = "https://expiration-tracker/schemas/api/update-notification-preferences-request.v1.json";
const WHATSAPP_OPT_IN_SCHEMA_ID = "https://expiration-tracker/schemas/api/whatsapp-opt-in-request.v1.json";
const WHATSAPP_PHONE_CONFIRMATION_START_SCHEMA_ID = "https://expiration-tracker/schemas/api/whatsapp-phone-confirmation-start-request.v1.json";
const WHATSAPP_PHONE_CONFIRMATION_CONFIRM_SCHEMA_ID = "https://expiration-tracker/schemas/api/whatsapp-phone-confirmation-confirm-request.v1.json";

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

export interface NotificationHttpDeps {
  resolver: RequestContextResolver;
  preferences: NotificationPreferencesService;
  quota: TenantQuotaService;
  whatsAppOptIn: WhatsAppOptInService;
  whatsAppPhoneConfirmation: WhatsAppPhoneConfirmationService;
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
      // Security audit trail (full-audit-round1-focused-round2-summary.md, achado real) - ver
      // docs/architecture/reviews/security-audit-trail-design/.
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

/** GET /notifications/preferences - always returns 200 with the caller's own preferences,
 * lazily creating them with the documented default if this is the first time (see
 * notification-preferences-service.ts's own comment on why - onboarding never wires this
 * today). Never a path parameter: the resource is always "the calling user's own", not an
 * arbitrary id. */
export async function handleGetPreferences(deps: NotificationHttpDeps, req: HttpRequest): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps.quota, context);
    const preferences = await deps.preferences.getOrCreatePreferences(context);
    return { statusCode: 200, body: { preferences } };
  });
}

export async function handleUpdatePreferences(
  deps: NotificationHttpDeps,
  req: HttpRequest<UpdateNotificationPreferencesInput>,
): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(UPDATE_PREFERENCES_SCHEMA_ID, req.body);
    const expectedVersion = requireExpectedVersion(req);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps.quota, context);
    const preferences = await deps.preferences.updatePreferences(context, req.body, expectedVersion);
    return { statusCode: 200, body: { preferences } };
  });
}

/** POST /notifications/whatsapp-opt-in — D-246 (WhatsApp roadmap item, fatia de engenharia
 * 100% fechada desde D-246, mas sem rota HTTP para `WhatsAppOptInService.recordOptIn()` até
 * agora — nenhum usuário real conseguia dar opt-in mesmo com todo o resto pronto). Create-once,
 * same idempotent-no-op semantics as the service itself (`recordOptIn()`'s own doc comment) —
 * always 201, whether this call created the row or found an existing one for the exact same
 * phone, mirroring `handleStartGuestSession`'s "the caller only needs the resulting state, not
 * whether it existed before" posture used elsewhere in this codebase. No `If-Match`/expected
 * version — unlike `handleUpdatePreferences`, this never mutates an existing row (a phone
 * change is a NEW row by construction, `whatsapp-opt-in.ts`'s own header), so there is no
 * concurrent-edit race to fence against. */
export async function handleRecordWhatsAppOptIn(
  deps: NotificationHttpDeps,
  req: HttpRequest<{ phoneE164: string; source: WhatsAppOptInSource }>,
): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(WHATSAPP_OPT_IN_SCHEMA_ID, req.body);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps.quota, context);
    const optIn = await deps.whatsAppOptIn.recordOptIn(context, req.body.phoneE164, req.body.source);
    return { statusCode: 201, body: { optIn } };
  });
}

/** POST /notifications/whatsapp-opt-in/request-confirmation — item 26 (NEXT_SESSION_PROMPT.md,
 * 2026-09-23): sends a 6-digit code to `phoneE164` over WhatsApp
 * (`WhatsAppPhoneConfirmationService.requestConfirmation()`). Never returns the code itself, only
 * `expiresAt` — same "the caller only needs the resulting state" posture as
 * `handleRecordWhatsAppOptIn`. Fails loudly (503) while the WhatsApp channel flag is off, which is
 * the real state of every environment today pending E-019. */
export async function handleRequestWhatsAppPhoneConfirmation(
  deps: NotificationHttpDeps,
  req: HttpRequest<{ phoneE164: string }>,
): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(WHATSAPP_PHONE_CONFIRMATION_START_SCHEMA_ID, req.body);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps.quota, context);
    const result = await deps.whatsAppPhoneConfirmation.requestConfirmation(context, req.body.phoneE164);
    return { statusCode: 202, body: result };
  });
}

/** POST /notifications/whatsapp-opt-in/confirm — verifies the code sent by the route above and,
 * only on success, calls `WhatsAppOptInService.recordOptIn()` internally
 * (`WhatsAppPhoneConfirmationService.confirmPhone()`). This is now the ONLY real path that creates
 * a `WhatsAppOptIn` row for an end user — `handleRecordWhatsAppOptIn` above stays wired (idempotent,
 * harmless) but is no longer called by the frontend post-2026-09-23. */
export async function handleConfirmWhatsAppPhoneConfirmation(
  deps: NotificationHttpDeps,
  req: HttpRequest<{ phoneE164: string; code: string }>,
): Promise<HttpResponse> {
  return withErrorMapping(async () => {
    if (!req.body) throw new ValidationError("Missing request body.");
    validateAgainstSchema(WHATSAPP_PHONE_CONFIRMATION_CONFIRM_SCHEMA_ID, req.body);
    const context = await deps.resolver.resolve({ claims: req.claims, requestId: req.requestId, correlationId: req.correlationId, organizationIdHint: req.headers?.["x-organization-id"] });
    await consumeApiRequestQuota(deps.quota, context);
    const optIn = await deps.whatsAppPhoneConfirmation.confirmPhone(context, req.body.phoneE164, req.body.code);
    return { statusCode: 200, body: { optIn } };
  });
}
