/**
 * ImportParseWorker — M11 (D-042). Disparado por evento S3 (ObjectCreated no bucket de raw
 * CSVs, nunca quarentena/malware scanning - ver ports/import-object-store.ts). Parse
 * streaming não é literal aqui (todo o arquivo cabe em memória, seguro dado o limite de
 * 5 MiB/5.000 linhas de v1) - "parse streaming" do design refere-se a nunca reparsar depois,
 * não a um parser incremental real.
 *
 * Dedup: forte por `externalId` (contra DynamoDB - já existe de um import anterior - e contra
 * o PRÓPRIO arquivo, linha duplicada dentro do mesmo CSV); fallback fraco por
 * `type+displayNameNormalized` contra os `TrackedSubject` ATIVOS já existentes do tenant
 * (pré-carregados uma vez via GSI7 - o teto de `TenantEntitlement` (25 no plano free) torna
 * isso sempre uma leitura pequena, nunca um scan caro por linha).
 */
import { createHash } from "node:crypto";
import { parseCsv, mapCsvRowsToNamedFields } from "./csv-parser.js";
import {
  validateImportRow,
  extractRawDocumentRow,
  validateDocumentImportRow,
  extractRawRequirementRow,
  validateRequirementImportRow,
  type RawImportRow,
  type ImportRowPlanEntry,
  type DocumentImportRowPlanEntry,
  type RequirementImportRowPlanEntry,
  type ValidatedDocumentImportRow,
  type ValidatedRequirementImportRow,
} from "../domain/import-row.js";
import { normalizeDisplayName, type TrackedSubjectType } from "../../subject/domain/tracked-subject.js";
import { importDedupKey } from "../domain/import-dedup.js";
import { buildImportJobClaim, importJobKey, MAX_IMPORT_FILE_BYTES, MAX_IMPORT_ROWS, type ImportJob } from "../domain/import-job.js";
import { isTransactionCanceled, type ImportStore } from "../ports/import-store.js";
import type { ImportObjectStore } from "../ports/import-object-store.js";
import type { SubjectStore } from "../../subject/ports/subject-store.js";
import type { DocumentArchiveStore } from "../../document-archive/ports/document-archive-store.js";
import type { TenantQuotaService } from "../../identity/application/quota.js";
import { resolveSubjectReferences } from "./resolve-subject-references.js";
import { resolveDocumentTypeReferences } from "./resolve-document-type-references.js";

export interface ImportParseDeps {
  store: ImportStore;
  subjectStore: SubjectStore;
  objectStore: ImportObjectStore;
  rawBucket: string;
  planBucket: string;
  quota: TenantQuotaService;
  tableName: string;
  now: () => string;
  // D-192 (fatia 7): only required for `Document`-targeted jobs (`resolveDocumentTypeReferences()`).
  // Optional so the pre-existing `TrackedSubject`/`Requirement` test fixtures (and the
  // `Requirement` path, which never touches DocumentType) never need to supply it.
  documentArchiveStore?: DocumentArchiveStore;
}

export type ImportParseOutcome =
  | { kind: "PARSED"; totalRows: number; acceptedRows: number; rejectedRows: number; duplicateRows: number }
  | { kind: "SKIPPED_NOT_UPLOADED" }
  // D-192 §3: o job entrou (ou já estava) em AWAITING_MAPPING - nada a parsear ainda, aguarda
  // POST /mapping (fatia futura) preencher `columnMapping` antes de um novo trigger avançar.
  | { kind: "AWAITING_MAPPING" }
  // D-192 §3: o claim OCC (`status IN (UPLOADED, AWAITING_MAPPING) AND version = <lido>`)
  // perdeu para uma entrega concorrente de QUALQUER trigger - nunca lê S3 nem produz plano.
  | { kind: "SKIPPED_ALREADY_CLAIMED" }
  | { kind: "FAILED"; reason: string };

function planObjectKey(tenantId: string, jobId: string): string {
  return `tenant/${tenantId}/imports/${jobId}/plan/page-0.jsonl`;
}

export async function parseImportJob(deps: ImportParseDeps, tenantId: string, jobId: string): Promise<ImportParseOutcome> {
  const job = await deps.store.get<ImportJob>(importJobKey(tenantId, jobId));
  // D-192 §3: dois triggers possíveis (evento S3 e a fila de parse pós-mapping, discriminados
  // só no handler Lambda, nunca aqui) podem chegar em qualquer ordem/concorrência - o claim
  // abaixo é a PRIMEIRA mutação e É o que decide quem vence, nunca uma leitura simples.
  if (!job || (job.status !== "UPLOADED" && job.status !== "AWAITING_MAPPING")) {
    return { kind: "SKIPPED_NOT_UPLOADED" };
  }

  if (!job.columnMapping) {
    // Mapeamento ainda não fornecido - nunca avança para PARSING sem ele. Se já está
    // AWAITING_MAPPING, não há nova mutação a fazer (aguarda POST /mapping, fatia futura).
    if (job.status === "AWAITING_MAPPING") return { kind: "AWAITING_MAPPING" };
    try {
      await deps.store.transactWrite([
        buildImportJobClaim({ tableName: deps.tableName, tenantId, jobId, expectedVersion: job.version, fromStatus: "UPLOADED", toStatus: "AWAITING_MAPPING" }),
      ]);
    } catch (err) {
      if (isTransactionCanceled(err)) return { kind: "SKIPPED_ALREADY_CLAIMED" };
      throw err;
    }
    return { kind: "AWAITING_MAPPING" };
  }

  try {
    await deps.store.transactWrite([
      buildImportJobClaim({ tableName: deps.tableName, tenantId, jobId, expectedVersion: job.version, fromStatus: job.status, toStatus: "PARSING" }),
    ]);
  } catch (err) {
    if (isTransactionCanceled(err)) return { kind: "SKIPPED_ALREADY_CLAIMED" };
    throw err;
  }
  // Estado local pós-claim: version bumped uma vez pelo claim acima - toda escrita subsequente
  // parte DAQUI, nunca do `job` original lido no topo (mesma disciplina do commit worker).
  const claimedJob: ImportJob = { ...job, status: "PARSING", version: job.version + 1 };

  try {
    const rawKey = `tenant/${tenantId}/imports/${jobId}/raw.csv`;
    const bytes = await deps.objectStore.getObject(deps.rawBucket, rawKey);
    if (bytes.byteLength > MAX_IMPORT_FILE_BYTES) {
      return await failJob(deps, tenantId, claimedJob, "FILE_TOO_LARGE");
    }

    const { header, rows } = parseCsv(bytes.toString("utf-8"));
    if (rows.length > MAX_IMPORT_ROWS) {
      return await failJob(deps, tenantId, claimedJob, "TOO_MANY_ROWS");
    }

    const namedRows = mapCsvRowsToNamedFields(header, rows);

    let plan: ImportRowPlanEntry[] | DocumentImportRowPlanEntry[] | RequirementImportRowPlanEntry[];
    let acceptedRows = 0;
    let rejectedRows = 0;
    let duplicateRows = 0;

    if (job.targetEntityType === "TrackedSubject") {
      const rawRows: RawImportRow[] = namedRows.map((r, i) => ({
        rowNumber: i + 1,
        displayName: r["displayname"],
        type: r["type"],
        externalId: r["externalid"],
        notes: r["notes"],
        tags: r["tags"],
      }));

      // Fallback fraco de dedup: pré-carrega TODOS os TrackedSubject ATIVOS do tenant de uma vez
      // (uma única query GSI7, nunca uma leitura por linha - limitado pelo teto do entitlement).
      const existingActive = await deps.subjectStore.queryGsi7<{ PK: string; SK: string; type: TrackedSubjectType; displayNameNormalized: string }>({
        gsi7pk: `TENANT#${tenantId}#SUBJECTSTATUS#ACTIVE`,
      });
      const existingNameKeys = new Set(existingActive.map((s) => `${s.type}|${s.displayNameNormalized}`));

      const seenExternalIdsInFile = new Set<string>();
      const subjectPlan: ImportRowPlanEntry[] = [];

      for (const raw of rawRows) {
        const validated = validateImportRow(raw);
        if ("rejection" in validated) {
          subjectPlan.push({ rowNumber: raw.rowNumber, action: "REJECT", reason: validated.rejection.reason, field: validated.rejection.field });
          rejectedRows += 1;
          continue;
        }

        const row = validated.row;
        if (row.externalId) {
          if (seenExternalIdsInFile.has(row.externalId)) {
            subjectPlan.push({ rowNumber: row.rowNumber, action: "REJECT", reason: "DUPLICATE_EXTERNAL_ID_IN_FILE", field: "externalId" });
            rejectedRows += 1;
            continue;
          }
          seenExternalIdsInFile.add(row.externalId);

          const existingDedup = await deps.store.get(importDedupKey(tenantId, row.externalId));
          if (existingDedup) {
            subjectPlan.push({ rowNumber: row.rowNumber, action: "SKIP_DUPLICATE", reason: "EXTERNAL_ID_ALREADY_EXISTS", externalId: row.externalId, displayName: row.displayName });
            duplicateRows += 1;
            continue;
          }
        } else if (existingNameKeys.has(`${row.type}|${normalizeDisplayName(row.displayName)}`)) {
          subjectPlan.push({ rowNumber: row.rowNumber, action: "SKIP_DUPLICATE", reason: "DISPLAY_NAME_ALREADY_EXISTS", displayName: row.displayName });
          duplicateRows += 1;
          continue;
        }

        subjectPlan.push({ rowNumber: row.rowNumber, action: "CREATE_SUBJECT", row });
        acceptedRows += 1;
      }
      plan = subjectPlan;
    } else if (job.targetEntityType === "Document") {
      const mapping = job.columnMapping;
      if (!mapping || mapping.targetKind !== "Document") throw new Error("COLUMN_MAPPING_TARGET_KIND_MISMATCH");
      if (!deps.documentArchiveStore) throw new Error("DOCUMENT_ARCHIVE_STORE_REQUIRED_FOR_DOCUMENT_IMPORT");
      const documentArchiveStore = deps.documentArchiveStore;
      const columns = mapping.columns;

      const validatedByRow = new Map<number, ValidatedDocumentImportRow>();
      const documentPlan: DocumentImportRowPlanEntry[] = [];
      const seenExternalIdsInFile = new Set<string>();

      for (let i = 0; i < namedRows.length; i++) {
        const raw = extractRawDocumentRow(namedRows[i]!, columns, i + 1);
        const validated = validateDocumentImportRow(raw);
        if ("rejection" in validated) {
          documentPlan.push({ rowNumber: raw.rowNumber, action: "REJECT", reason: validated.rejection.reason, field: validated.rejection.field });
          rejectedRows += 1;
          continue;
        }
        const row = validated.row;
        // D-192 §7: Document has NO weak-fallback natural key - intra-file collision only
        // fires when `externalId` is present, "first wins", second occurrence REJECTs.
        if (row.externalId) {
          if (seenExternalIdsInFile.has(row.externalId)) {
            documentPlan.push({ rowNumber: row.rowNumber, action: "REJECT", reason: "DUPLICATE_IN_FILE", field: "externalId" });
            rejectedRows += 1;
            continue;
          }
          seenExternalIdsInFile.add(row.externalId);
        }
        validatedByRow.set(row.rowNumber, row);
      }

      const distinctSubjectRefs = [...new Set([...validatedByRow.values()].map((r) => r.subjectRef))];
      const distinctDocumentTypeRefs = [...new Set([...validatedByRow.values()].map((r) => r.documentTypeRef))];
      const subjectResolutions = await resolveSubjectReferences(deps.subjectStore, tenantId, columns.subjectRefKind, distinctSubjectRefs);
      const documentTypeResolutions = await resolveDocumentTypeReferences(documentArchiveStore, tenantId, columns.documentTypeRefKind, distinctDocumentTypeRefs);

      for (const row of validatedByRow.values()) {
        const subjectResolution = subjectResolutions.get(row.subjectRef);
        if (!subjectResolution || subjectResolution.kind !== "RESOLVED") {
          documentPlan.push({ rowNumber: row.rowNumber, action: "REJECT", reason: "SUBJECT_REFERENCE_NOT_FOUND", field: "subjectRef" });
          rejectedRows += 1;
          continue;
        }
        const documentTypeResolution = documentTypeResolutions.get(row.documentTypeRef);
        if (!documentTypeResolution || documentTypeResolution.kind !== "RESOLVED") {
          documentPlan.push({ rowNumber: row.rowNumber, action: "REJECT", reason: "DOCUMENT_TYPE_NOT_FOUND", field: "documentTypeRef" });
          rejectedRows += 1;
          continue;
        }
        documentPlan.push({ rowNumber: row.rowNumber, action: "CREATE_DOCUMENT", row, subjectId: subjectResolution.subjectId, documentTypeId: documentTypeResolution.documentTypeId });
        acceptedRows += 1;
      }
      documentPlan.sort((a, b) => a.rowNumber - b.rowNumber);
      plan = documentPlan;
    } else {
      const mapping = job.columnMapping;
      if (!mapping || mapping.targetKind !== "Requirement") throw new Error("COLUMN_MAPPING_TARGET_KIND_MISMATCH");
      const columns = mapping.columns;

      const validatedByRow = new Map<number, ValidatedRequirementImportRow>();
      const requirementPlan: RequirementImportRowPlanEntry[] = [];
      const seenExternalIdsInFile = new Set<string>();

      for (let i = 0; i < namedRows.length; i++) {
        const raw = extractRawRequirementRow(namedRows[i]!, columns, i + 1);
        const validated = validateRequirementImportRow(raw);
        if ("rejection" in validated) {
          requirementPlan.push({ rowNumber: raw.rowNumber, action: "REJECT", reason: validated.rejection.reason, field: validated.rejection.field });
          rejectedRows += 1;
          continue;
        }
        const row = validated.row;
        // D-192 §7: Requirement's weak fallback (subjectId+nameNormalized via
        // RequirementNamePointer) is a COMMIT-time uniqueness concern (D-191 reuse) - this
        // parse-time intra-file check only covers the strong key (`externalId`), same posture
        // as the Document branch above.
        if (row.externalId) {
          if (seenExternalIdsInFile.has(row.externalId)) {
            requirementPlan.push({ rowNumber: row.rowNumber, action: "REJECT", reason: "DUPLICATE_IN_FILE", field: "externalId" });
            rejectedRows += 1;
            continue;
          }
          seenExternalIdsInFile.add(row.externalId);
        }
        validatedByRow.set(row.rowNumber, row);
      }

      const distinctSubjectRefs = [...new Set([...validatedByRow.values()].map((r) => r.subjectRef))];
      const subjectResolutions = await resolveSubjectReferences(deps.subjectStore, tenantId, columns.subjectRefKind, distinctSubjectRefs);

      for (const row of validatedByRow.values()) {
        const subjectResolution = subjectResolutions.get(row.subjectRef);
        if (!subjectResolution || subjectResolution.kind !== "RESOLVED") {
          requirementPlan.push({ rowNumber: row.rowNumber, action: "REJECT", reason: "SUBJECT_REFERENCE_NOT_FOUND", field: "subjectRef" });
          rejectedRows += 1;
          continue;
        }
        requirementPlan.push({ rowNumber: row.rowNumber, action: "CREATE_REQUIREMENT", row, subjectId: subjectResolution.subjectId });
        acceptedRows += 1;
      }
      requirementPlan.sort((a, b) => a.rowNumber - b.rowNumber);
      plan = requirementPlan;
    }

    // IMPORT_ROWS só é conhecido agora (total real de linhas) - checagem fail-closed antes de
    // persistir o plano, mesma disciplina de TenantEntitlement (nunca cria/persiste parcial).
    await deps.quota.consume({ tenantId, quotaType: "IMPORT_ROWS", window: "current", limit: 20000, windowSeconds: 60 * 60 });

    const planContent = plan.map((entry) => JSON.stringify(entry)).join("\n");
    const planSha256 = createHash("sha256").update(planContent, "utf-8").digest("hex");
    const key = planObjectKey(tenantId, jobId);
    await deps.objectStore.putObject(deps.planBucket, key, planContent, "application/x-ndjson");

    await deps.store.update<ImportJob>({
      ...claimedJob,
      status: "PREVIEW_READY",
      totalRows: namedRows.length,
      acceptedRows,
      rejectedRows,
      duplicateRows,
      planObjectKey: key,
      planSha256,
      updatedAt: deps.now(),
      version: claimedJob.version + 1,
    });

    return { kind: "PARSED", totalRows: namedRows.length, acceptedRows, rejectedRows, duplicateRows };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "UNKNOWN_PARSE_ERROR";
    return await failJob(deps, tenantId, claimedJob, reason);
  }
}

async function failJob(deps: ImportParseDeps, tenantId: string, job: ImportJob, reason: string): Promise<ImportParseOutcome> {
  await deps.store.update<ImportJob>({ ...job, status: "FAILED", failureReason: reason, updatedAt: deps.now(), version: job.version + 1 });
  return { kind: "FAILED", reason };
}
