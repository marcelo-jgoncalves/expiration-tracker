/**
 * NotificationPreferencesService — real backlog item closed (NEXT_SESSION_PROMPT.md M4
 * pendency: "rota HTTP de preferências... o runtime depende de NotificationPreferences
 * existir (via onboarding), mas não há endpoint para o usuário editar depois"). Mirrors
 * ReminderPolicyService's shape: authorize() (action `notification:configure`, already in
 * the M1 authorization matrix - ADMIN_ROLES-gated, which is a no-op restriction under the
 * current MVP model where tenantId=userId/single-owner tenants, per authorization.ts:36),
 * OCC via shared/dynamodb/occ.ts.
 *
 * `defaultNotificationPreferences()` (notification-preferences.ts) was previously never
 * called anywhere in src/ - onboarding wiring for it is still a documented gap, not real
 * code. getOrCreatePreferences() below is the pragmatic bridge until that onboarding step
 * exists: a GET lazily creates the record with its documented default (emailEnabled: true,
 * consentSource: "ONBOARDING") instead of 404-ing on every user who predates or bypasses
 * that step - never silently treats a missing record as "no consent" (that's the router's
 * own fail-closed matrix's job, not this service's).
 */
import type { RequestContext } from "../../identity/domain/request-context.js";
import { authorize } from "../../identity/domain/authorization.js";
import { ConflictError } from "../../../shared/errors/app-error.js";
import { buildVersionedUpdate, isConditionalCheckFailed } from "../../../shared/dynamodb/occ.js";
import {
  notificationPreferencesKey,
  defaultNotificationPreferences,
  type NotificationPreferences,
} from "../domain/notification-preferences.js";
import { isTransactionCanceled, type NotificationStore } from "../ports/notification-store.js";

export interface UpdateNotificationPreferencesInput {
  emailEnabled: boolean;
  locale: string;
  quietHours: NotificationPreferences["quietHours"];
}

export interface NotificationPreferencesServiceDeps {
  store: NotificationStore;
  tableName: string;
  now?: () => string;
}

export class NotificationPreferencesService {
  private readonly store: NotificationStore;
  private readonly tableName: string;
  private readonly now: () => string;

  constructor(deps: NotificationPreferencesServiceDeps) {
    this.store = deps.store;
    this.tableName = deps.tableName;
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  async getOrCreatePreferences(ctx: RequestContext): Promise<NotificationPreferences> {
    authorize({ context: ctx, action: "notification:configure", resource: { tenantId: ctx.tenant.tenantId } });

    const key = notificationPreferencesKey(ctx.tenant.tenantId, ctx.principal.userId);
    const existing = await this.store.get<NotificationPreferences>(key, true);
    if (existing) return existing;

    const created = defaultNotificationPreferences({
      tenantId: ctx.tenant.tenantId,
      userId: ctx.principal.userId,
      locale: "pt-BR",
      now: this.now(),
    });
    const wasCreated = await this.store.putIfAbsent(created);
    if (wasCreated) return created;

    // Lost the create race to a concurrent request - the record exists now, read it.
    const record = await this.store.get<NotificationPreferences>(key, true);
    if (!record) throw new Error("NotificationPreferences disappeared immediately after a lost create race.");
    return record;
  }

  async updatePreferences(
    ctx: RequestContext,
    input: UpdateNotificationPreferencesInput,
    expectedVersion: number,
  ): Promise<NotificationPreferences> {
    // Same bridge as getOrCreatePreferences() - an update is also a legitimate way to
    // establish the record for a user whose onboarding never ran this step, per this
    // service's own documented judgment call above.
    const current = await this.getOrCreatePreferences(ctx);

    const set: Record<string, unknown> = {
      emailEnabled: input.emailEnabled,
      locale: input.locale,
      quietHours: input.quietHours,
      consentSource: "USER_SETTINGS",
    };

    try {
      await this.store.transactWrite([
        {
          Update: buildVersionedUpdate({
            tableName: this.tableName,
            key: notificationPreferencesKey(current.tenantId, current.userId),
            tenantId: current.tenantId,
            expectedVersion,
            set,
          }),
        },
      ]);
    } catch (err) {
      if (isTransactionCanceled(err) || isConditionalCheckFailed(err)) {
        throw new ConflictError("VERSION_CONFLICT", { userId: current.userId });
      }
      throw err;
    }

    return { ...current, ...(set as Partial<NotificationPreferences>), version: expectedVersion + 1, updatedAt: this.now() };
  }
}
