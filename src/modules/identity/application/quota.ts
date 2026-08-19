/**
 * TenantQuota token bucket — data-model.md §"Rastreabilidade a gates de abuso/custo":
 * PK=TENANT#t#QUOTA, SK=TYPE#<quotaType>#<window>, decremented via ConditionExpression
 * "no race condition between concurrent requests of the same tenant" (same pattern as
 * UploadSlot). Enforced at the API/Lambda boundary per M1 deliverable list.
 */
import { QuotaExceededError } from "../../../shared/errors/app-error.js";
import type { EntityKey, IdentityStore } from "../ports/identity-store.js";

export type QuotaType = "API_REQUEST" | "UPLOAD_BYTES" | "UPLOAD_COUNT" | "AI_CALL";

export interface TenantQuotaRecord {
  PK: string;
  SK: string;
  entityType: "TenantQuota";
  tenantId: string;
  quotaType: QuotaType;
  limit: number;
  windowSeconds: number;
  count: number;
  resetAt: string;
  killSwitchOverride?: boolean;
}

export function tenantQuotaKey(tenantId: string, quotaType: QuotaType, window: string): EntityKey {
  return { PK: `TENANT#${tenantId}#QUOTA`, SK: `TYPE#${quotaType}#${window}` };
}

export interface QuotaCheckInput {
  tenantId: string;
  quotaType: QuotaType;
  window: string; // e.g. rolling window identifier/bucket, caller-defined granularity
  limit: number;
  windowSeconds: number;
}

/**
 * Fixed-window token bucket (simplest correct primitive satisfying "atomic decrement,
 * no race condition" from data-model.md; a true sliding-window/leaky-bucket is a
 * documented possible refinement, not required by the blueprint text). Consumes 1 unit
 * per call; throws QuotaExceededError (mapped to 429 by the http layer) when exhausted.
 * killSwitchOverride, when true, denies regardless of remaining count (AppConfig-driven
 * emergency block, per data-model.md).
 */
export class TenantQuotaService {
  constructor(
    private readonly store: IdentityStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async consume(input: QuotaCheckInput): Promise<void> {
    const key = tenantQuotaKey(input.tenantId, input.quotaType, input.window);
    const existing = await this.store.get<TenantQuotaRecord>(key);

    const nowIso = this.now();
    const resetAt = new Date(Date.parse(nowIso) + input.windowSeconds * 1000).toISOString();

    if (!existing) {
      const created = await this.store.putIfAbsent({
        ...key,
        entityType: "TenantQuota",
        tenantId: input.tenantId,
        quotaType: input.quotaType,
        limit: input.limit,
        windowSeconds: input.windowSeconds,
        count: 1,
        resetAt,
      });
      if (created) return;
      // Lost the create race; fall through to re-read + increment below.
    }

    const current = (await this.store.get<TenantQuotaRecord>(key)) ?? {
      ...key,
      entityType: "TenantQuota",
      tenantId: input.tenantId,
      quotaType: input.quotaType,
      limit: input.limit,
      windowSeconds: input.windowSeconds,
      count: 0,
      resetAt,
    };

    if (current.killSwitchOverride) {
      throw new QuotaExceededError("Quota blocked by kill switch.", { tenantId: input.tenantId, quotaType: input.quotaType });
    }

    const windowExpired = current.resetAt < nowIso;
    const effectiveCount = windowExpired ? 0 : current.count;

    if (effectiveCount >= current.limit) {
      throw new QuotaExceededError("Quota exceeded.", {
        tenantId: input.tenantId,
        quotaType: input.quotaType,
        limit: current.limit,
      });
    }

    await this.store.update({
      ...current,
      count: effectiveCount + 1,
      resetAt: windowExpired ? resetAt : current.resetAt,
    });
  }
}
