/**
 * AuditEvent do módulo organization — agregado-irmão do AuditEvent de expiration/subject
 * (src/modules/expiration/domain/audit-event.ts, src/modules/subject/domain/audit-event.ts),
 * mesma forma/garantias (append-only, redigido, sempre na mesma transação do agregado), mas
 * resourceType próprio (Membership/Invitation) — mesmo princípio de agregados-irmãos já
 * aplicado em 06-domain-model-automated-chasing.md, reaproveitado por B2B-8 (D-099).
 */
import { defaultRedactor } from "../../../shared/observability/redactor.js";
import type { Actor } from "../../../shared/contracts/events.js";
import type { EntityKey, TransactWriteEntry } from "../../../shared/dynamodb/occ.js";
import { deriveSecurityAuditMaintenanceDue, securityAuditGsi8Keys } from "../../../shared/security-audit-gsi8.js";

export type MembershipAuditAction =
  | "INVITATION_CREATED"
  | "INVITATION_ACCEPTED"
  | "INVITATION_REVOKED"
  | "ROLE_CHANGED"
  | "MEMBER_REMOVED"
  | "MEMBER_LEFT";
export type MembershipAuditResourceType = "Membership" | "Invitation";

export interface MembershipAuditEvent extends EntityKey {
  entityType: "MembershipAuditEvent";
  auditEventId: string;
  organizationId: string;
  resourceType: MembershipAuditResourceType;
  resourceId: string;
  action: MembershipAuditAction;
  actor: Actor;
  previousVersion?: number;
  newVersion: number;
  changes: Record<string, unknown>;
  occurredAt: string;
  correlationId: string;
  /** MaintenanceDueIndex pointer (D-179/D-187) — written once here, at creation, never refreshed
   * (append-only entity, see `shared/security-audit-gsi8.ts`). */
  GSI8PK: string;
  GSI8SK: string;
}

function monthShard(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 7).replace("-", "");
}

/** Partição própria, sharded por mês — mesmo padrão de `subjectAuditKey()`
 * (`subject/domain/audit-event.ts`), nunca a partição de `Organization`/`Membership`/
 * `Invitation` diretamente (evitaria crescimento ilimitado da partição do agregado para uma
 * organização com alta rotatividade de membros). */
export function membershipAuditKey(organizationId: string, occurredAt: string, auditEventId: string): EntityKey {
  return { PK: `TENANT#${organizationId}#MEMBERSHIPAUDIT#${monthShard(occurredAt)}`, SK: `EVT#${occurredAt}#${auditEventId}` };
}

export interface BuildMembershipAuditEventInput {
  auditEventId: string;
  organizationId: string;
  resourceType: MembershipAuditResourceType;
  resourceId: string;
  action: MembershipAuditAction;
  actor: Actor;
  previousVersion?: number;
  newVersion: number;
  changes: Record<string, unknown>;
  occurredAt: string;
  correlationId: string;
}

export function buildMembershipAuditEvent(input: BuildMembershipAuditEventInput): MembershipAuditEvent {
  const key = membershipAuditKey(input.organizationId, input.occurredAt, input.auditEventId);
  const due = deriveSecurityAuditMaintenanceDue({ occurredAt: input.occurredAt });
  // organizationId IS the tenant id here (see file header) - same value the GSI8 pointer and
  // purge.ts's tenant-ACTIVE fence both key off, normalized under the "tenantId" name.
  const gsi8 = securityAuditGsi8Keys({
    dueAtIso: due.dueAtIso,
    tenantId: input.organizationId,
    entityType: "MembershipAuditEvent",
    sk: key.SK,
  });
  return {
    ...key,
    entityType: "MembershipAuditEvent",
    auditEventId: input.auditEventId,
    organizationId: input.organizationId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    action: input.action,
    actor: input.actor,
    previousVersion: input.previousVersion,
    newVersion: input.newVersion,
    changes: defaultRedactor.redact(input.changes) as Record<string, unknown>,
    occurredAt: input.occurredAt,
    correlationId: input.correlationId,
    ...gsi8,
  };
}

export function appendMembershipAuditToTransaction(tx: TransactWriteEntry[], tableName: string, event: MembershipAuditEvent): void {
  tx.push({
    Put: {
      TableName: tableName,
      Item: { ...event },
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    },
  });
}
