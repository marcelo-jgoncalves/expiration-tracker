/**
 * ImportCommitWorker — M11 (D-042), generalizado em D-192 §6 (fatia 8) para `Document`/
 * `Requirement` além do `TrackedSubject` original. Lê o plano JÁ VALIDADO do S3 (nunca reparsa
 * o CSV original - design "validar uma vez só"), valida `planSha256` contra o `ImportJob`,
 * então ramifica em `job.targetEntityType` - cada ramo tem sua própria mecânica de
 * atomicidade/idempotência por linha, descritas abaixo.
 *
 * === TrackedSubject (M11/D-042, INALTERADO nesta fatia - guarda de regressão) ===
 *
 * Cria um `TrackedSubject` por linha `CREATE_SUBJECT` reaproveitando
 * `SubjectService.createSubject()` inalterado (mesmo entitlement check/transação já testados de
 * M9 - nunca duplicado aqui). Idempotência de retry (SQS at-least-once): cursor
 * `lastCommittedRowNumber` na própria `ImportJob`, avançado só DEPOIS de cada linha confirmada.
 * TODA linha CREATE_SUBJECT, com ou sem `externalId`, primeiro CLAIMA um `ImportDedupRecord`
 * (chave real quando há `externalId`, chave sintética `job:<jobId>:row:<rowNumber>` quando não
 * há) ANTES de chamar `createSubject()` - por isso esse caminho não pode usar o protocolo de
 * duas transações abaixo (a claim e a criação são DUAS chamadas separadas ao store, não uma
 * `TransactWriteItems` só, porque `createSubject()` é uma caixa-preta com seu próprio
 * entitlement-check/transação — D-192 §6 registra isso deliberadamente como fora desta fatia).
 * Política de commit parcial: se o limite de `TenantEntitlement` for atingido no meio do
 * commit, o job PARA imediatamente (fail-fast).
 *
 * === Document/Requirement (D-192 §6, NOVO nesta fatia) ===
 *
 * `buildCreateDocumentEntries()`/`buildCreateRequirementEntries()` (planejadores PUROS de
 * `document-archive-service.ts`, D-192 §5/slices 2-3) recebem `subjectId`/`documentTypeId` JÁ
 * RESOLVIDOS e CONGELADOS no plano (fatia 7) - nenhuma segunda resolução de referência acontece
 * aqui. Cada linha é UMA `TransactWriteItems` (TENTATIVA) contendo: as entries da entidade
 * (fences de domínio + Put) + Put(`ImportDedupRecord`, `attribute_not_exists`, só quando a
 * linha tem `externalId` - §7) + Put(`ImportRowOutcome` COMMITTED, `attribute_not_exists`,
 * `entityId=<gerado antes da transação>`) + Update(cursor, `expectedVersion`) - tudo isso via
 * `executeTenantBusinessMutation`, que sempre acrescenta o fence de tenant por ÚLTIMO.
 *
 * Se a transação cancela por um fence de DOMÍNIO (Subject arquivado/deletado entre preview e
 * commit - um TOCTOU real, §8/§6 do design; DocumentType despublicado; nome de Requirement
 * colidindo) ou pela claim de dedupe (`externalId` já usado para este Subject por um import
 * anterior), uma SEGUNDA `TransactWriteItems` (FALLBACK) grava só Put(`ImportRowOutcome` FAILED,
 * `attribute_not_exists`, `failureReason=<código>`) + Update(cursor) - a linha fica marcada como
 * falha PERMANENTE (nunca re-tentada; um resume futuro pula por causa do cursor, que já avançou
 * nesta mesma transação de fallback), e o job CONTINUA para a próxima linha em vez de abortar.
 *
 * Um crash antes de qualquer transação não deixa rastro (linha permanece `rowNumber > cursor`,
 * reprocessada do zero no próximo run). Um crash depois de uma das duas transações committar é
 * indistinguível de sucesso do ponto de vista do cliente que fez a chamada - mas como
 * entidade+dedupe+outcome+cursor avançam ATOMICAMENTE na MESMA `TransactWriteItems`, um retry
 * simplesmente filtra a linha pelo cursor já avançado (nunca reexecuta, nunca duplica). A
 * corrida de cursor entre duas tentativas concorrentes da MESMA linha (`Update` perdedor falha
 * por `expectedVersion`) é tratada relendo o job: se `lastCommittedRowNumber >= rowNumber`, o
 * resultado desta tentativa é descartado sem duplicar `ImportRowOutcome` nem regredir o cursor
 * (§6, último parágrafo); caso contrário (staleness genuína por outra causa), a MESMA linha é
 * re-tentada uma vez com a versão fresca antes de desistir.
 */
import { createHash } from "node:crypto";
import { importJobKey, type ImportJob } from "../domain/import-job.js";
import { importDedupKey, type ImportDedupRecord, type ImportDedupEntityKind } from "../domain/import-dedup.js";
import { buildCommittedRowOutcome, buildFailedRowOutcome } from "../domain/import-row-outcome.js";
import type { ImportRowPlanEntry, DocumentImportRowPlanEntry, RequirementImportRowPlanEntry } from "../domain/import-row.js";
import { QuotaExceededError, TenantNotActiveError } from "../../../shared/errors/app-error.js";
import { buildVersionedUpdate, getCancellationReasonCodes, isTransactionCanceled, type TransactWriteEntry } from "../../../shared/dynamodb/occ.js";
import { executeTenantBusinessMutation } from "../../../shared/tenant-lifecycle/tenant-business-mutation.js";
import type { ImportStore } from "../ports/import-store.js";
import type { ImportObjectStore } from "../ports/import-object-store.js";
import type { SubjectService } from "../../subject/application/subject-service.js";
import { buildCreateDocumentEntries, buildCreateRequirementEntries, type TransactEntryLabel } from "../../document-archive/application/document-archive-service.js";
import type { DocumentArchiveIdGenerator } from "../../document-archive/application/id-generator.js";
import type { RequestContext } from "../../identity/domain/request-context.js";

export interface ImportCommitDeps {
  store: ImportStore;
  objectStore: ImportObjectStore;
  planBucket: string;
  /** D-192 §6 (fatia 8) - só usado pelos ramos Document/Requirement (as próprias entries
   * `Put`/`Update`/`ConditionCheck` dos planejadores de document-archive precisam do
   * `TableName`); o ramo TrackedSubject nunca toca este campo, exatamente como antes. */
  tableName: string;
  subjects: SubjectService;
  /** D-192 §6 (fatia 8) - só usado pelos ramos Document/Requirement, para gerar `documentId`/
   * `requirementId` ANTES de montar a transação (ao contrário de `createSubject()`, que os gera
   * internamente como caixa-preta). */
  documentArchiveIds: DocumentArchiveIdGenerator;
  now: () => string;
}

export type ImportCommitOutcome =
  | { kind: "COMMITTED"; createdCount: number }
  | { kind: "FAILED_ENTITLEMENT_EXCEEDED"; createdCount: number }
  | { kind: "FAILED_INTEGRITY_MISMATCH" }
  | { kind: "FAILED_TENANT_NOT_ACTIVE"; createdCount: number }
  | { kind: "SKIPPED_NOT_COMMITTING" };

function syntheticRowDedupKey(jobId: string, rowNumber: number): string {
  return `job:${jobId}:row:${rowNumber}`;
}

async function failJob(deps: ImportCommitDeps, job: ImportJob, reason: string): Promise<void> {
  await deps.store.update<ImportJob>({ ...job, status: "FAILED", failureReason: reason, updatedAt: deps.now(), version: job.version + 1 });
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

  const rawEntries: Array<Record<string, unknown>> = planContent
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);

  if (job.targetEntityType === "Document") {
    return commitReferencingRows(deps, ctx, job, rawEntries as unknown as DocumentImportRowPlanEntry[], "Document");
  }
  if (job.targetEntityType === "Requirement") {
    return commitReferencingRows(deps, ctx, job, rawEntries as unknown as RequirementImportRowPlanEntry[], "Requirement");
  }
  return commitTrackedSubjectRows(deps, ctx, job, rawEntries as unknown as ImportRowPlanEntry[]);
}

/** TrackedSubject commit path - byte-for-byte the same logic M11/D-042 shipped, only realocated
 * into its own function so `commitImportJob()` can branch on `targetEntityType` (D-192 §6). */
async function commitTrackedSubjectRows(deps: ImportCommitDeps, ctx: RequestContext, job: ImportJob, entries: ImportRowPlanEntry[]): Promise<ImportCommitOutcome> {
  const jobId = job.jobId;
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
      ...importDedupKey(ctx.tenant.tenantId, "SUBJECT", dedupExternalId),
      entityType: "ImportDedupRecord",
      tenantId: ctx.tenant.tenantId,
      kind: "SUBJECT",
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
          ...importDedupKey(ctx.tenant.tenantId, "SUBJECT", dedupExternalId),
          entityType: "ImportDedupRecord",
          tenantId: ctx.tenant.tenantId,
          kind: "SUBJECT",
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

/** Maps a planner's structural `TransactEntryLabel` (the fence/pointer that failed inside the
 * entity-creation entries) to the stable `ImportRowOutcome.failureReason` code this row should
 * be recorded under - D-192 §6/§8. `undefined` means the label at this index is the entity's
 * own `Put` (e.g. `{kind:"DOCUMENT"}`/`{kind:"REQUIREMENT"}`), whose `ConditionalCheckFailed`
 * would mean a freshly-generated id collided (astronomically unlikely, ULIDs) - still handled,
 * never crashes the job, just a generic reason. */
function domainFenceFailureReason(label: TransactEntryLabel): string {
  switch (label.kind) {
    case "SUBJECT_FENCE":
      // Same reason code the preview's reference-resolution phase (fatia 5/7) already uses for
      // an unresolvable subjectRef - a Subject archived/deleted BETWEEN preview and commit
      // (real TOCTOU, §6/§8) is indistinguishable in effect from "reference never resolved" to
      // the operator, so it gets the same code rather than a parallel vocabulary.
      return "SUBJECT_REFERENCE_NOT_FOUND";
    case "DOCUMENT_TYPE_FENCE":
      return "DOCUMENT_TYPE_NOT_FOUND";
    case "POINTER":
      return "REQUIREMENT_NAME_ALREADY_EXISTS";
    default:
      return "ROW_COMMIT_CONFLICT";
  }
}

interface PlannedRow {
  rowNumber: number;
  entityId: string;
  subjectId: string;
  externalId: string | undefined;
  entries: TransactWriteEntry[];
  labels: TransactEntryLabel[];
}

/** Shared commit path for `Document`/`Requirement` (D-192 §6, fatia 8) - both target types use
 * the exact same two-transaction TENTATIVA/FALLBACK protocol; only how the row's `entries`/
 * `labels`/ids are built differs (`buildCreateDocumentEntries`/`buildCreateRequirementEntries`),
 * so that construction is the single per-type branch, everything else below is generic. */
async function commitReferencingRows(
  deps: ImportCommitDeps,
  ctx: RequestContext,
  job: ImportJob,
  entries: Array<DocumentImportRowPlanEntry | RequirementImportRowPlanEntry>,
  targetEntityType: "Document" | "Requirement",
): Promise<ImportCommitOutcome> {
  const tenantId = ctx.tenant.tenantId;
  const dedupKind: ImportDedupEntityKind = targetEntityType === "Document" ? "DOCUMENT" : "REQUIREMENT";
  const createAction = targetEntityType === "Document" ? "CREATE_DOCUMENT" : "CREATE_REQUIREMENT";

  const cursor = job.lastCommittedRowNumber ?? 0;
  const pending = entries.filter((e) => e.action === createAction && e.rowNumber > cursor);

  let current: ImportJob = job;
  let createdCount = 0;

  for (const entry of pending) {
    if (entry.action !== createAction) continue; // narrows the union for TS below
    const planned = buildPlannedRow(deps, tenantId, entry, targetEntityType);
    const result = await attemptRow(deps, ctx, current, planned, dedupKind);
    current = result.job;
    if (result.committed) createdCount += 1;
    if (result.tenantNotActive) {
      await failJob(deps, current, "TENANT_NOT_ACTIVE");
      return { kind: "FAILED_TENANT_NOT_ACTIVE", createdCount };
    }
  }

  current = { ...current, status: "COMMITTED", updatedAt: deps.now(), version: current.version + 1 };
  await deps.store.update<ImportJob>(current);
  return { kind: "COMMITTED", createdCount };
}

function buildPlannedRow(deps: ImportCommitDeps, tenantId: string, entry: DocumentImportRowPlanEntry | RequirementImportRowPlanEntry, targetEntityType: "Document" | "Requirement"): PlannedRow {
  const now = deps.now();
  if (targetEntityType === "Document") {
    const documentEntry = entry as DocumentImportRowPlanEntry & { action: "CREATE_DOCUMENT" };
    const documentId = deps.documentArchiveIds.newDocumentId();
    const { entries, labels } = buildCreateDocumentEntries({
      tableName: deps.tableName,
      tenantId,
      documentId,
      subjectId: documentEntry.subjectId,
      documentTypeId: documentEntry.documentTypeId,
      hasValidity: documentEntry.row.hasValidity,
      now,
    });
    return { rowNumber: documentEntry.rowNumber, entityId: documentId, subjectId: documentEntry.subjectId, externalId: documentEntry.row.externalId, entries, labels };
  }
  const requirementEntry = entry as RequirementImportRowPlanEntry & { action: "CREATE_REQUIREMENT" };
  const requirementId = deps.documentArchiveIds.newRequirementId();
  const { entries, labels } = buildCreateRequirementEntries({
    tableName: deps.tableName,
    tenantId,
    requirementId,
    subjectId: requirementEntry.subjectId,
    name: requirementEntry.row.name,
    notes: requirementEntry.row.notes,
    applicability: requirementEntry.row.applicability,
    now,
  });
  return { rowNumber: requirementEntry.rowNumber, entityId: requirementId, subjectId: requirementEntry.subjectId, externalId: requirementEntry.row.externalId, entries, labels };
}

function buildCursorUpdate(deps: ImportCommitDeps, tenantId: string, job: ImportJob, rowNumber: number): TransactWriteEntry {
  return {
    Update: buildVersionedUpdate({
      tableName: deps.tableName,
      key: importJobKey(tenantId, job.jobId),
      tenantId,
      expectedVersion: job.version,
      set: { lastCommittedRowNumber: rowNumber },
      now: deps.now(),
    }),
  };
}

interface AttemptResult {
  job: ImportJob;
  committed: boolean;
  tenantNotActive?: boolean;
}

/** Runs the TENTATIVA transaction for one row; on a domain-fence/dedup cancellation, runs the
 * FALLBACK transaction; on a same-row cursor race, re-reads and either discards (already handled
 * by a concurrent winner) or retries once with a fresh version - D-192 §6. */
async function attemptRow(deps: ImportCommitDeps, ctx: RequestContext, job: ImportJob, planned: PlannedRow, dedupKind: ImportDedupEntityKind, retried = false): Promise<AttemptResult> {
  const tenantId = ctx.tenant.tenantId;
  const now = deps.now();

  const dedupLabelIndex = planned.entries.length;
  const outcomeLabelIndex = planned.externalId !== undefined ? dedupLabelIndex + 1 : dedupLabelIndex;
  const cursorLabelIndex = outcomeLabelIndex + 1;

  const tentativaEntries: TransactWriteEntry[] = [...planned.entries];
  if (planned.externalId !== undefined) {
    tentativaEntries.push({
      Put: {
        TableName: deps.tableName,
        Item: {
          ...importDedupKey(tenantId, dedupKind, planned.externalId, planned.subjectId),
          entityType: "ImportDedupRecord",
          tenantId,
          kind: dedupKind,
          externalId: planned.externalId,
          subjectId: planned.subjectId,
          entityId: planned.entityId,
          createdAt: now,
        },
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      },
    });
  }
  tentativaEntries.push({
    Put: {
      TableName: deps.tableName,
      Item: buildCommittedRowOutcome(tenantId, job.jobId, planned.rowNumber, planned.entityId, now) as unknown as Record<string, unknown>,
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    },
  });
  tentativaEntries.push(buildCursorUpdate(deps, tenantId, job, planned.rowNumber));

  try {
    await executeTenantBusinessMutation({ store: deps.store, tableName: deps.tableName, tenantId, entries: tentativaEntries });
    return { job: { ...job, lastCommittedRowNumber: planned.rowNumber, updatedAt: now, version: job.version + 1 }, committed: true };
  } catch (err) {
    if (err instanceof TenantNotActiveError) {
      return { job, committed: false, tenantNotActive: true };
    }
    if (!isTransactionCanceled(err)) throw err;

    const codes = getCancellationReasonCodes(err) ?? [];
    const failedAt = (index: number) => codes[index] === "ConditionalCheckFailed";

    // Cursor race (§6 last paragraph): the loser's cursor Update failed on `expectedVersion` -
    // re-read to tell "another attempt already committed THIS row" (discard, no duplicate)
    // from "version drifted for an unrelated reason" (retry this same row once, fresh version).
    if (failedAt(cursorLabelIndex)) {
      const fresh = await deps.store.get<ImportJob>(importJobKey(tenantId, job.jobId));
      const freshJob = fresh ?? job;
      if ((freshJob.lastCommittedRowNumber ?? 0) >= planned.rowNumber) {
        return { job: freshJob, committed: false };
      }
      if (!retried) return attemptRow(deps, ctx, freshJob, planned, dedupKind, true);
      throw err;
    }

    // The ImportRowOutcome Put itself was already claimed - same concurrent-retry race as the
    // cursor case above, just observed at a different index; the invariant is identical
    // (cursor+outcome+entity always commit together, so if outcome already exists the row was
    // already handled and there is nothing left to do here).
    if (failedAt(outcomeLabelIndex)) {
      const fresh = await deps.store.get<ImportJob>(importJobKey(tenantId, job.jobId));
      return { job: fresh ?? job, committed: false };
    }

    // Business dedup collision (§7 - externalId already used for this Subject by a prior
    // import) or a domain fence (Subject archived/deleted since preview, DocumentType
    // deprecated, Requirement name collision) - both are permanent per-row failures: record
    // FAILED in the ledger via the FALLBACK transaction and move on, never abort the job.
    let failureReason = "ROW_COMMIT_CONFLICT";
    if (failedAt(dedupLabelIndex) && planned.externalId !== undefined) {
      failureReason = "EXTERNAL_ID_ALREADY_EXISTS";
    } else {
      const failedLabel = planned.labels.find((_, index) => failedAt(index));
      if (failedLabel) failureReason = domainFenceFailureReason(failedLabel);
    }

    return runFallback(deps, ctx, job, planned, failureReason);
  }
}

/** FALLBACK transaction (D-192 §6): records the row as permanently FAILED and advances the
 * cursor past it - never retried again, never left silently dropped. */
async function runFallback(deps: ImportCommitDeps, ctx: RequestContext, job: ImportJob, planned: PlannedRow, failureReason: string, retried = false): Promise<AttemptResult> {
  const tenantId = ctx.tenant.tenantId;
  const now = deps.now();
  const fallbackEntries: TransactWriteEntry[] = [
    {
      Put: {
        TableName: deps.tableName,
        Item: buildFailedRowOutcome(tenantId, job.jobId, planned.rowNumber, failureReason, now) as unknown as Record<string, unknown>,
        ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
      },
    },
    buildCursorUpdate(deps, tenantId, job, planned.rowNumber),
  ];

  try {
    await executeTenantBusinessMutation({ store: deps.store, tableName: deps.tableName, tenantId, entries: fallbackEntries });
    return { job: { ...job, lastCommittedRowNumber: planned.rowNumber, updatedAt: now, version: job.version + 1 }, committed: false };
  } catch (err) {
    if (err instanceof TenantNotActiveError) return { job, committed: false, tenantNotActive: true };
    if (!isTransactionCanceled(err)) throw err;

    const codes = getCancellationReasonCodes(err) ?? [];
    // Index 0 = ImportRowOutcome Put, index 1 = cursor Update (fixed 2-entry FALLBACK layout).
    const fresh = await deps.store.get<ImportJob>(importJobKey(tenantId, job.jobId));
    const freshJob = fresh ?? job;
    if ((freshJob.lastCommittedRowNumber ?? 0) >= planned.rowNumber) {
      // A concurrent attempt already recorded an outcome for this row (committed or failed) -
      // discard, no duplicate ImportRowOutcome, no cursor regression.
      return { job: freshJob, committed: false };
    }
    if (codes[1] === "ConditionalCheckFailed" && !retried) {
      // Cursor version drifted for an unrelated reason - retry the fallback once with a fresh version.
      return runFallback(deps, ctx, freshJob, planned, failureReason, true);
    }
    throw err;
  }
}
