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
import { validateImportRow, type RawImportRow, type ImportRowPlanEntry } from "../domain/import-row.js";
import { normalizeDisplayName, type TrackedSubjectType } from "../../subject/domain/tracked-subject.js";
import { importDedupKey } from "../domain/import-dedup.js";
import { importJobKey, MAX_IMPORT_FILE_BYTES, MAX_IMPORT_ROWS, type ImportJob } from "../domain/import-job.js";
import type { ImportStore } from "../ports/import-store.js";
import type { ImportObjectStore } from "../ports/import-object-store.js";
import type { SubjectStore } from "../../subject/ports/subject-store.js";
import type { TenantQuotaService } from "../../identity/application/quota.js";

export interface ImportParseDeps {
  store: ImportStore;
  subjectStore: SubjectStore;
  objectStore: ImportObjectStore;
  rawBucket: string;
  planBucket: string;
  quota: TenantQuotaService;
  tableName: string;
  now: () => string;
}

export type ImportParseOutcome =
  | { kind: "PARSED"; totalRows: number; acceptedRows: number; rejectedRows: number; duplicateRows: number }
  | { kind: "SKIPPED_NOT_UPLOADED" }
  | { kind: "FAILED"; reason: string };

function planObjectKey(tenantId: string, jobId: string): string {
  return `tenant/${tenantId}/imports/${jobId}/plan/page-0.jsonl`;
}

export async function parseImportJob(deps: ImportParseDeps, tenantId: string, jobId: string): Promise<ImportParseOutcome> {
  const job = await deps.store.get<ImportJob>(importJobKey(tenantId, jobId));
  if (!job || job.status !== "UPLOADED") {
    return { kind: "SKIPPED_NOT_UPLOADED" };
  }

  const now = deps.now();
  await deps.store.update<ImportJob>({ ...job, status: "PARSING", updatedAt: now });

  try {
    const rawKey = `tenant/${tenantId}/imports/${jobId}/raw.csv`;
    const bytes = await deps.objectStore.getObject(deps.rawBucket, rawKey);
    if (bytes.byteLength > MAX_IMPORT_FILE_BYTES) {
      return await failJob(deps, tenantId, job, "FILE_TOO_LARGE");
    }

    const { header, rows } = parseCsv(bytes.toString("utf-8"));
    if (rows.length > MAX_IMPORT_ROWS) {
      return await failJob(deps, tenantId, job, "TOO_MANY_ROWS");
    }

    const namedRows = mapCsvRowsToNamedFields(header, rows);
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
    const plan: ImportRowPlanEntry[] = [];
    let acceptedRows = 0;
    let rejectedRows = 0;
    let duplicateRows = 0;

    for (const raw of rawRows) {
      const validated = validateImportRow(raw);
      if ("rejection" in validated) {
        plan.push({ rowNumber: raw.rowNumber, action: "REJECT", reason: validated.rejection.reason, field: validated.rejection.field });
        rejectedRows += 1;
        continue;
      }

      const row = validated.row;
      if (row.externalId) {
        if (seenExternalIdsInFile.has(row.externalId)) {
          plan.push({ rowNumber: row.rowNumber, action: "REJECT", reason: "DUPLICATE_EXTERNAL_ID_IN_FILE", field: "externalId" });
          rejectedRows += 1;
          continue;
        }
        seenExternalIdsInFile.add(row.externalId);

        const existingDedup = await deps.store.get(importDedupKey(tenantId, row.externalId));
        if (existingDedup) {
          plan.push({ rowNumber: row.rowNumber, action: "SKIP_DUPLICATE", reason: "EXTERNAL_ID_ALREADY_EXISTS", externalId: row.externalId, displayName: row.displayName });
          duplicateRows += 1;
          continue;
        }
      } else if (existingNameKeys.has(`${row.type}|${normalizeDisplayName(row.displayName)}`)) {
        plan.push({ rowNumber: row.rowNumber, action: "SKIP_DUPLICATE", reason: "DISPLAY_NAME_ALREADY_EXISTS", displayName: row.displayName });
        duplicateRows += 1;
        continue;
      }

      plan.push({ rowNumber: row.rowNumber, action: "CREATE_SUBJECT", row });
      acceptedRows += 1;
    }

    // IMPORT_ROWS só é conhecido agora (total real de linhas) - checagem fail-closed antes de
    // persistir o plano, mesma disciplina de TenantEntitlement (nunca cria/persiste parcial).
    await deps.quota.consume({ tenantId, quotaType: "IMPORT_ROWS", window: "current", limit: 20000, windowSeconds: 60 * 60 });

    const planContent = plan.map((entry) => JSON.stringify(entry)).join("\n");
    const planSha256 = createHash("sha256").update(planContent, "utf-8").digest("hex");
    const key = planObjectKey(tenantId, jobId);
    await deps.objectStore.putObject(deps.planBucket, key, planContent, "application/x-ndjson");

    await deps.store.update<ImportJob>({
      ...job,
      status: "PREVIEW_READY",
      totalRows: rawRows.length,
      acceptedRows,
      rejectedRows,
      duplicateRows,
      planObjectKey: key,
      planSha256,
      updatedAt: deps.now(),
      version: job.version + 1,
    });

    return { kind: "PARSED", totalRows: rawRows.length, acceptedRows, rejectedRows, duplicateRows };
  } catch (err) {
    const reason = err instanceof Error ? err.message : "UNKNOWN_PARSE_ERROR";
    return await failJob(deps, tenantId, job, reason);
  }
}

async function failJob(deps: ImportParseDeps, tenantId: string, job: ImportJob, reason: string): Promise<ImportParseOutcome> {
  await deps.store.update<ImportJob>({ ...job, status: "FAILED", failureReason: reason, updatedAt: deps.now(), version: job.version + 1 });
  return { kind: "FAILED", reason };
}
