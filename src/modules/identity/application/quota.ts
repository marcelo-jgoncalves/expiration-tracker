/**
 * TenantQuota token bucket — data-model.md §"Rastreabilidade a gates de abuso/custo":
 * PK=TENANT#t#QUOTA, SK=TYPE#<quotaType>#<window>, decremented via ConditionExpression
 * "no race condition between concurrent requests of the same tenant" (same pattern as
 * UploadSlot). Enforced at the API/Lambda boundary per M1 deliverable list.
 */
import { QuotaExceededError } from "../../../shared/errors/app-error.js";
import type { EntityKey, IdentityStore, TransactWriteEntry } from "../ports/identity-store.js";
import { buildConditionalPut, buildVersionedCreate, isTransactionCanceled } from "../../../shared/dynamodb/occ.js";
import { executeTenantBusinessMutation } from "../../../shared/tenant-lifecycle/tenant-business-mutation.js";

export type QuotaType =
  | "API_REQUEST"
  | "UPLOAD_BYTES"
  | "UPLOAD_COUNT"
  | "AI_CALL"
  | "NOTIFICATION_EMAIL"
  // M11 (CSV import/export, D-042, 09-domain-model-csv-import.md): separados de UPLOAD_* (M6) -
  // import é uma superfície de processamento em massa com um perfil de abuso diferente.
  | "IMPORT_COUNT"
  | "IMPORT_BYTES"
  | "IMPORT_ROWS";

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
  /**
   * W3-07 writer inventory (D-068/D-069 follow-up): `consume()` is the classic TOCTOU-prone
   * single-item conditional write named as the top migration priority in
   * `NEXT_SESSION_PROMPT.md` and Round E of the approved design (`claude-analysis-active-only-
   * fence.md` §O-3) — the real admission point before every paid Textract/Bedrock call.
   * `release()` is NOT migrated (deliberately out of scope, see its own docstring below) — it
   * compensates a reservation already admitted earlier, it is not itself a new admission.
   * `tableName` is now required because both the create path (`putIfAbsent`) and the update
   * path (`updateConditional`) of `consume()` are rebuilt as a single `TransactWriteItems` call
   * through `executeTenantBusinessMutation`, which needs the table name to build the lifecycle
   * `ConditionCheck` (`shared/tenant-lifecycle/tenant-business-mutation.ts`) — same pattern
   * `ItemWatchService.removeWatcher` already established.
   */
  constructor(
    private readonly store: IdentityStore,
    private readonly tableName: string,
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
        const entries: TransactWriteEntry[] = [
          {
            Put: buildVersionedCreate(this.tableName, {
              ...key,
              entityType: "TenantQuota",
              tenantId: input.tenantId,
              quotaType: input.quotaType,
              limit: input.limit,
              windowSeconds: input.windowSeconds,
              count: 1,
              resetAt,
            }),
          },
        ];
        const created = await this.tryFencedWrite(input.tenantId, entries);
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
      const entries: TransactWriteEntry[] = [
        {
          Put: buildConditionalPut({
            tableName: this.tableName,
            item: { ...existing, count: effectiveCount + 1, resetAt: nextResetAt },
            conditionExpression: "#count = :expectedCount AND resetAt = :expectedResetAt",
            names: { "#count": "count" },
            values: { ":expectedCount": existing.count, ":expectedResetAt": existing.resetAt },
          }),
        },
      ];
      const wrote = await this.tryFencedWrite(input.tenantId, entries);
      if (wrote) return;
      // Another concurrent consume() won the write race; re-read and retry against fresh state.
    }

    throw new QuotaExceededError("Quota check could not complete under contention.", {
      tenantId: input.tenantId,
      quotaType: input.quotaType,
    });
  }

  /**
   * Commits `entries` through the `TenantBusinessMutation` lane (W3-07 fence). Returns `false`
   * on an ordinary OCC/create-race conflict on the caller's own entry (so the read-check-write
   * loop above retries exactly as it did before this migration) and re-throws
   * `TenantNotActiveError` unchanged when the lifecycle fence itself is what rejected the
   * mutation (never retried - the tenant is being deleted, retrying cannot help).
   */
  private async tryFencedWrite(tenantId: string, entries: TransactWriteEntry[]): Promise<boolean> {
    try {
      await executeTenantBusinessMutation({ store: this.store, tableName: this.tableName, tenantId, entries });
      return true;
    } catch (err) {
      if (err instanceof Error && err.name === "TenantNotActiveError") throw err;
      if (isTransactionCanceled(err)) return false;
      throw err;
    }
  }

  /**
   * Releases 1 previously-consumed unit — M6 design §3.5 (UploadSlotReconciliationWorker
   * "libera quota idempotentemente" for a slot that expired unconfirmed). Idempotent: never
   * decrements below 0, and calling this twice for the same already-released slot floors at 0
   * rather than double-crediting. A window that has already reset naturally (count implicitly
   * 0) is a no-op, not an error - the quota already recovered on its own.
   *
   * NOT fenced through `TenantBusinessMutation` (W3-07 writer inventory, deliberate): this is
   * compensation for a unit `consume()` already admitted while ACTIVE, not a new admission -
   * blocking it during `DELETING` would leak a reservation forever with no way to free it.
   */
  async release(input: Omit<QuotaCheckInput, "limit"> & { limit?: number }): Promise<void> {
    for (let attempt = 0; attempt < TenantQuotaService.MAX_CONTENTION_RETRIES; attempt++) {
      const key = tenantQuotaKey(input.tenantId, input.quotaType, input.window);
      const nowIso = this.now();
      const existing = await this.store.get<TenantQuotaRecord>(key);
      if (!existing) return; // nothing consumed yet for this window - nothing to release.

      const windowExpired = existing.resetAt < nowIso;
      if (windowExpired) return; // window already reset naturally - already recovered.

      const nextCount = Math.max(0, existing.count - 1);
      const wrote = await this.store.updateConditional({ ...existing, count: nextCount }, { count: existing.count, resetAt: existing.resetAt });
      if (wrote) return;
      // Lost a concurrent write race; re-read and retry against fresh state.
    }
    throw new QuotaExceededError("Quota release could not complete under contention.", { tenantId: input.tenantId, quotaType: input.quotaType });
  }
}
