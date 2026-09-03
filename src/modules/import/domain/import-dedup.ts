/**
 * Registro de dedupe de import — M11 (D-042), generalizado em D-192 §6/§7 (fatia 8) para
 * cobrir os 3 `ImportTargetEntityType`s (antes só `SUBJECT`). `Put attribute_not_exists` na
 * MESMA transação da entidade final que ele protege - chave forte por `externalId` quando a
 * coluna existe no CSV; fallback fraco (`displayNameNormalized`/`nameNormalized`) é feito por
 * uma leitura prévia (GSI7/RequirementNamePointer, já existem) no worker, não por um segundo
 * tipo de registro de dedup aqui (esse fallback é "melhor esforço", não pode ser garantido
 * atomicamente do mesmo jeito).
 *
 * Chave por tipo (design §2):
 *   SUBJECT               PK TENANT#<tenantId>#IMPORTDEDUP#SUBJECT      SK EXT#<externalId>
 *   DOCUMENT/REQUIREMENT  PK TENANT#<tenantId>#IMPORTDEDUP#<kind>       SK SUBJECT#<subjectId>#EXT#<externalId>
 * Document/Requirement não têm identidade de negócio própria como Subject's externalId 1ª
 * classe - a chave de dedupe deles é escopada ao `subjectId` (já resolvido/congelado no plano)
 * porque o mesmo `externalId` de integração pode legitimamente se repetir entre Subjects
 * diferentes (ex.: "contrato-01" de dois clientes distintos), só não pode se repetir DUAS vezes
 * para o MESMO Subject.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export type ImportDedupEntityKind = "SUBJECT" | "DOCUMENT" | "REQUIREMENT";

export interface ImportDedupRecord extends EntityKey {
  entityType: "ImportDedupRecord";
  tenantId: string;
  kind: ImportDedupEntityKind;
  externalId: string;
  /** SUBJECT: o id do TrackedSubject criado (placeholder `""` no momento da claim - a claim em
   * si, não o valor, é o que garante idempotência - atualizado depois que `createSubject()`
   * confirma, dança de dois passos inalterada de M11/D-042). DOCUMENT/REQUIREMENT: o
   * `subjectId` já resolvido/congelado do plano - o "pai" de chave natural sob o qual o §7
   * dedupa, conhecido ANTES do commit (nunca um placeholder para estes dois tipos). */
  subjectId: string;
  /** Id da entidade criada - só populado para DOCUMENT/REQUIREMENT (documentId/requirementId).
   * Conhecido de antemão (ids são gerados antes da transação de commit rodar, ao contrário de
   * `createSubject()`, que é chamado como caixa-preta DEPOIS da claim) - por isso, ao contrário
   * de SUBJECT, nunca precisa da dança de dois passos (Put único já carrega o valor final). */
  entityId?: string;
  createdAt: string;
}

export function importDedupKey(tenantId: string, kind: ImportDedupEntityKind, externalId: string, subjectId?: string): EntityKey {
  if (kind === "SUBJECT") {
    return { PK: `TENANT#${tenantId}#IMPORTDEDUP#SUBJECT`, SK: `EXT#${externalId}` };
  }
  if (!subjectId) {
    throw new Error(`importDedupKey: subjectId is required for kind=${kind}`);
  }
  return { PK: `TENANT#${tenantId}#IMPORTDEDUP#${kind}`, SK: `SUBJECT#${subjectId}#EXT#${externalId}` };
}
