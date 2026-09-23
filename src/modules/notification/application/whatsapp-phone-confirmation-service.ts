/**
 * WhatsAppPhoneConfirmationService — see `domain/whatsapp-phone-confirmation.ts`'s header for the
 * full rationale (NEXT_SESSION_PROMPT.md item 26, 2026-09-23). Two entry points, mirroring the
 * shape of the Cognito e-mail flow (`bff-auth-service.ts`'s `confirmSignUp`/`resendConfirmationCode`)
 * without reusing it — Cognito has no notion of a phone number:
 *
 *  - `requestConfirmation`: generates a 6-digit code, persists only its hash, sends it over
 *    WhatsApp via `WhatsAppProviderAdapter.send()` directly (bypassing the reminder-delivery
 *    outbox/intent/attempt machinery entirely — that pipeline exists for scheduled, item-based
 *    reminder sends, not a synchronous transactional code). Gated on `isWhatsAppChannelEnabled()`,
 *    same flag `notification-router.ts` already uses to decide whether the channel is available at
 *    all — while it is off (true in every environment today, pending E-019), this fails loudly with
 *    a `DEPENDENCY_UNAVAILABLE` rather than silently pretending to send.
 *  - `confirmPhone`: verifies the code (`timingSafeEqual`, never a raw `===`) and, only on success,
 *    calls `WhatsAppOptInService.recordOptIn()` — the ONLY caller of `recordOptIn()` this program
 *    wires for a real end user, so a `WhatsAppOptIn` row now only ever exists post-confirmation.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "../../identity/domain/request-context.js";
import { authorize } from "../../identity/domain/authorization.js";
import { ValidationError, DependencyUnavailableError } from "../../../shared/errors/app-error.js";
import {
  buildWhatsAppPhoneConfirmation,
  generateWhatsAppConfirmationCode,
  isWhatsAppPhoneConfirmationExpired,
  isWhatsAppPhoneConfirmationInCooldown,
  whatsAppConfirmationCodeMatches,
  whatsAppPhoneConfirmationKey,
  WHATSAPP_PHONE_CONFIRMATION_MAX_ATTEMPTS,
  type WhatsAppPhoneConfirmation,
} from "../domain/whatsapp-phone-confirmation.js";
import type { WhatsAppOptIn } from "../domain/whatsapp-opt-in.js";
import type { WhatsAppOptInService } from "./whatsapp-opt-in-service.js";
import type { NotificationStore } from "../ports/notification-store.js";
import type { WhatsAppProviderAdapter } from "../ports/whatsapp-provider.js";

/** Same fixed catalog entry name/language convention as `renderWhatsAppTemplate()`
 * (`runtime/aws/composition/notification.ts`) - D-3: pre-provisioned in Meta Business Manager,
 * never created via the API by this repo. **Real send is unreachable until that template exists
 * AND `isWhatsAppChannelEnabled()` is true** - both independent of this code shipping. */
export const WHATSAPP_PHONE_CONFIRMATION_TEMPLATE_NAME = "phone_confirmation_code";
export const WHATSAPP_PHONE_CONFIRMATION_TEMPLATE_LANGUAGE = "pt_BR";

export interface WhatsAppPhoneConfirmationServiceDeps {
  store: NotificationStore;
  whatsAppOptIn: WhatsAppOptInService;
  whatsAppProvider: WhatsAppProviderAdapter;
  /** HMAC pepper — reuses `GUEST_TOKEN_PEPPER` at the composition root, same "no cross-family
   * confusion, a brand new Secrets Manager secret would be disproportionate" rationale
   * `organization.ts`'s `invitationTokenPepper` already documents for its own reuse. */
  pepper: string;
  /** Evaluated lazily, only when `requestConfirmation()` is actually called — never pre-checked
   * for every request this Lambda serves (`GET/PUT /notifications/preferences` have nothing to do
   * with WhatsApp). `Promise<boolean>` because the real implementation reads AppConfig. */
  isWhatsAppChannelEnabled: () => Promise<boolean>;
  now?: () => string;
  newId?: () => string;
}

export class WhatsAppPhoneConfirmationService {
  private readonly store: NotificationStore;
  private readonly whatsAppOptIn: WhatsAppOptInService;
  private readonly whatsAppProvider: WhatsAppProviderAdapter;
  private readonly pepper: string;
  private readonly isWhatsAppChannelEnabled: () => Promise<boolean>;
  private readonly now: () => string;
  private readonly newId: () => string;

  constructor(deps: WhatsAppPhoneConfirmationServiceDeps) {
    this.store = deps.store;
    this.whatsAppOptIn = deps.whatsAppOptIn;
    this.whatsAppProvider = deps.whatsAppProvider;
    this.pepper = deps.pepper;
    this.isWhatsAppChannelEnabled = deps.isWhatsAppChannelEnabled;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.newId = deps.newId ?? randomUUID;
  }

  /** Generates and sends a fresh 6-digit code, overwriting any previous unconsumed one for the
   * same tenant/user/phone (re-requesting is always allowed once the cooldown has passed - unlike
   * `WhatsAppOptIn`, this is a mutable, always-overwritable row by design). */
  async requestConfirmation(ctx: RequestContext, phoneE164: string): Promise<{ expiresAt: string }> {
    authorize({ context: ctx, action: "notification:configure", resource: { tenantId: ctx.tenant.tenantId } });

    if (!(await this.isWhatsAppChannelEnabled())) {
      throw new DependencyUnavailableError("Canal WhatsApp ainda não está disponível.", undefined, undefined, false);
    }

    const key = whatsAppPhoneConfirmationKey(ctx.tenant.tenantId, ctx.principal.userId, phoneE164);
    const existing = await this.store.get<WhatsAppPhoneConfirmation>(key, true);
    const now = this.now();
    if (existing && !existing.confirmedAt && isWhatsAppPhoneConfirmationInCooldown(existing, now)) {
      throw new ValidationError("Aguarde um minuto antes de solicitar um novo código.");
    }

    // buildWhatsAppPhoneConfirmation() validates the E.164 shape and throws before any I/O on a
    // bad value - same "fail before writing anything" discipline as buildWhatsAppOptIn().
    const code = generateWhatsAppConfirmationCode();
    const record = buildWhatsAppPhoneConfirmation({ tenantId: ctx.tenant.tenantId, userId: ctx.principal.userId, phoneE164, code, pepper: this.pepper, now });

    try {
      await this.whatsAppProvider.send({
        to: phoneE164,
        templateName: WHATSAPP_PHONE_CONFIRMATION_TEMPLATE_NAME,
        templateLanguage: WHATSAPP_PHONE_CONFIRMATION_TEMPLATE_LANGUAGE,
        templateParams: [code],
        // Opaque correlation tags only (`whatsapp-provider.ts`'s own contract) - this send has no
        // real NotificationIntent/Attempt behind it, so these ids exist solely to satisfy the
        // port's shape and correlate a later webhook, never read back by this service.
        tags: { attemptId: this.newId(), intentId: this.newId(), tenantId: ctx.tenant.tenantId, correlationId: ctx.correlationId },
      });
    } catch (err) {
      throw new DependencyUnavailableError("Não foi possível enviar o código de confirmação pelo WhatsApp.", undefined, err);
    }

    // Overwrite, never putIfAbsent - re-requesting a code for the same phone must always succeed
    // once the cooldown has passed, unlike WhatsAppOptIn's create-once semantics.
    await this.store.update(record);
    return { expiresAt: record.expiresAt };
  }

  /**
   * Verifies the code and, only on success, records the opt-in. Idempotent: a second call after
   * the confirmation already succeeded returns the existing `WhatsAppOptIn` again rather than
   * failing, mirroring `confirmSignUp`'s own `ALREADY_CONFIRMED` no-op posture.
   */
  async confirmPhone(ctx: RequestContext, phoneE164: string, code: string): Promise<WhatsAppOptIn> {
    authorize({ context: ctx, action: "notification:configure", resource: { tenantId: ctx.tenant.tenantId } });

    const key = whatsAppPhoneConfirmationKey(ctx.tenant.tenantId, ctx.principal.userId, phoneE164);
    const existing = await this.store.get<WhatsAppPhoneConfirmation>(key, true);
    if (!existing) {
      throw new ValidationError("Código inválido ou expirado.");
    }
    if (existing.confirmedAt) {
      return this.whatsAppOptIn.recordOptIn(ctx, phoneE164, "USER_SETTINGS");
    }

    const now = this.now();
    if (isWhatsAppPhoneConfirmationExpired(existing, now) || existing.attemptCount >= WHATSAPP_PHONE_CONFIRMATION_MAX_ATTEMPTS) {
      throw new ValidationError("Código inválido ou expirado.");
    }

    const matches = whatsAppConfirmationCodeMatches(this.pepper, code, existing.codeHash);
    if (!matches) {
      await this.store.update({ ...existing, attemptCount: existing.attemptCount + 1 });
      throw new ValidationError("Código inválido ou expirado.");
    }

    await this.store.update({ ...existing, confirmedAt: now });
    return this.whatsAppOptIn.recordOptIn(ctx, phoneE164, "USER_SETTINGS");
  }
}
