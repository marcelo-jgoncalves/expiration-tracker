/**
 * DossierExportGenerationWorker — D-205 decisions 5/6/8/9 (Roadmap P1 item 16, fatia 2/3).
 * Consumes `SQS_DOSSIER_EXPORT_V1`, dispatched by `DocumentArchiveService.confirmDossierExport`
 * (bare payload `{runId, subjectId, tenantId}`, same "bare event.data" convention as
 * `SQS_REPORT_SUBSCRIPTION_DELIVERY_V1`/`SQS_REQUIREMENT_EVIDENCE_REFRESH_V1`).
 *
 * Claims `CONFIRMED -> GENERATING` with a lease (same concept as `NotificationAttempt`/the
 * outbox relay lease - a redelivered message while generation is genuinely in flight is a
 * no-op; an expired lease means a previous invocation crashed mid-generation and this one may
 * reclaim it). Re-reads EVERY Requirement in the frozen scope fresh via
 * `DocumentArchiveService.getDossierExportData` (decision 4 - values are never stale) - a
 * Requirement deleted since confirm is silently omitted from the row set, but the mismatch is
 * surfaced to the reader via a note (never silent, distinct from decision 5's SIZE-cap
 * declared-failure path below). If the (still-live) row set exceeds `MAX_DOSSIER_REQUIREMENTS`,
 * generation fails outright (`TOO_LARGE`, decision 5's "sem truncamento silencioso" - the
 * artifact is either complete or not produced, never partial). On success, both the PDF
 * (narrative, `dossier-pdf-builder.ts`) and XLSX (exhaustive, `dossier-xlsx-builder.ts`) are
 * uploaded to S3 before the run is marked `READY`.
 */
import { buildVersionedUpdate, isTransactionCanceled, type EntityKey } from "../../shared/dynamodb/occ.js";
import { authorizedTenantIdFromPersistedEntity } from "../../modules/identity/domain/authorization.js";
import { dossierExportRunKey, type DossierExportRun } from "../../modules/document-archive/domain/dossier-export-run.js";
import type { DocumentArchiveStore } from "../../modules/document-archive/ports/document-archive-store.js";
import type { DossierExportStore } from "../../modules/document-archive/ports/dossier-export-store.js";
import type { DocumentArchiveService } from "../../modules/document-archive/application/document-archive-service.js";
import { buildDossierPdf } from "../../modules/document-archive/application/dossier-pdf-builder.js";
import { buildDossierXlsx } from "../../modules/document-archive/application/dossier-xlsx-builder.js";

/** Proportional cap (judgment call, level 3-4 implementation - design decision 5 requires A
 * cap exist and be enforced as a declared failure, but does not pin an exact number): a dossier
 * covers every Requirement of ONE Subject, not a tenant-wide export, so real-world scope is
 * expected to be far smaller than this. Named so it can be revisited on real evidence, same
 * "gatilho quantitativo nomeado" discipline other proportional caps in this codebase use. */
export const MAX_DOSSIER_REQUIREMENTS = 200;

export interface DossierExportGenerationCommand {
  tenantId: string;
  subjectId: string;
  runId: string;
}

export interface DossierExportGenerationDeps {
  store: Pick<DocumentArchiveStore, "get" | "transactWrite">;
  tableName: string;
  documentArchive: Pick<DocumentArchiveService, "getDossierExportData">;
  exportStore: DossierExportStore;
  now: () => string;
  leaseDurationMs?: number;
}

export type DossierExportGenerationResult =
  | { kind: "RUN_NOT_FOUND" }
  | { kind: "SKIPPED_NOT_CONFIRMED"; status: DossierExportRun["status"] }
  | { kind: "SKIPPED_IN_PROGRESS" }
  | { kind: "SKIPPED_LOST_CLAIM_RACE" }
  | { kind: "ALREADY_RESOLVED"; status: DossierExportRun["status"] }
  | { kind: "TOO_LARGE"; requirementCount: number }
  | { kind: "READY"; requirementCount: number };

export async function processDossierExportGeneration(deps: DossierExportGenerationDeps, command: DossierExportGenerationCommand): Promise<DossierExportGenerationResult> {
  const now = deps.now();
  // `command.tenantId` is an SQS payload field written by `confirmDossierExport` from the
  // `DossierExportRun` row it just persisted — never from client input, same one-hop-removed
  // provenance as the other bare-`{tenantId}` outbox destinations in this codebase.
  const tenantId = authorizedTenantIdFromPersistedEntity(command);
  const key = dossierExportRunKey(tenantId, command.subjectId, command.runId);
  const run = await deps.store.get<DossierExportRun>(key);
  if (!run) return { kind: "RUN_NOT_FOUND" };

  if (run.status === "READY" || run.status === "FAILED" || run.status === "TOO_LARGE") {
    return { kind: "ALREADY_RESOLVED", status: run.status };
  }
  if (run.status === "PREVIEW_READY") {
    // Defensive only - confirmDossierExport is the only dispatcher of this destination, and it
    // never transitions PREVIEW_READY directly to this event without first flipping to
    // CONFIRMED in the SAME transaction. Unreachable in practice, never treated as a retry.
    return { kind: "SKIPPED_NOT_CONFIRMED", status: run.status };
  }
  if (run.status === "GENERATING") {
    const leaseExpired = !run.generatingLeaseExpiresAt || run.generatingLeaseExpiresAt < now;
    if (!leaseExpired) return { kind: "SKIPPED_IN_PROGRESS" };
    // Lease expired - a previous invocation crashed mid-generation. Falls through to reclaim.
  }

  const leaseExpiresAt = new Date(Date.parse(now) + (deps.leaseDurationMs ?? 5 * 60_000)).toISOString();
  const claimed = await tryClaimGenerating(deps, run, leaseExpiresAt, now);
  if (!claimed) return { kind: "SKIPPED_LOST_CLAIM_RACE" };

  const { rows, subjectDisplayName: resolvedSubjectDisplayName } = await deps.documentArchive.getDossierExportData(tenantId, command.subjectId, run.requirementIds);
  const subjectDisplayName = resolvedSubjectDisplayName ?? command.subjectId;

  if (rows.length > MAX_DOSSIER_REQUIREMENTS) {
    await forceUpdateStatus(deps, { ...run, version: claimed.version }, "TOO_LARGE", now, { failureReason: `Scope (${rows.length} requirements) exceeds MAX_DOSSIER_REQUIREMENTS=${MAX_DOSSIER_REQUIREMENTS}.` });
    return { kind: "TOO_LARGE", requirementCount: rows.length };
  }

  const missingCount = run.requirementIds.length - rows.length;
  const truncatedNote = missingCount > 0 ? `${missingCount} requisito(s) do escopo original não existem mais e foram omitidos.` : "";

  try {
    const [pdfBytes, xlsxBuffer] = await Promise.all([
      buildDossierPdf({ subjectDisplayName, rows, generatedAt: now, truncatedNote }),
      buildDossierXlsx({ subjectDisplayName, rows, generatedAt: now, truncatedNote }),
    ]);
    await Promise.all([
      deps.exportStore.putPdf({ tenantId, subjectId: command.subjectId, runId: command.runId, body: pdfBytes }),
      deps.exportStore.putXlsx({ tenantId, subjectId: command.subjectId, runId: command.runId, body: xlsxBuffer }),
    ]);
  } catch (err) {
    await forceUpdateStatus(deps, { ...run, version: claimed.version }, "FAILED", now, { failureReason: err instanceof Error ? err.message : "Unknown error during document generation." });
    throw err;
  }

  await forceUpdateStatus(deps, { ...run, version: claimed.version }, "READY", now, { generatedAt: now }, ["generatingLeaseExpiresAt"]);
  return { kind: "READY", requirementCount: rows.length };
}

async function tryClaimGenerating(deps: DossierExportGenerationDeps, run: DossierExportRun, leaseExpiresAt: string, now: string): Promise<{ version: number } | undefined> {
  try {
    await deps.store.transactWrite([
      {
        Update: buildVersionedUpdate({
          tableName: deps.tableName,
          key: { PK: run.PK, SK: run.SK },
          tenantId: run.tenantId,
          expectedVersion: run.version,
          now,
          set: { status: "GENERATING", generatingLeaseExpiresAt: leaseExpiresAt },
        }),
      },
    ]);
    return { version: run.version + 1 };
  } catch (err) {
    if (isTransactionCanceled(err)) return undefined;
    throw err;
  }
}

async function forceUpdateStatus(
  deps: DossierExportGenerationDeps,
  claimedRun: DossierExportRun,
  status: DossierExportRun["status"],
  now: string,
  extraSet: Record<string, unknown> = {},
  remove: string[] = [],
): Promise<void> {
  try {
    await deps.store.transactWrite([
      {
        Update: buildVersionedUpdate({
          tableName: deps.tableName,
          key: { PK: claimedRun.PK, SK: claimedRun.SK } as EntityKey,
          tenantId: claimedRun.tenantId,
          expectedVersion: claimedRun.version,
          now,
          set: { status, ...extraSet },
          remove,
        }),
      },
    ]);
  } catch (err) {
    if (!isTransactionCanceled(err)) throw err;
    // Concurrent redrive already resolved this run past GENERATING - acceptable, same posture
    // as email-delivery-workflow.ts's own forceUpdateAttemptStatus.
  }
}
