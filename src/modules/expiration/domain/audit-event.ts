/**
 * AuditEvent — data-model.md §2: "append-only, sem update/delete normal".
 * PK=TENANT#t#AUDIT#<yyyyMM>, SK=EVT#<timestamp>#<id>. This module only builds the
 * item + its transactional Put entry (mirrors src/shared/outbox/outbox.ts's shape) so
 * every mutation appends its audit record inside the SAME TransactWriteItems as the
 * aggregate write - never as a separate, droppable follow-up call. There is
 * deliberately no update()/delete() exported anywhere for this entity.
 */
import { defaultRedactor } from "../../../shared/observability/redactor.js";
import type { Actor } from "../../../shared/contracts/events.js";
import type { EntityKey, TransactWriteEntry } from "../../../shared/dynamodb/occ.js";
import { deriveSecurityAuditMaintenanceDue, securityAuditGsi8Keys } from "../../../shared/security-audit-gsi8.js";

export type AuditAction = "CREATE" | "UPDATE" | "ARCHIVE" | "RENEW" | "DELETE";

export interface AuditEvent extends EntityKey {
  entityType: "AuditEvent";
  auditEventId: string;
  tenantId: string;
  resourceType: "ExpirationItem";
  resourceId: string;
  itemId: string;
  action: AuditAction;
  actor: Actor;
  previousVersion?: number;
  newVersion: number;
  /** Redacted diff of changed fields (before/after), never raw values that might carry PII (implementation-blueprint.md #14.1 redactor). */
  changes: Record<string, unknown>;
  occurredAt: string;
  correlationId: string;
  causationId?: string;
  /** MaintenanceDueIndex pointer (D-179/D-187) — written once here, at creation, never refreshed
   * (append-only entity, see `shared/security-audit-gsi8.ts`). */
  GSI8PK: string;
  GSI8SK: string;
}

function monthShard(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 7).replace("-", "");
}

export function auditKey(tenantId: string, occurredAt: string, auditEventId: string): EntityKey {
  return {
    PK: `TENANT#${tenantId}#AUDIT#${monthShard(occurredAt)}`,
    SK: `EVT#${occurredAt}#${auditEventId}`,
  };
}

export interface BuildAuditEventInput {
  auditEventId: string;
  tenantId: string;
  itemId: string;
  action: AuditAction;
  actor: Actor;
  previousVersion?: number;
  newVersion: number;
  /** Raw before/after values - redacted internally before being stored. */
  changes: Record<string, unknown>;
  occurredAt: string;
  correlationId: string;
  causationId?: string;
}

export function buildAuditEvent(input: BuildAuditEventInput): AuditEvent {
  const key = auditKey(input.tenantId, input.occurredAt, input.auditEventId);
  const due = deriveSecurityAuditMaintenanceDue({ occurredAt: input.occurredAt });
  const gsi8 = securityAuditGsi8Keys({
    dueAtIso: due.dueAtIso,
    tenantId: input.tenantId,
    entityType: "AuditEvent",
    sk: key.SK,
  });
  return {
    ...key,
    entityType: "AuditEvent",
    auditEventId: input.auditEventId,
    tenantId: input.tenantId,
    resourceType: "ExpirationItem",
    resourceId: input.itemId,
    itemId: input.itemId,
    action: input.action,
    actor: input.actor,
    previousVersion: input.previousVersion,
    newVersion: input.newVersion,
    changes: defaultRedactor.redact(input.changes) as Record<string, unknown>,
    occurredAt: input.occurredAt,
    correlationId: input.correlationId,
    causationId: input.causationId,
    ...gsi8,
  };
}

/** Appends the AuditEvent's conditional Put entry to a caller-supplied TransactWriteItems array, same convention as outbox.ts's appendToTransaction (accepts the full Put|Update union so callers don't need an unsafe cast for a mixed transaction). */
export function appendAuditToTransaction(tx: TransactWriteEntry[], tableName: string, event: AuditEvent): void {
  tx.push({
    Put: {
      TableName: tableName,
      Item: { ...event },
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    },
  });
}
