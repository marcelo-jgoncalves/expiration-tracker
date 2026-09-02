/**
 * TenantAuditEvent — 4th agregado-irmão de AuditEvent (expiration/domain/audit-event.ts),
 * MembershipAuditEvent (organization/domain/audit-event.ts) e SubjectAuditEvent
 * (subject/domain/audit-event.ts). Mesma forma/garantias (append-only, redigido, sempre na
 * mesma transação do agregado/operação que ele documenta), mas cobre ações TENANT-WIDE que
 * não pertencem a um único item/membership/subject - primeiro uso real: fechar o gap do
 * D-149 (ExpirationService.exportItems() não gravava nenhum audit event). Diferente dos
 * outros 3, não exige `itemId`/`newVersion` (D-149 decisão 5): a operação que este agregado
 * documenta não é uma mutação versionada de um recurso específico, é uma leitura tenant-wide.
 *
 * Retenção (D-149 decisão 7, D-127): mapeia para a classe SECURITY_AUDIT (prioridade 3 de
 * purga LGPD, createdAt+365d) - para esta entidade imutável, `occurredAt` É o relógio
 * canônico equivalente a `createdAt` (não existe campo separado). O worker de purga real
 * ainda não existe (D-127 item 6 do NEXT_SESSION_PROMPT.md); quando existir, deve tratar
 * `occurredAt` deste tipo exatamente como trataria `createdAt` de qualquer outra entidade.
 */
import { defaultRedactor } from "../../../shared/observability/redactor.js";
import type { Actor } from "../../../shared/contracts/events.js";
import type { EntityKey, TransactWriteEntry } from "../../../shared/dynamodb/occ.js";
import { deriveSecurityAuditMaintenanceDue, securityAuditGsi8Keys } from "../../../shared/security-audit-gsi8.js";

/** v1: único resourceType real é a exportação CSV (D-149) - união deliberadamente estreita,
 * não um `string` genérico, para que um novo tipo de ação tenant-wide futuro exija uma
 * decisão explícita de nomeação aqui, mesmo padrão das outras 3 uniões de AuditAction. */
export type TenantAuditAction = "EXPORT";
export type TenantAuditResourceType = "ExpirationExport";

export interface TenantAuditEvent extends EntityKey {
  entityType: "TenantAuditEvent";
  auditEventId: string;
  tenantId: string;
  resourceType: TenantAuditResourceType;
  action: TenantAuditAction;
  actor: Actor;
  /** Nunca os itens exportados em si - só metadados agregados (ex. { exportedCount }). */
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

/** Partição própria, sharded por mês - mesmo padrão das 3 partições-irmãs, nunca reaproveita
 * a partição AUDIT de ExpirationItem (essa exige itemId/newVersion no shape). */
export function tenantAuditKey(tenantId: string, occurredAt: string, auditEventId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#TENANTAUDIT#${monthShard(occurredAt)}`, SK: `EVT#${occurredAt}#${auditEventId}` };
}

export interface BuildTenantAuditEventInput {
  auditEventId: string;
  tenantId: string;
  resourceType: TenantAuditResourceType;
  action: TenantAuditAction;
  actor: Actor;
  changes: Record<string, unknown>;
  occurredAt: string;
  correlationId: string;
}

export function buildTenantAuditEvent(input: BuildTenantAuditEventInput): TenantAuditEvent {
  const key = tenantAuditKey(input.tenantId, input.occurredAt, input.auditEventId);
  const due = deriveSecurityAuditMaintenanceDue({ occurredAt: input.occurredAt });
  const gsi8 = securityAuditGsi8Keys({
    dueAtIso: due.dueAtIso,
    tenantId: input.tenantId,
    entityType: "TenantAuditEvent",
    sk: key.SK,
  });
  return {
    ...key,
    entityType: "TenantAuditEvent",
    auditEventId: input.auditEventId,
    tenantId: input.tenantId,
    resourceType: input.resourceType,
    action: input.action,
    actor: input.actor,
    changes: defaultRedactor.redact(input.changes) as Record<string, unknown>,
    occurredAt: input.occurredAt,
    correlationId: input.correlationId,
    ...gsi8,
  };
}

export function appendTenantAuditToTransaction(tx: TransactWriteEntry[], tableName: string, event: TenantAuditEvent): void {
  tx.push({
    Put: {
      TableName: tableName,
      Item: { ...event },
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    },
  });
}

/** Lock item de idempotência do export (D-149 decisão 5): PK usa SOMENTE exportRequestId,
 * nunca timestamp - um retry de infraestrutura genuíno com o mesmo Idempotency-Key é
 * deduplicado, mas dois exports legítimos e independentes no mesmo dia (exportRequestId
 * diferentes) nunca colapsam. Chave própria, nunca compartilhada com tenantAuditKey - o lock
 * existe só para o ConditionExpression attribute_not_exists(PK) da transação, não é lido de
 * volta por ninguém. */
export function exportLockKey(tenantId: string, exportRequestId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#EXPORTLOCK#${exportRequestId}`, SK: "LOCK" };
}

export interface ExportLockItem extends EntityKey {
  entityType: "ExportLock";
  tenantId: string;
  exportRequestId: string;
  createdAt: string;
}

export function buildExportLockItem(tenantId: string, exportRequestId: string, createdAt: string): ExportLockItem {
  return {
    ...exportLockKey(tenantId, exportRequestId),
    entityType: "ExportLock",
    tenantId,
    exportRequestId,
    createdAt,
  };
}

export function appendExportLockToTransaction(tx: TransactWriteEntry[], tableName: string, lock: ExportLockItem): void {
  tx.push({
    Put: {
      TableName: tableName,
      Item: { ...lock },
      ConditionExpression: "attribute_not_exists(PK)",
    },
  });
}
