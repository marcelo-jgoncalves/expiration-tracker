/**
 * ExtractionRun — item-pai de uma execução do pipeline de extração (M7, D-035/
 * `docs/architecture/reviews/m7-extraction-design/claude-reconciliation-final-design.md`,
 * GATE atingido 9,2/9,3). `data-model.md` linha 105: `TENANT#t#DOC#d` / `RUN#<runId>`.
 *
 * Idempotência da EXECUÇÃO (não de cada campo individual): `tenantId|documentId|
 * documentVersion|pipelineVersion` — reexecutar a mesma versão de documento sob a mesma versão
 * de pipeline nunca cria um segundo run (data-model.md linha 101). `runId` em si é derivado
 * dessa mesma chave (determinístico), nunca gerado aleatoriamente, para que uma segunda
 * invocação de `ExtractionStarterWorker` para o mesmo evento S3 encontre o run já existente em
 * vez de criar um duplicado.
 */
import { createHash } from "node:crypto";
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export type ExtractionRunStatus = "RUNNING" | "COMPLETED" | "FAILED" | "DISCARDED";

export interface ExtractionRun extends EntityKey {
  entityType: "ExtractionRun";
  tenantId: string;
  itemId: string;
  documentId: string;
  documentVersion: number;
  runId: string;
  pipelineVersion: string;
  status: ExtractionRunStatus;
  startedAt: string;
  completedAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function extractionRunKey(tenantId: string, documentId: string, runId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#DOC#${documentId}`, SK: `RUN#${runId}` };
}

/** Deterministic runId - reexecuting the same idempotency key (tenantId|documentId|
 * documentVersion|pipelineVersion) always resolves to the same runId, so a second
 * `ExtractionStarterWorker` invocation for a duplicate S3 event (at-least-once delivery)
 * finds the existing run instead of racing to create a second one. Not a security-sensitive
 * value (unlike the guest-token/CSRF hashes elsewhere in this codebase) - no pepper needed,
 * this only needs to be deterministic and collision-resistant. */
export function deriveExtractionRunId(tenantId: string, documentId: string, documentVersion: number, pipelineVersion: string): string {
  const hash = createHash("sha256").update(`${tenantId}|${documentId}|${documentVersion}|${pipelineVersion}`).digest("hex");
  return `run_${hash.slice(0, 32)}`;
}
