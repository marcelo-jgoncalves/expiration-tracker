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

  /**
   * Bounded retry count for the read-check-conditionalWrite loop below (full audit round1,
   * eixo Governança de Produto, critério 3 — the previous unconditional `store.update` allowed
   * lost updates between two concurrent `consume` calls for the same tenant/quotaType: both
   * could read the same `count`, both compute `count+1`, and the second overwrite would
   * silently discard the first increment, letting a tenant exceed its quota). 20 attempts
   * covers a burst of simultaneous requests against the same partition key without needing
   * backoff/jitter for this fixed-window primitive's expected contention level; exhausting it
   * means genuine sustained hot contention, not a normal path.
   */
  private static readonly MAX_CONTENTION_RETRIES = 20;

  async consume(input: QuotaCheckInput): Promise<void> {
    for (let attempt = 0; attempt < TenantQuotaService.MAX_CONTENTION_RETRIES; attempt++) {
      const key = tenantQuotaKey(input.tenantId, input.quotaType, input.window);
      const nowIso = this.now();
      const resetAt = new Date(Date.parse(nowIso) + input.windowSeconds * 1000).toISOString();

      const existing = await this.store.get<TenantQuotaRecord>(key);
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
        // Lost the create race; loop to re-read the record another caller just created.
        continue;
      }

      if (existing.killSwitchOverride) {
        throw new QuotaExceededError("Quota blocked by kill switch.", { tenantId: input.tenantId, quotaType: input.quotaType });
      }

      const windowExpired = existing.resetAt < nowIso;
      const effectiveCount = windowExpired ? 0 : existing.count;

      if (effectiveCount >= existing.limit) {
        throw new QuotaExceededError("Quota exceeded.", {
          tenantId: input.tenantId,
          quotaType: input.quotaType,
          limit: existing.limit,
        });
      }

      const nextResetAt = windowExpired ? resetAt : existing.resetAt;
      const wrote = await this.store.updateConditional(
        { ...existing, count: effectiveCount + 1, resetAt: nextResetAt },
        { count: existing.count, resetAt: existing.resetAt },
      );
      if (wrote) return;
      // Another concurrent consume() won the write race; re-read and retry against fresh state.
    }

    throw new QuotaExceededError("Quota check could not complete under contention.", {
      tenantId: input.tenantId,
      quotaType: input.quotaType,
    });
  }
}
