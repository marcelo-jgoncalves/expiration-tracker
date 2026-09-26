/**
 * AuditEvent do módulo subject — agregado-irmão do AuditEvent de expiration
 * (src/modules/expiration/domain/audit-event.ts), mesma forma/mesmas garantias
 * (append-only, redigido, sempre na mesma transação do agregado), mas resourceType próprio
 * (TrackedSubject/RequirementAssignment) em vez de generalizar o tipo já em produção —
 * mesmo princípio de agregados-irmãos já aplicado em 06-domain-model-automated-chasing.md.
 */
import { defaultRedactor } from "../../../shared/observability/redactor.js";
import type { Actor } from "../../../shared/contracts/events.js";
import type { EntityKey, TransactWriteEntry } from "../../../shared/dynamodb/occ.js";
import { deriveSecurityAuditMaintenanceDue, securityAuditGsi8Keys } from "../../../shared/security-audit-gsi8.js";
import type { AuthorizedTenantId } from "../../identity/domain/authorization.js";

// ADR-0016 Decision A (2026-09-25) retired every action tied to RequirementAssignment/
// DocumentRequest(subject)/guest upload (ASSIGN_REQUIREMENT, LINK_ITEM/UNLINK_ITEM, the 5
// INITIAL_INVITE_EMAIL_* outcomes, CONFIGURE_DOCUMENT_REQUEST_DELIVERY) — this module now only
// audits TrackedSubject's own lifecycle.
export type SubjectAuditAction = "CREATE" | "UPDATE" | "ARCHIVE" | "DELETE";
export type SubjectAuditResourceType = "TrackedSubject";

export interface SubjectAuditEvent extends EntityKey {
  entityType: "SubjectAuditEvent";
  auditEventId: string;
  tenantId: string;
  resourceType: SubjectAuditResourceType;
  resourceId: string;
  subjectId: string;
  action: SubjectAuditAction;
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

export function subjectAuditKey(tenantId: AuthorizedTenantId, occurredAt: string, auditEventId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#SUBJECTAUDIT#${monthShard(occurredAt)}`, SK: `EVT#${occurredAt}#${auditEventId}` };
}

export interface BuildSubjectAuditEventInput {
  auditEventId: string;
  tenantId: AuthorizedTenantId;
  resourceType: SubjectAuditResourceType;
  resourceId: string;
  subjectId: string;
  action: SubjectAuditAction;
  actor: Actor;
  previousVersion?: number;
  newVersion: number;
  changes: Record<string, unknown>;
  occurredAt: string;
  correlationId: string;
}

export function buildSubjectAuditEvent(input: BuildSubjectAuditEventInput): SubjectAuditEvent {
  const key = subjectAuditKey(input.tenantId, input.occurredAt, input.auditEventId);
  const due = deriveSecurityAuditMaintenanceDue({ occurredAt: input.occurredAt });
  const gsi8 = securityAuditGsi8Keys({
    dueAtIso: due.dueAtIso,
    tenantId: input.tenantId,
    entityType: "SubjectAuditEvent",
    sk: key.SK,
  });
  return {
    ...key,
    entityType: "SubjectAuditEvent",
    auditEventId: input.auditEventId,
    tenantId: input.tenantId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    subjectId: input.subjectId,
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

export function appendSubjectAuditToTransaction(tx: TransactWriteEntry[], tableName: string, event: SubjectAuditEvent): void {
  tx.push({
    Put: {
      TableName: tableName,
      Item: { ...event },
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    },
  });
}
