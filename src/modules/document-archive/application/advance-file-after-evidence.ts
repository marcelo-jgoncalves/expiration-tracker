/**
 * advanceDocumentArchiveFileAfterEvidence — D-193 ("Ingestão física") slice 1. Sibling to
 * `document/application/advance-after-evidence.ts`'s `advanceAfterEvidence()`, called
 * identically by both physical handlers (`upload-finalizer-handler.ts` after persisting
 * uploadEvidence-equivalent data, `malware-result-handler.ts` after a GuardDuty finding).
 *
 * Unlike M6's `Document` (whose `advanceAfterEvidence()` owns evidence persistence itself and
 * `decideNextAction()` separately), `DocumentFile`'s `applyFileScanResult()` already does BOTH —
 * persists whichever evidence half this call observed AND applies `decideNextAction()`'s
 * decision — in one atomic OCC loop (`apply-file-scan-result.ts`'s own doc comment). This
 * function's only real job on top of that is the PROMOTE branch's physical copy-to-clean +
 * verify + `confirmFileScanClean()` — the part `applyFileScanResult()` deliberately never does
 * itself (no `DocumentObjectStore` wired into it, per its doc comment).
 */
import { documentFileKey, type DocumentFile } from "../domain/document-file.js";
import type { UploadEvidence } from "../../document/domain/document.js";
import type { DocumentObjectReference } from "../../document/domain/document-object-reference.js";
import type { MalwareEvidence } from "../../document/domain/malware-scan-result.js";
import type { DocumentObjectStore } from "../../document/ports/document-object-store.js";
import type { DocumentArchiveStore } from "../ports/document-archive-store.js";
import type { DocumentArchiveIdGenerator } from "./id-generator.js";
import { applyFileScanResult, confirmFileScanClean } from "./apply-file-scan-result.js";

export interface AdvanceDocumentArchiveFileDeps {
  store: DocumentArchiveStore;
  objects: DocumentObjectStore;
  ids: DocumentArchiveIdGenerator;
  tableName: string;
  cleanBucket: string;
  now?: () => string;
}

export interface AdvanceDocumentArchiveFileInput {
  tenantId: string;
  documentId: string;
  seq: number;
  fileId: string;
  observedObject: DocumentObjectReference;
  uploadEvidence?: UploadEvidence;
  malwareEvidence?: MalwareEvidence;
}

export type AdvanceDocumentArchiveFileOutcome = "PROMOTED" | "REJECTED" | "AWAITING" | "IGNORED_STALE" | "IGNORED_WRONG_VERSION" | "IGNORED_TENANT_NOT_ACTIVE";

/** `document-archive/clean/<tenantId>/<documentId>/<versionId>/<fileId>` — the exact clean-key
 * shape the approved design closed on (Round 5, "Chave clean e identidade": versionId-based,
 * NEVER `seq`, since `ExtractionRun`'s future re-keying reads identity off this same triple). */
export function buildDocumentArchiveCleanKey(tenantId: string, documentId: string, versionId: string, fileId: string): string {
  return `document-archive/clean/${tenantId}/${documentId}/${versionId}/${fileId}`;
}

export async function advanceDocumentArchiveFileAfterEvidence(
  deps: AdvanceDocumentArchiveFileDeps,
  input: AdvanceDocumentArchiveFileInput,
): Promise<AdvanceDocumentArchiveFileOutcome> {
  const applyDeps = { store: deps.store, tableName: deps.tableName, ids: deps.ids, now: deps.now };
  const outcome = await applyFileScanResult(applyDeps, {
    tenantId: input.tenantId,
    documentId: input.documentId,
    seq: input.seq,
    fileId: input.fileId,
    observedObject: input.observedObject,
    uploadEvidence: input.uploadEvidence,
    malwareEvidence: input.malwareEvidence,
  });

  if (outcome.outcome === "AWAITING") return "AWAITING";
  if (outcome.outcome === "IGNORED_STALE") return "IGNORED_STALE";
  if (outcome.outcome === "IGNORED_WRONG_VERSION") return "IGNORED_WRONG_VERSION";
  if (outcome.outcome === "IGNORED_TENANT_NOT_ACTIVE") return "IGNORED_TENANT_NOT_ACTIVE";
  if (outcome.outcome === "REJECTED") return "REJECTED";

  // outcome.outcome === "READY_TO_PROMOTE": copy quarantine -> clean, verify, confirm CLEAN —
  // same discipline advanceAfterEvidence()'s own PROMOTE branch requires. `versionId` is not
  // carried by applyFileScanResult's own outcome shape (it never needs it internally), so a
  // fresh read of the DocumentFile itself supplies it here — cheap, and never assumes the
  // caller's earlier read (if any) is still current.
  const file = await deps.store.get<DocumentFile>(documentFileKey(input.tenantId, input.documentId, input.seq, input.fileId));
  if (!file) return "IGNORED_STALE"; // the file cannot be removed once created - fail closed if this ever changes.

  const cleanKey = buildDocumentArchiveCleanKey(input.tenantId, input.documentId, file.versionId, input.fileId);
  const cleanObject = await deps.objects.copyObject(outcome.sourceObject, deps.cleanBucket, cleanKey);
  const verify = await deps.objects.headObject(cleanObject);
  if (!verify || verify.contentLength !== file.contentLength) {
    // Same orphaned-clean-version compensation discipline as advanceAfterEvidence() - never
    // confirm CLEAN on unverified data, and never leave the failed copy's version dangling.
    try {
      await deps.objects.deleteObjectVersion(cleanObject);
    } catch {
      // Best-effort - the bucket's own lifecycle rule / a future reconciliation sweep is the
      // backstop, same reasoning advance-after-evidence.ts documents for its own compensation.
    }
    throw new Error(`Promotion copy verification failed for DocumentFile ${input.fileId}`);
  }

  const confirmOutcome = await confirmFileScanClean(applyDeps, {
    tenantId: input.tenantId,
    documentId: input.documentId,
    seq: input.seq,
    fileId: input.fileId,
    cleanObject,
  });
  if (confirmOutcome !== "CONFIRMED") {
    // Concurrent rejection or tenant fence loss between the copy and this confirm - compensate
    // the orphaned clean-bucket version, same as advanceAfterEvidence()'s every-non-committed-
    // outcome discipline (W3-07 review finding).
    try {
      await deps.objects.deleteObjectVersion(cleanObject);
    } catch {
      // Best-effort, same backstop reasoning as above.
    }
    return confirmOutcome === "IGNORED_TENANT_NOT_ACTIVE" ? "IGNORED_TENANT_NOT_ACTIVE" : "IGNORED_STALE";
  }

  // Quarantine object removal is best-effort cleanup, never a condition for CLEAN - same M6
  // design §2.3 posture advanceAfterEvidence() already follows.
  try {
    await deps.objects.deleteObjectVersion(outcome.sourceObject);
  } catch {
    // Intentionally swallowed - the quarantine bucket's own lifecycle rule is the backstop.
  }
  return "PROMOTED";
}
