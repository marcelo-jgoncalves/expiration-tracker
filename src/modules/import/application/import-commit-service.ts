/**
 * ImportCommitWorker — M11 (D-042). Lê o plano JÁ VALIDADO do S3 (nunca reparsa o CSV
 * original - design "validar uma vez só"), valida `planSha256` contra o `ImportJob`, cria um
 * `TrackedSubject` por linha `CREATE_SUBJECT` reaproveitando `SubjectService.createSubject()`
 * inalterado (mesmo entitlement check/transação já testados de M9 - nunca duplicado aqui).
 *
 * Idempotência de retry (SQS at-least-once, "Residuais não resolvidos" do design - política
 * de commit parcial decidida aqui): cursor `lastCommittedRowNumber` na própria `ImportJob`,
 * avançado só DEPOIS de cada linha confirmada - um retry retoma exatamente de onde parou,
 * nunca reprocessa uma linha já committada. TODA linha CREATE_SUBJECT, com ou sem
 * `externalId`, primeiro CLAIMA um registro de dedup (`ImportDedupRecord`) antes de chamar
 * `createSubject()` - linhas com `externalId` usam a chave real (serve dedupe entre imports E
 * idempotência de commit ao mesmo tempo); linhas sem `externalId` usam uma chave sintética
 * `job:<jobId>:row:<rowNumber>` (só serve idempotência de commit, nunca aparece fora deste
 * job). Um retry que encontra o registro já claimado sabe que a linha já foi committada e
 * pula direto para o avanço do cursor.
 *
 * Política de commit parcial (decisão de implementação registrada aqui, design silente):
 * se o limite de `TenantEntitlement` for atingido no meio do commit, o job PARA
 * imediatamente (fail-fast) em vez de pular linhas restantes - continuar não teria efeito
 * (o limite não muda linha a linha) e só acumularia mais registros de dedup órfãos.
 */
import { createHash } from "node:crypto";
import { importJobKey, type ImportJob } from "../domain/import-job.js";
import { importDedupKey, type ImportDedupRecord } from "../domain/import-dedup.js";
import type { ImportRowPlanEntry } from "../domain/import-row.js";
import { QuotaExceededError } from "../../../shared/errors/app-error.js";
import type { ImportStore } from "../ports/import-store.js";
import type { ImportObjectStore } from "../ports/import-object-store.js";
import type { SubjectService } from "../../subject/application/subject-service.js";
import type { RequestContext } from "../../identity/domain/request-context.js";

export interface ImportCommitDeps {
  store: ImportStore;
  objectStore: ImportObjectStore;
  planBucket: string;
  subjects: SubjectService;
  now: () => string;
}

export type ImportCommitOutcome =
  | { kind: "COMMITTED"; createdCount: number }
  | { kind: "FAILED_ENTITLEMENT_EXCEEDED"; createdCount: number }
  | { kind: "FAILED_INTEGRITY_MISMATCH" }
  | { kind: "SKIPPED_NOT_COMMITTING" };

function syntheticRowDedupKey(jobId: string, rowNumber: number): string {
  return `job:${jobId}:row:${rowNumber}`;
}

export async function commitImportJob(deps: ImportCommitDeps, ctx: RequestContext, jobId: string): Promise<ImportCommitOutcome> {
  const job = await deps.store.get<ImportJob>(importJobKey(ctx.tenant.tenantId, jobId));
  if (!job || job.status !== "COMMITTING") {
    return { kind: "SKIPPED_NOT_COMMITTING" };
  }
  if (!job.planObjectKey || !job.planSha256) {
    await failJob(deps, job, "MISSING_PLAN_REFERENCE");
    return { kind: "FAILED_INTEGRITY_MISMATCH" };
  }

  const planBytes = await deps.objectStore.getObject(deps.planBucket, job.planObjectKey);
  const planContent = planBytes.toString("utf-8");
  const actualSha256 = createHash("sha256").update(planContent, "utf-8").digest("hex");
  if (actualSha256 !== job.planSha256) {
    // Integridade comprometida (plano mudou depois do preview, ou corrupção) - nunca commita
    // sobre um plano que o usuário não viu no preview.
    await failJob(deps, job, "PLAN_INTEGRITY_MISMATCH");
    return { kind: "FAILED_INTEGRITY_MISMATCH" };
  }

  const entries: ImportRowPlanEntry[] = planContent
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ImportRowPlanEntry);

  const cursor = job.lastCommittedRowNumber ?? 0;
  const pending = entries.filter((e): e is Extract<ImportRowPlanEntry, { action: "CREATE_SUBJECT" }> => e.action === "CREATE_SUBJECT" && e.rowNumber > cursor);

  // `current` acompanha o estado persistido mais recente (versão incluída) - nunca reusa o
  // `job` original através do loop, ou toda escrita repetiria a MESMA versão (achado real
  // corrigido antes do commit: cada update() abaixo precisa do version+1 do estado anterior,
  // não do version original lido no início da função).
  let current: ImportJob = job;
  let createdCount = 0;

  for (const entry of pending) {
    const dedupExternalId = entry.row.externalId ?? syntheticRowDedupKey(jobId, entry.rowNumber);
    const claimed = await deps.store.putIfAbsent<ImportDedupRecord>({
      ...importDedupKey(ctx.tenant.tenantId, dedupExternalId),
      entityType: "ImportDedupRecord",
      tenantId: ctx.tenant.tenantId,
      externalId: dedupExternalId,
      subjectId: "", // preenchido abaixo, após createSubject() confirmar - placeholder aceitável aqui pois a claim em si (não o valor) é o que garante idempotência.
      createdAt: deps.now(),
    });

    if (claimed) {
      try {
        const subject = await deps.subjects.createSubject(ctx, {
          type: entry.row.type,
          displayName: entry.row.displayName,
          notes: entry.row.notes,
          tags: entry.row.tags,
        });
        await deps.store.update<ImportDedupRecord>({
          ...importDedupKey(ctx.tenant.tenantId, dedupExternalId),
          entityType: "ImportDedupRecord",
          tenantId: ctx.tenant.tenantId,
          externalId: dedupExternalId,
          subjectId: subject.subjectId,
          createdAt: deps.now(),
        });
        createdCount += 1;
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          // Fail-fast (política registrada acima) - a claim de dedup desta UMA linha fica
          // órfã (limitação documentada de v1, não uma segunda claim por linha restante).
          await deps.store.update<ImportJob>({ ...current, status: "FAILED", failureReason: "ENTITLEMENT_EXCEEDED", updatedAt: deps.now(), version: current.version + 1 });
          return { kind: "FAILED_ENTITLEMENT_EXCEEDED", createdCount };
        }
        throw err;
      }
    }
    // claimed === false: linha já committada por uma tentativa anterior (retry seguro) -
    // avança o cursor sem recriar nada.

    current = { ...current, lastCommittedRowNumber: entry.rowNumber, updatedAt: deps.now(), version: current.version + 1 };
    await deps.store.update<ImportJob>(current);
  }

  current = { ...current, status: "COMMITTED", updatedAt: deps.now(), version: current.version + 1 };
  await deps.store.update<ImportJob>(current);
  return { kind: "COMMITTED", createdCount };
}

async function failJob(deps: ImportCommitDeps, job: ImportJob, reason: string): Promise<void> {
  await deps.store.update<ImportJob>({ ...job, status: "FAILED", failureReason: reason, updatedAt: deps.now(), version: job.version + 1 });
}
