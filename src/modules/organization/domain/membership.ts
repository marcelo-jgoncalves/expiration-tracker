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
