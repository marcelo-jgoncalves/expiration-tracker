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
import { buildVersionedUpdate, type EntityKey, type TransactUpdateEntry } from "../../../shared/dynamodb/occ.js";

/**
 * D-192 (bulk-import-documents-requirements-scoping/estado-final-consolidado.md §1): extends
 * v1's `TrackedSubject`-only scope. Um `ImportJob` continua UM tipo de entidade só - onboarding
 * completo é 3 jobs sequenciais (Subjects -> Documents -> Requirements), nunca um arquivo
 * combinado.
 */
export type ImportTargetEntityType = "TrackedSubject" | "Document" | "Requirement";

export type ImportJobStatus =
  | "UPLOADED" // presigned PUT concluído (assumido, S3 não confirma para o backend síncronamente) - aguardando ObjectCreated
  // D-192 §3: novo estado entre UPLOADED e PARSING - alcançado quando o evento S3/trigger de
  // parse chega e `columnMapping` ainda não foi fornecido (`POST /mapping` é uma fatia futura;
  // esta fatia só modela o estado e o claim OCC que entra/sai dele).
  | "AWAITING_MAPPING"
  | "PARSING"
  | "PREVIEW_READY"
  | "COMMITTING"
  | "COMMITTED"
  | "FAILED"
  | "EXPIRED";

/**
 * D-192 §2: substitui o `mappingVersion: number` morto (nunca lido em runtime) por uma união
 * discriminada real. `targetKind` é redundante com `ImportJob.targetEntityType` POR DESIGN
 * defensivo (um handler HTTP futuro rejeita 400 se divergirem) - nunca fonte de verdade
 * independente. `FIELD_CATALOG`/validação de obrigatoriedade por campo (schema HTTP) ficam para
 * a fatia que adicionar `GET /schema`/`POST /mapping` - aqui só o shape de domínio.
 */
export type ColumnMapping =
  | {
      schemaVersion: 1;
      targetKind: "TrackedSubject";
      columns: { displayName: string; type: string; externalId?: string; notes?: string; tags?: string };
    }
  | {
      schemaVersion: 1;
      targetKind: "Document";
      columns: {
        subjectRef: string;
        subjectRefKind: "EXTERNAL_ID" | "SUBJECT_ID";
        documentTypeRef: string;
        documentTypeRefKind: "DOCUMENT_TYPE_ID" | "DISPLAY_NAME";
        hasValidity: string;
        externalId?: string;
      };
    }
  | {
      schemaVersion: 1;
      targetKind: "Requirement";
      columns: {
        subjectRef: string;
        subjectRefKind: "EXTERNAL_ID" | "SUBJECT_ID";
        name: string;
        notes?: string;
        applicability?: string;
        externalId?: string;
      };
    };

/** Mapeamento fixo v1 de `TrackedSubject` (D-042's CSV header convention) - preenchido pelo
 * `ImportService.reserveImport()` NA CRIAÇÃO do job, nunca deixado para `AWAITING_MAPPING`
 * (backward compat explícito do design §3: um job `TrackedSubject` sempre tem `columnMapping`
 * presente, então o trigger de parse vai direto UPLOADED->PARSING, exatamente como hoje). */
export const DEFAULT_TRACKED_SUBJECT_COLUMN_MAPPING: ColumnMapping = {
  schemaVersion: 1,
  targetKind: "TrackedSubject",
  columns: { displayName: "displayName", type: "type", externalId: "externalId", notes: "notes", tags: "tags" },
};

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
  /** D-192 §2: ausente enquanto o job aguarda mapeamento (`AWAITING_MAPPING`/`UPLOADED` sem
   * mapeamento fornecido ainda) - `TrackedSubject` sempre chega já preenchido (ver
   * `DEFAULT_TRACKED_SUBJECT_COLUMN_MAPPING`), `Document`/`Requirement` dependem de
   * `POST /mapping` (fatia futura) para preenchê-lo. */
  columnMapping?: ColumnMapping;
  /** `canonicalJsonStringify(columnMapping)` hasheado (SHA-256) - só existe quando `columnMapping`
   * existe. Serve o mesmo papel de integridade de `planSha256`: o commit nunca deve aplicar um
   * mapeamento diferente do que o preview mostrou. */
  columnMappingSha256?: string;
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

/**
 * D-192 §3: o claim OCC atômico de entrada/saída de `AWAITING_MAPPING` - "a PRIMEIRA mutação é
 * um Update condicional (version = job.version AND status = <fromStatus>) que É o claim - só um
 * vencedor possível entre entregas concorrentes de QUALQUER combinação de triggers; o perdedor
 * retorna SKIPPED_ALREADY_CLAIMED sem ler S3 nem produzir plano." Modelado como uma transição
 * `fromStatus`->`toStatus` explícita (o chamador já leu `job.status`/`job.version` antes de
 * decidir qual claim tentar) em vez de uma única `ConditionExpression` com `status IN (...)`
 * literal - equivalente em força de OCC (o `#version = :expectedVersion` da base de
 * `buildVersionedUpdate` já é suficiente para rejeitar qualquer gravação concorrente entre a
 * leitura e este `TransactWriteItems`; a condição extra de `status` só torna a intenção do
 * claim explícita e auditável no `ConditionExpression`), e reusável por qualquer transição
 * futura de `ImportJobStatus` que precise do mesmo padrão de claim (não exclusivo desta fatia).
 */
export function buildImportJobClaim(input: {
  tableName: string;
  tenantId: string;
  jobId: string;
  expectedVersion: number;
  fromStatus: ImportJobStatus;
  toStatus: ImportJobStatus;
  set?: Record<string, unknown>;
}): TransactUpdateEntry {
  return {
    Update: buildVersionedUpdate({
      tableName: input.tableName,
      key: importJobKey(input.tenantId, input.jobId),
      tenantId: input.tenantId,
      expectedVersion: input.expectedVersion,
      set: { status: input.toStatus, ...(input.set ?? {}) },
      extraConditions: [
        {
          expression: "#claimStatus = :claimFromStatus",
          names: { "#claimStatus": "status" },
          values: { ":claimFromStatus": input.fromStatus },
        },
      ],
    }),
  };
}
