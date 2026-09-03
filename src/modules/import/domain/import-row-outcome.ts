/**
 * ImportRowOutcome — D-192 §6 (fatia 8). Resultado durável por linha do commit, nunca mutado -
 * cada linha grava EXATAMENTE UM registro (`COMMITTED` xor `FAILED`), na MESMA
 * `TransactWriteItems` que tenta (TENTATIVA) ou constata a falha de domínio (FALLBACK) da
 * linha - nunca uma segunda tentativa depois de um destes dois existir. O plano JSONL em si
 * continua imutável em S3 (`ImportJob.planObjectKey`/`planSha256`) - este registro é só o
 * resultado, não uma cópia do plano.
 *
 * PK   TENANT#<tenantId>#IMPORTJOB#<jobId>   (mesma partição lógica do `ImportJob`)
 * SK   ROWOUTCOME#<rowNumber padded a 6 dígitos>
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export type ImportRowOutcomeStatus = "COMMITTED" | "FAILED";

export interface ImportRowOutcome extends EntityKey {
  entityType: "ImportRowOutcome";
  tenantId: string;
  jobId: string;
  rowNumber: number;
  outcome: ImportRowOutcomeStatus;
  /** Só presente quando `outcome === "COMMITTED"` - id da entidade criada (subjectId/
   * documentId/requirementId conforme `ImportJob.targetEntityType`). */
  entityId?: string;
  /** Só presente quando `outcome === "FAILED"` - código de razão estável (mesmo vocabulário de
   * `ImportRowRejectionCode`/reasons de fence, ex. "SUBJECT_REFERENCE_NOT_FOUND",
   * "DOCUMENT_TYPE_NOT_ACTIVE", "EXTERNAL_ID_ALREADY_EXISTS"). */
  failureReason?: string;
  createdAt: string;
}

function padRowNumber(rowNumber: number): string {
  return String(rowNumber).padStart(6, "0");
}

export function importRowOutcomeKey(tenantId: string, jobId: string, rowNumber: number): EntityKey {
  return { PK: `TENANT#${tenantId}#IMPORTJOB#${jobId}`, SK: `ROWOUTCOME#${padRowNumber(rowNumber)}` };
}

export function buildCommittedRowOutcome(tenantId: string, jobId: string, rowNumber: number, entityId: string, now: string): ImportRowOutcome {
  return {
    ...importRowOutcomeKey(tenantId, jobId, rowNumber),
    entityType: "ImportRowOutcome",
    tenantId,
    jobId,
    rowNumber,
    outcome: "COMMITTED",
    entityId,
    createdAt: now,
  };
}

export function buildFailedRowOutcome(tenantId: string, jobId: string, rowNumber: number, failureReason: string, now: string): ImportRowOutcome {
  return {
    ...importRowOutcomeKey(tenantId, jobId, rowNumber),
    entityType: "ImportRowOutcome",
    tenantId,
    jobId,
    rowNumber,
    outcome: "FAILED",
    failureReason,
    createdAt: now,
  };
}
