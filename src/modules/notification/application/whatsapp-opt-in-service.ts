/**
 * WhatsAppOptInService — fatia 1 of the WhatsApp program (D-5, `docs/architecture/reviews/
 * whatsapp-channel-scoping/estado-final-consolidado.md`). Deliberately NOT wired to any HTTP
 * route yet (`estado-final-consolidado.md` "próxima ação real": fatia 1 is domain+entities
 * only) — this service exists so the entity's create-once invariant is exercised by real
 * application-layer code (and G-V3-tested) rather than only asserted at the domain-builder
 * level. A future fatia adds the route that calls `recordOptIn()`; this class does not change
 * shape when that happens; it just gains a caller.
 *
 * `authorize()` uses the same action name pattern as `NotificationPreferencesService`
 * (`notification:configure` — a user managing their OWN channel consent, not an admin action).
 */
import type { RequestContext } from "../../identity/domain/request-context.js";
import { authorize } from "../../identity/domain/authorization.js";
import { buildWhatsAppOptIn, whatsAppOptInKey, type WhatsAppOptIn, type WhatsAppOptInSource } from "../domain/whatsapp-opt-in.js";
import type { NotificationStore } from "../ports/notification-store.js";

export interface WhatsAppOptInServiceDeps {
  store: NotificationStore;
  now?: () => string;
}

export class WhatsAppOptInService {
  private readonly store: NotificationStore;
  private readonly now: () => string;

  constructor(deps: WhatsAppOptInServiceDeps) {
    this.store = deps.store;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  /**
   * Create-once (`putIfAbsent`): opting in twice for the same tenant/user/phone is an idempotent
   * no-op that returns the ORIGINAL record (never overwrites `optedInAt` with a later call's
   * timestamp — consent provenance is "when this exact opt-in was first granted", not "when it
   * was last confirmed"). A phone number change is a different SK entirely (see
   * `whatsapp-opt-in.ts` header) — this method never migrates or deletes a prior number's row;
   * a stale opt-in for a superseded number is simply never read again once
   * `GlobalUser.phoneE164` moves on, by construction of how a future reader would key its
   * lookup (fatia 2+, not built yet).
   */
  async recordOptIn(ctx: RequestContext, phoneE164: string, source: WhatsAppOptInSource): Promise<WhatsAppOptIn> {
    authorize({ context: ctx, action: "notification:configure", resource: { tenantId: ctx.tenant.tenantId } });

    // buildWhatsAppOptIn() validates the E.164 shape and throws before any I/O on a bad value.
    const candidate = buildWhatsAppOptIn({
      tenantId: ctx.tenant.tenantId,
      userId: ctx.principal.userId,
      phoneE164,
      source,
      now: this.now(),
    });

    const wasCreated = await this.store.putIfAbsent(candidate);
    if (wasCreated) return candidate;

    const key = whatsAppOptInKey(ctx.tenant.tenantId, ctx.principal.userId, phoneE164);
    const existing = await this.store.get<WhatsAppOptIn>(key, true);
    if (!existing) throw new Error("WhatsAppOptIn disappeared immediately after a lost create race.");
    return existing;
  }
}
