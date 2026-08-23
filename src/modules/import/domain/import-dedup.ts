/**
 * Registro de dedupe de import — M11 (D-042). `Put attribute_not_exists` na MESMA transação
 * da entidade final que ele protege (`TrackedSubject`, v1) - chave forte por `externalId`
 * quando a coluna existe no CSV; fallback fraco por `displayNameNormalized` é feito por uma
 * leitura prévia (GSI7, já existe) no worker, não por um segundo tipo de registro de dedup
 * aqui (esse fallback é "melhor esforço", não pode ser garantido atomicamente do mesmo jeito).
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export interface ImportDedupRecord extends EntityKey {
  entityType: "ImportDedupRecord";
  tenantId: string;
  externalId: string;
  subjectId: string;
  createdAt: string;
}

export function importDedupKey(tenantId: string, externalId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#IMPORTDEDUP#SUBJECT`, SK: `EXT#${externalId}` };
}
