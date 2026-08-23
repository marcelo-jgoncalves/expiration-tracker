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

export type SubjectAuditAction = "CREATE" | "UPDATE" | "ARCHIVE" | "DELETE" | "LINK_ITEM" | "UNLINK_ITEM" | "ASSIGN_REQUIREMENT" | "DELETE_REQUIREMENT";
export type SubjectAuditResourceType = "TrackedSubject" | "RequirementAssignment";

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
}

function monthShard(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 7).replace("-", "");
}

export function subjectAuditKey(tenantId: string, occurredAt: string, auditEventId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#SUBJECTAUDIT#${monthShard(occurredAt)}`, SK: `EVT#${occurredAt}#${auditEventId}` };
}

export interface BuildSubjectAuditEventInput {
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
}

export function buildSubjectAuditEvent(input: BuildSubjectAuditEventInput): SubjectAuditEvent {
  const key = subjectAuditKey(input.tenantId, input.occurredAt, input.auditEventId);
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
