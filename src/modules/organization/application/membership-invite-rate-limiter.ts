/**
 * Rate limit de convite de Organization (B2B-8, D-099) — mesma mecânica de
 * `subject/application/initial-invite-rate-limiter.ts` (janela fixa, `putIfAbsent`/
 * `updateConditional`, retry sob contenção), TEMPLATE reaproveitado, nunca a classe em si
 * (`organization` não deve importar de `subject` — `check-boundaries`). Chave namespaced com o
 * segmento `#MEMBERSHIP-INVITE`, distinto de `TENANT#<tenantId>#SETTINGS`/`RATE` que
 * `InitialInviteRateLimiter` já usa para convite de guest document-request — pós-cutover
 * `tenantId=organizationId`, as duas viveriam na mesma partição de tenant sem essa distinção
 * (achado real da Rodada 1 do Codex, docs/architecture/reviews/multi-user-b2b-wave-b2b8-
 * scoping/round-1-codex-critique.md).
 */
import { QuotaExceededError } from "../../../shared/errors/app-error.js";
import type { EntityKey, OrganizationStore } from "../ports/organization-store.js";
import { createHash } from "node:crypto";

export interface MembershipInviteRateLimitRecord extends EntityKey {
  SK: "RATE" | "RATE_DAILY";
  entityType: "MembershipInviteRateLimit";
  limit: number;
  windowSeconds: number;
  count: number;
  resetAt: string;
  purgeAfterTtl: number;
}

function epochSeconds(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}

function recipientHash(recipientEmail: string): string {
  return createHash("sha256").update(recipientEmail.trim().toLowerCase()).digest("hex").slice(0, 32);
}

const MAX_CONTENTION_RETRIES = 20;

export class MembershipInviteRateLimiter {
  constructor(
    private readonly store: OrganizationStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** Consome as 3 janelas (hora/dia por org, 24h por org+destinatário) - lança no PRIMEIRO
   * limite excedido, nunca consome as demais depois de falhar. Mesmos limites de
   * `InitialInviteRateLimiter` (D-049) - reaproveitados, não uma decisão nova de anti-abuso. */
  async consumeMembershipInvite(organizationId: string, recipientEmail: string): Promise<void> {
    await this.consume({ PK: `TENANT#${organizationId}#SETTINGS#MEMBERSHIP-INVITE`, SK: "RATE" }, 20, 60 * 60);
    await this.consume({ PK: `TENANT#${organizationId}#SETTINGS#MEMBERSHIP-INVITE`, SK: "RATE_DAILY" }, 100, 24 * 60 * 60);
    await this.consume({ PK: `TENANT#${organizationId}#SETTINGS#MEMBERSHIP-INVITE#RECIPIENT#${recipientHash(recipientEmail)}`, SK: "RATE" }, 3, 24 * 60 * 60);
  }

  private async consume(key: { PK: string; SK: "RATE" | "RATE_DAILY" }, limit: number, windowSeconds: number): Promise<void> {
    for (let attempt = 0; attempt < MAX_CONTENTION_RETRIES; attempt++) {
      const nowIso = this.now();
      const resetAt = new Date(Date.parse(nowIso) + windowSeconds * 1000).toISOString();

      const existing = await this.store.get<MembershipInviteRateLimitRecord>(key);
      if (!existing) {
        const created = await this.store.putIfAbsent<MembershipInviteRateLimitRecord>({
          ...key,
          entityType: "MembershipInviteRateLimit",
          limit,
          windowSeconds,
          count: 1,
          resetAt,
          purgeAfterTtl: epochSeconds(resetAt),
        });
        if (created) return;
        continue;
      }

      const windowExpired = existing.resetAt < nowIso;
      const effectiveCount = windowExpired ? 0 : existing.count;
      if (effectiveCount >= existing.limit) {
        // Nunca inclui a chave/destinatário em `details` - mesmo achado real de revisão
        // adversarial já corrigido para GuestRateLimiter/InitialInviteRateLimiter.
        throw new QuotaExceededError("Membership invite rate limit exceeded.");
      }

      const nextResetAt = windowExpired ? resetAt : existing.resetAt;
      const wrote = await this.store.updateConditional(
        { ...existing, count: effectiveCount + 1, resetAt: nextResetAt, purgeAfterTtl: epochSeconds(nextResetAt) },
        { count: existing.count, resetAt: existing.resetAt },
      );
      if (wrote) return;
    }
    throw new QuotaExceededError("Membership invite rate limit check could not complete under contention.");
  }
}
