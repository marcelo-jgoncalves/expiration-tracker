/**
 * Membership — Multi-User B2B Wave B2B-3 (docs/architecture/multi-user-b2b-physical-model.md
 * §5, `APPROVED` D-086). Mesma partição do `Organization` (domain/organization.ts):
 * `PK=TENANT#<organizationId>#ORG#<organizationId>`, `SK=MEMBER#<userId>`.
 *
 * Três estados, nunca hard-delete (mesmo padrão de retenção/auditoria já usado por
 * `AuditEvent`/W3-07 neste projeto): `REMOVED` substitui remoção física — a linha permanece,
 * só o `status` muda. `SUSPENDED` ainda É membro (conta para `ownerCount` se `role=OWNER`,
 * sem acesso operacional); reversível só por ação administrativa explícita (fora do escopo
 * desta wave). `REMOVED` é o único estado que um reingresso via convite pode sobrescrever
 * (Wave B2B-8, physical model §9 — `Update` condicionado a
 * `attribute_not_exists(PK) OR #status = :REMOVED`, não implementado ainda nesta wave).
 *
 * `GSI4PK`/`GSI4SK` só existem neste tipo de item — índice esparso, verificado seguro contra
 * o resto do schema (Wave B2B-1, rodada de design). GSI4 é EVENTUALLY CONSISTENT por natureza
 * do DynamoDB e NUNCA é fonte de autorização (physical model §6): serve só para listar
 * Organizations de um usuário (`GET /me`, seletor) — resolução de `RequestContext`/decisão de
 * acesso sempre faz `GetItem` direto na partição base via `membershipKey()`, nunca via GSI4.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export type MembershipRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
export type MembershipStatus = "ACTIVE" | "SUSPENDED" | "REMOVED";

export interface Membership extends EntityKey {
  SK: string; // MEMBER#<userId>
  entityType: "Membership";
  membershipId: string;
  organizationId: string;
  userId: string;
  role: MembershipRole;
  status: MembershipStatus;
  joinedAt: string;
  createdBy: string;
  /** Set only when status transitions to REMOVED (remove-membership.ts/leave-organization.ts);
   * cleared on reactivation (accept-invitation.ts). Absent for a Membership never removed.
   * The clock the ACCOUNT_ACTIVE LGPD purge worker needs for "encerramento + 30 dias"
   * (privacy-lgpd.md §4, D-127/D-155/D-157 — this field was the missing blocker). */
  removedAt?: string;
  version: number;
  GSI4PK: string;
  GSI4SK: string;
  /** MaintenanceDueIndex pointer (D-179/D-180) — written atomically in the SAME transaction
   * that sets status=REMOVED (never a separate write), cleared atomically on reactivation
   * (accept-invitation.ts). Sparse: absent for any Membership that was never removed, so it
   * never appears in a GSI8 query until there is a real due date. GSI8 is discovery-only
   * (never a source of eligibility) — membership-purge-worker.ts revalidates the base item
   * via deriveMembershipMaintenanceDue() before acting on any candidate this produces. */
  GSI8PK?: string;
  GSI8SK?: string;
  /** Observed-on-revalidation retry counter for the GSI8 claim/revalidation transaction (D-179
   * §8 poison-record handling) — incremented only when the atomic tenant-ACTIVE ConditionCheck
   * fails (never recomputed speculatively), drives the capped exponential backoff of GSI8SK and
   * the move to the DLQ#MEMBERSHIP_PURGE namespace above MAX_ATTEMPTS. Absent until the first
   * failed claim attempt. */
  maintenanceAttemptCount?: number;
}

export function membershipKey(organizationId: string, userId: string): { PK: string; SK: string } {
  return { PK: `TENANT#${organizationId}#ORG#${organizationId}`, SK: `MEMBER#${userId}` };
}

/** `MembershipByUser` (GSI4, reaproveitado — não é GSI novo, §6 do physical model). Resolve
 * "quais Organizations este usuário pode acessar" sem tenant prévio. */
export function membershipGsi4Keys(userId: string, organizationId: string, membershipId: string): { GSI4PK: string; GSI4SK: string } {
  return {
    GSI4PK: `USER#${userId}`,
    GSI4SK: `ORG#${organizationId}#MEMBERSHIP#${membershipId}`,
  };
}

/** D-127 Prioridade 5's "encerramento + 30 dias" retention window for a REMOVED Membership row
 * — the same clock D-155/D-158 established, now also the source of `deriveMembershipMaintenanceDue()`'s
 * due date (D-179/D-180). */
export const MEMBERSHIP_RETENTION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** GSI8 (MaintenanceDueIndex, D-179) namespace this worker owns — the ONLY value any
 * membership-purge-scoped IAM policy's `dynamodb:LeadingKeys` condition may reference
 * (`infra/modules/dynamo-table/main.tf`), alongside the DLQ counterpart below. */
export const MEMBERSHIP_PURGE_WORK_TYPE = "MEMBERSHIP_PURGE";

export interface MaintenanceDue {
  dueAtIso: string;
}

/**
 * Pure `deriveMaintenanceDue()` for `Membership` (D-179 §2) — the single source of truth for
 * "when does this row become a membership-purge candidate", reused by all 3 consumers the
 * design names: the writer of the GSI8 pointer at the real REMOVED transition
 * (`remove-membership.ts`/`leave-organization.ts`), the backfill script
 * (`scripts/backfill-gsi8-membership-purge.ts`), and the worker's own revalidation step
 * (`membership-purge/purge.ts` — GSI8 is discovery-only, NEVER a source of eligibility, so
 * every candidate the index returns is re-derived from the base item before being acted on).
 * `undefined` means "this row can never be a candidate in its current state" (still ACTIVE/
 * SUSPENDED, or a pre-D-158 REMOVED row with no `removedAt`) — never "not yet due", which is
 * instead a `dueAtIso` in the future.
 */
export function deriveMembershipMaintenanceDue(membership: Pick<Membership, "status" | "removedAt">): MaintenanceDue | undefined {
  if (membership.status !== "REMOVED" || !membership.removedAt) return undefined;
  const dueAtMs = Date.parse(membership.removedAt) + MEMBERSHIP_RETENTION_DAYS * MS_PER_DAY;
  return { dueAtIso: new Date(dueAtMs).toISOString() };
}

/** `GSI8PK=WORK#MEMBERSHIP_PURGE` / `GSI8SK=<dueAtIso>#TENANT#<tenantId>#<membershipId>`
 * (D-179's exact key spec) — `tenantId` embedded in the sort key lets the worker revalidate
 * the atomic tenant-ACTIVE `ConditionCheck` straight off a `KEYS_ONLY` Query result, without a
 * second read just to learn which tenant a candidate belongs to. */
export function membershipGsi8Keys(input: { dueAtIso: string; tenantId: string; membershipId: string }): { GSI8PK: string; GSI8SK: string } {
  return {
    GSI8PK: `WORK#${MEMBERSHIP_PURGE_WORK_TYPE}`,
    GSI8SK: `${input.dueAtIso}#TENANT#${input.tenantId}#${input.membershipId}`,
  };
}
