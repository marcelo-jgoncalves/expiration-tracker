/**
 * ImportJob — M11 (roadmap-evolution/09-domain-model-csv-import.md, D-042, cluster 7).
 * Agregado próprio, tenant-owned, coleção sob a própria partição (não sob subject, já que um
 * import não pertence a um subject específico — ele CRIA subjects).
 *
 * Escopo v1 (decisão de implementação, não de arquitetura — "Residuais não resolvidos" do
 * design explicitamente deixa isso para a sessão que implementar): CSV apenas (XLSX fica para
 * depois, per design), importação de `TrackedSubject` apenas (`RequirementAssignment`
 * combinado fica para v2 — začit simples, sem side-table de mapeamento subject-por-linha
 * ainda não resolvida no design). `targetEntityType` já existe no schema para essa extensão
 * futura sem migração.
 *
 * Plano linha-a-linha vive em S3 (`planObjectKey`/`planSha256`), nunca em DynamoDB por linha
 * (design: ADR-0001, custo por item) — este item só guarda o que exige condição/transação:
 * status, totais, referência ao plano.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export type ImportTargetEntityType = "TrackedSubject";

export type ImportJobStatus =
  | "UPLOADED" // presigned PUT concluído (assumido, S3 não confirma para o backend síncronamente) - aguardando ObjectCreated
  | "PARSING"
  | "PREVIEW_READY"
  | "COMMITTING"
  | "COMMITTED"
  | "FAILED"
  | "EXPIRED";

export interface ImportJob extends EntityKey {
  SK: "META";
  entityType: "ImportJob";
  jobId: string;
  tenantId: string;
  targetEntityType: ImportTargetEntityType;
  status: ImportJobStatus;
  createdByUserId: string;
  /** SHA-256 do CSV original (bytes exatos enviados) - usado como parte da chave de
   * idempotência da criação do job (retry/duplo clique com o mesmo arquivo retorna o mesmo
   * jobId) e para o commit worker nunca precisar reabrir/reparsar o CSV original. */
  checksumSha256?: string;
  /** Versão do mapeamento de colunas CSV->campos - v1 tem um único mapeamento fixo
   * (displayName/type/externalId/notes/tags), mas o campo já existe para quando um mapeamento
   * configurável for necessário, sem exigir migração. */
  mappingVersion: number;
  totalRows?: number;
  acceptedRows?: number;
  rejectedRows?: number;
  duplicateRows?: number;
  /** Preenchidos só depois de PARSING concluir - chave do plano JSONL em S3 e seu hash, para
   * o commit worker validar que está lendo exatamente o plano que o preview mostrou. */
  planObjectKey?: string;
  planSha256?: string;
  /** Cursor de progresso do commit (D-042 "Residuais": política de commit parcial não
   * decidida na rodada de design - resolvida aqui como: commit sequencial com cursor,
   * retomável de forma segura após um retry do worker (SQS at-least-once) sem duplicar linhas
   * já committadas. Avança só DEPOIS de cada linha confirmada. */
  lastCommittedRowNumber?: number;
  failureReason?: string;
  /** TTL lógico (não confundir com `purgeAfterTtl` de outras entidades tenantless) - um job
   * nunca commitado expira depois de 7 dias, liberando o operador de decidir manualmente. */
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function importJobKey(tenantId: string, jobId: string): { PK: string; SK: "META" } {
  return { PK: `TENANT#${tenantId}#IMPORTJOB#${jobId}`, SK: "META" };
}

export const IMPORT_JOB_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Limites de v1 (design: "5 MiB / 5.000 linhas por import, ajustável por plano depois"). */
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;
