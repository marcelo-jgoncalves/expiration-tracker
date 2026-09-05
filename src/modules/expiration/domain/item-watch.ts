/**
 * ItemWatch — 07-domain-model-escalation-watchers-digest.md (D-040). Coleção sob a
 * partição do ExpirationItem (`TENANT#t#ITEM#i`/`WATCH#USER#u`), confirmado como extensão
 * direta de um padrão já em produção: `Document` de M6 já coexiste na mesma partição via
 * `SK=DOC#documentId` (src/modules/document/domain/document.ts). Nunca muta o agregado
 * ExpirationItem (já em produção, versionado) para adicionar/remover watcher.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export type ItemWatchStatus = "ACTIVE" | "REMOVED";

export interface ItemWatch extends EntityKey {
  entityType: "ItemWatch";
  itemId: string;
  tenantId: string;
  userId: string;
  status: ItemWatchStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function itemWatchKey(tenantId: string, itemId: string, userId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#ITEM#${itemId}`, SK: `WATCH#USER#${userId}` };
}

/** Prefixo de SK para listar todos os watchers de um item via Query(PK, begins_with(SK, ...)). */
export const ITEM_WATCH_SK_PREFIX = "WATCH#USER#";

/** D-200 (watcher notification fan-out): teto de watchers ACTIVE por item, justificado pelo
 * teto de 100 ações de `TransactWriteItems` em `dispatchOccurrence()` — 20 watchers + 1
 * assignee = 21 destinatários × 3 itens (NotificationIntent/IdempotencyRecord/OutboxEvent
 * Put) + 3 entradas fixas = 66, com folga real contra o teto de 100. */
export const MAX_ITEM_WATCHERS = 20;
