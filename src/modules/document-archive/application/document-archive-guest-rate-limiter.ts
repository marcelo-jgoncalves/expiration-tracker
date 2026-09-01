/**
 * DocumentArchiveGuestRateLimiter — D-143 Decision 4: "rate limit multidimensional (requestId
 * AND IP)". Same fixed-window token-bucket mechanism as
 * `src/modules/subject/application/{guest-rate-limiter,initial-invite-rate-limiter}.ts` —
 * duplicated rather than imported across the module boundary (cross-module ports->ports import
 * is exactly what the 2026-08-19 Engineering Maturity Review moved these builders out of
 * `expiration-store.ts` to avoid; this mechanism is small and already independently tested in
 * both existing copies, cheaper to duplicate a third time here than to introduce a shared-module
 * dependency for it). Scoped to the tenantless `DOCARCHIVEGUEST#...`/`DOCARCHIVEGUESTIP#...`
 * namespaces — resolution happens before `tenantId` is known, same reasoning as
 * `GuestRateLimiter`.
 */
import { QuotaExceededError } from "../../../shared/errors/app-error.js";
import { epochSecondsFromIso } from "../domain/request-access-credential.js";
import type { DocumentArchiveStore, EntityKey } from "../ports/document-archive-store.js";

export interface DocumentArchiveGuestRateLimitRecord extends EntityKey {
  SK: "RATE";
  entityType: "DocumentArchiveGuestRateLimit";
  limit: number;
  windowSeconds: number;
  count: number;
  resetAt: string;
  purgeAfterTtl: number;
}

const MAX_CONTENTION_RETRIES = 20;

export class DocumentArchiveGuestRateLimiter {
  constructor(
    private readonly store: DocumentArchiveStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** Consumes both dimensions — by `requestId`-derived selector AND by caller IP — in the FIRST
   * limit-exceeded order, never consuming the second dimension after the first already rejected
   * (same "don't spend a wider window's quota on an attempt already doomed" discipline as
   * `InitialInviteRateLimiter.consumeInitialInvite`). Any exhaustion throws the SAME
   * `QuotaExceededError` — callers on the guest surface must collapse this into the single
   * generic anti-enumeration error, never surface 429 differently from 401 on this path. */
  async consumeBoth(input: { requestKey: string; ip: string; limit: number; windowSeconds: number }): Promise<void> {
    await this.consume({ PK: `DOCARCHIVEGUEST#${input.requestKey}#RATE`, SK: "RATE" }, input.limit, input.windowSeconds);
    await this.consume({ PK: `DOCARCHIVEGUESTIP#${input.ip}#RATE`, SK: "RATE" }, input.limit, input.windowSeconds);
  }

  private async consume(key: { PK: string; SK: "RATE" }, limit: number, windowSeconds: number): Promise<void> {
    for (let attempt = 0; attempt < MAX_CONTENTION_RETRIES; attempt++) {
      const nowIso = this.now();
      const resetAt = new Date(Date.parse(nowIso) + windowSeconds * 1000).toISOString();

      const existing = await this.store.get<DocumentArchiveGuestRateLimitRecord>(key);
      if (!existing) {
        const created = await this.store.putIfAbsent<DocumentArchiveGuestRateLimitRecord>({
          ...key,
          entityType: "DocumentArchiveGuestRateLimit",
          limit,
          windowSeconds,
          count: 1,
          resetAt,
          purgeAfterTtl: epochSecondsFromIso(resetAt),
        });
        if (created) return;
        continue; // lost the create race — re-read fresh state.
      }

      const windowExpired = existing.resetAt < nowIso;
      const effectiveCount = windowExpired ? 0 : existing.count;
      if (effectiveCount >= existing.limit) {
        // Never include the key in `details` — `AppError.toJSON()` serializes `details` into
        // the HTTP response, and this error can escape to the public guest surface where a
        // correlatable identifier would be a new oracle (same discipline as `GuestRateLimiter`).
        throw new QuotaExceededError("Guest rate limit exceeded.");
      }

      const nextResetAt = windowExpired ? resetAt : existing.resetAt;
      const wrote = await this.store.updateConditional(
        { ...existing, count: effectiveCount + 1, resetAt: nextResetAt, purgeAfterTtl: epochSecondsFromIso(nextResetAt) },
        { count: existing.count, resetAt: existing.resetAt },
      );
      if (wrote) return;
      // Concurrent writer won the write race — re-read fresh state and retry.
    }
    throw new QuotaExceededError("Guest rate limit check could not complete under contention.");
  }
}
