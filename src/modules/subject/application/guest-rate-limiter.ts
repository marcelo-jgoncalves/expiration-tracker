/**
 * Rate limit por token de convidado — 04-domain-model-guest-upload.md (D-037): "por token E
 * por IP, ambos antes de consumir a quota normal do tenant". O dimensionamento por IP fica a
 * cargo do WAF (infra, rate-based rule) — este serviço cobre só a dimensão por token, mesmo
 * padrão de token bucket de janela fixa já usado por `TenantQuotaService`
 * (identity/application/quota.ts), aqui escopado ao namespace tenantless `GUESTTOKEN#...`
 * (nunca `TENANT#...` — o convidado não tem tenant resolvido antes da validação do token).
 */
import { QuotaExceededError } from "../../../shared/errors/app-error.js";
import type { EntityKey, SubjectStore } from "../ports/subject-store.js";

export interface GuestRateLimitRecord extends EntityKey {
  SK: "RATE";
  entityType: "GuestTokenRateLimit";
  selectorHash: string;
  limit: number;
  windowSeconds: number;
  count: number;
  resetAt: string;
}

function guestRateLimitKey(selectorHash: string): { PK: string; SK: "RATE" } {
  return { PK: `GUESTTOKEN#${selectorHash}#RATE`, SK: "RATE" };
}

const MAX_CONTENTION_RETRIES = 20;

export class GuestRateLimiter {
  constructor(
    private readonly store: SubjectStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** Consome 1 unidade da janela; lança QuotaExceededError quando esgotado (mapeado a 429). */
  async consume(input: { selectorHash: string; limit: number; windowSeconds: number }): Promise<void> {
    const key = guestRateLimitKey(input.selectorHash);
    for (let attempt = 0; attempt < MAX_CONTENTION_RETRIES; attempt++) {
      const nowIso = this.now();
      const resetAt = new Date(Date.parse(nowIso) + input.windowSeconds * 1000).toISOString();

      const existing = await this.store.get<GuestRateLimitRecord>(key);
      if (!existing) {
        const created = await this.store.putIfAbsent<GuestRateLimitRecord>({
          ...key,
          entityType: "GuestTokenRateLimit",
          selectorHash: input.selectorHash,
          limit: input.limit,
          windowSeconds: input.windowSeconds,
          count: 1,
          resetAt,
        });
        if (created) return;
        continue; // perdeu a corrida de criação - relê estado fresco.
      }

      const windowExpired = existing.resetAt < nowIso;
      const effectiveCount = windowExpired ? 0 : existing.count;
      if (effectiveCount >= existing.limit) {
        // Achado real de revisão adversarial (Codex): nunca incluir `selectorHash` em
        // `details` - `AppError.toJSON()` serializa `details` na resposta HTTP, e este erro
        // pode escapar até uma superfície pública (guest-submission-service.ts) onde isso
        // vazaria um identificador correlacionável ao token do convidado.
        throw new QuotaExceededError("Guest token rate limit exceeded.");
      }

      const nextResetAt = windowExpired ? resetAt : existing.resetAt;
      const wrote = await this.store.updateConditional(
        { ...existing, count: effectiveCount + 1, resetAt: nextResetAt },
        { count: existing.count, resetAt: existing.resetAt },
      );
      if (wrote) return;
      // Outra chamada concorrente venceu a corrida de escrita - relê estado fresco e retenta.
    }
    throw new QuotaExceededError("Guest token rate limit check could not complete under contention.");
  }
}
