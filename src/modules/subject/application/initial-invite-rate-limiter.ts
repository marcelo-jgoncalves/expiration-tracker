/**
 * Rate limit do convite inicial automatizado (M10 cluster 4, D-049) — 3 limites concretos
 * (não "a decidir depois"), verificados ANTES da criação do `DocumentRequest` quando o envio
 * é solicitado: excedê-los bloqueia a criação com `QuotaExceededError`/429, nunca cria
 * parcialmente (mesma disciplina fail-closed de `TenantEntitlement`, D-038) — diferente de
 * falha de SES pós-criação, que é best-effort (`DocumentRequestService`).
 *
 * Mesmo mecanismo de janela fixa de `GuestRateLimiter` (não `TenantQuotaService` do módulo
 * identity — reusar isso exigiria adicionar tipos de quota específicos de `subject` a um
 * union type fechado de outro módulo, o acoplamento reverso que `shared-must-not-reach-modules`
 * já existe para prevenir num nível análogo; duplicar esse mecanismo pequeno e já testado é
 * mais barato que esse acoplamento), reaproveitado 3 vezes com chaves diferentes.
 */
import { QuotaExceededError } from "../../../shared/errors/app-error.js";
import type { EntityKey, SubjectStore } from "../ports/subject-store.js";
import { createHash } from "node:crypto";

export interface InitialInviteRateLimitRecord extends EntityKey {
  SK: "RATE" | "RATE_DAILY";
  entityType: "InitialInviteRateLimit";
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

export class InitialInviteRateLimiter {
  constructor(
    private readonly store: SubjectStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** Consome as 3 janelas (hora/dia por tenant, 24h por tenant+destinatário) - lança no
   * PRIMEIRO limite excedido, nunca consome as demais depois de falhar (evita gastar quota
   * de janelas mais largas por uma tentativa que já vai ser rejeitada). */
  async consumeInitialInvite(tenantId: string, recipientEmail: string): Promise<void> {
    await this.consume({ PK: `TENANT#${tenantId}#SETTINGS`, SK: "RATE" }, 20, 60 * 60);
    await this.consume({ PK: `TENANT#${tenantId}#SETTINGS`, SK: "RATE_DAILY" }, 100, 24 * 60 * 60);
    await this.consume({ PK: `TENANT#${tenantId}#SETTINGS#RECIPIENT#${recipientHash(recipientEmail)}`, SK: "RATE" }, 3, 24 * 60 * 60);
  }

  private async consume(key: { PK: string; SK: "RATE" | "RATE_DAILY" }, limit: number, windowSeconds: number): Promise<void> {
    for (let attempt = 0; attempt < MAX_CONTENTION_RETRIES; attempt++) {
      const nowIso = this.now();
      const resetAt = new Date(Date.parse(nowIso) + windowSeconds * 1000).toISOString();

      const existing = await this.store.get<InitialInviteRateLimitRecord>(key);
      if (!existing) {
        const created = await this.store.putIfAbsent<InitialInviteRateLimitRecord>({
          ...key,
          entityType: "InitialInviteRateLimit",
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
        // adversarial já corrigido para GuestRateLimiter (AppError.toJSON() serializa
        // `details` na resposta HTTP).
        throw new QuotaExceededError("Initial invite rate limit exceeded.");
      }

      const nextResetAt = windowExpired ? resetAt : existing.resetAt;
      const wrote = await this.store.updateConditional(
        { ...existing, count: effectiveCount + 1, resetAt: nextResetAt, purgeAfterTtl: epochSeconds(nextResetAt) },
        { count: existing.count, resetAt: existing.resetAt },
      );
      if (wrote) return;
    }
    throw new QuotaExceededError("Initial invite rate limit check could not complete under contention.");
  }
}
