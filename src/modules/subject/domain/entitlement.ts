/**
 * TenantEntitlement — 05-domain-model-organization-billing.md (D-038): Entitlement/UsageQuota
 * mínimo local, plano default/free, limite de ACTIVE_TRACKED_SUBJECTS — sem depender de
 * provider de billing externo (esse entra só em M12). Billing por TrackedSubject, não por
 * assento (02-market-research.md: nenhum concorrente pesquisado cobra por usuário).
 *
 * Contador atômico incrementado/decrementado na MESMA transação que cria/remove um
 * TrackedSubject (nunca uma chamada separada) — evita a mesma classe de lost-update já
 * encontrada e corrigida em TenantQuotaService (identity/application/quota.ts), e é mais
 * forte que o padrão de "release" best-effort dessa classe: aqui a entidade e o contador
 * SEMPRE mudam juntos ou nenhum muda.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export const DEFAULT_PLAN_ID = "free";
/** Referência de mercado real (02-market-research.md): bcs oferece 25 vendors grátis, sem
 * cartão. Mesma ordem de grandeza adotada aqui como default do plano free — ajustável quando
 * billing real (M12) introduzir planos pagos. */
export const DEFAULT_ACTIVE_TRACKED_SUBJECTS_LIMIT = 25;

export interface TenantEntitlement extends EntityKey {
  SK: "PLAN";
  entityType: "TenantEntitlement";
  tenantId: string;
  planId: string;
  activeTrackedSubjectsLimit: number;
  activeTrackedSubjectsCount: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function entitlementKey(tenantId: string): { PK: string; SK: "PLAN" } {
  return { PK: `TENANT#${tenantId}#ENTITLEMENT`, SK: "PLAN" };
}

export function defaultEntitlement(tenantId: string, now: string): TenantEntitlement {
  return {
    ...entitlementKey(tenantId),
    entityType: "TenantEntitlement",
    tenantId,
    planId: DEFAULT_PLAN_ID,
    activeTrackedSubjectsLimit: DEFAULT_ACTIVE_TRACKED_SUBJECTS_LIMIT,
    activeTrackedSubjectsCount: 0,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}
