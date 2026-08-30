/**
 * DynamoDB surface do módulo organization — mesmo padrão SDK-agnostic de
 * src/modules/subject/ports/subject-store.ts. `transactWrite` porque `CreateOrganization`
 * (Wave B2B-3.3) precisa comitar `Organization`+`Membership` OWNER+`TenantLifecycleRecord`+
 * `TenantEntitlement` defaults numa única `TransactWriteItems` (physical model §4).
 */
import type { EntityKey, TransactWriteEntry } from "../../../shared/dynamodb/occ.js";

export type { EntityKey, TransactWriteEntry };
export { isTransactionCanceled } from "../../../shared/dynamodb/occ.js";

export interface Gsi4QueryInput {
  gsi4pk: string;
  limit?: number;
}

export interface OrganizationStore {
  /** Leitura fortemente consistente. */
  get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined>;
  putIfAbsent<T extends EntityKey>(item: T): Promise<boolean>;
  /** PutItem condicionado ao contador ainda bater com `expected` no momento da escrita — B2B-8
   * (`MembershipInviteRateLimiter`), mesma assinatura literal de `SubjectStore.updateConditional`
   * (`subject/ports/subject-store.ts`). */
  updateConditional<T extends EntityKey>(item: T, expected: { count: number; resetAt: string }): Promise<boolean>;
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
  /** Query pela partição da Organization com prefixo de SK opcional — lista Membership/
   * Invitation sob a mesma partição sem GSI novo (adjacency-list, mesmo padrão já em
   * produção em identity/subject). */
  queryByPk<T extends EntityKey = Record<string, unknown> & EntityKey>(pk: string, skPrefix?: string): Promise<T[]>;
  /** `MembershipByUser` (GSI4, domain/membership.ts#membershipGsi4Keys). Eventually
   * consistent, nunca fonte de autorização (physical model §6) — só para listagem. */
  queryGsi4<T extends EntityKey = Record<string, unknown> & EntityKey>(input: Gsi4QueryInput): Promise<T[]>;
}
