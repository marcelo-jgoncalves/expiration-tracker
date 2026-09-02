/** DocumentFileReconciliationWorker core logic — D-163 §6/round4-claude-final.md §3,
 * generalizing M6's `UploadSlotReconciliationWorker` (`upload-slot-reconciliation/
 * reconciliation.ts`) from a single GSI6 sweep to DocumentFile's two sparse GSI5 namespaces.
 * Two independent bounded scans, one per non-terminal `scanStatus` (never merged into one -
 * `candidate-source.ts`'s doc comment explains why this is a cross-tenant `Scan`, not a
 * `Query`, unlike the GSI6 case). The actual terminal transition (and the race-closing exact
 * GSI5PK/GSI5SK condition) lives in `apply-file-scan-result.ts`'s `applyFileScanTimeout` - this
 * module only discovers candidates and calls it, same division of labor as
 * `reconcileExpiredUploadSlots`/`processOneSlot`. */
import { applyFileScanTimeout, type ApplyFileScanResultDeps } from "../../modules/document-archive/application/apply-file-scan-result.js";
import type { DocumentFileScanStatus } from "../../modules/document-archive/domain/document-file.js";
import type { DocumentFileReconciliationCandidate, DocumentFileReconciliationCandidateSource } from "./candidate-source.js";

const NON_TERMINAL_STATUSES: readonly Extract<DocumentFileScanStatus, "PENDING_UPLOAD" | "SCANNING">[] = ["PENDING_UPLOAD", "SCANNING"];

/** Hard cap on pages drained per status per invocation - same rationale as the purge workers'
 * `MAX_PAGES`: bounds a single invocation against a pathological backlog, the rest picked up by
 * the next scheduled run. */
const MAX_PAGES_PER_STATUS = 25;

export interface DocumentFileReconciliationDeps extends ApplyFileScanResultDeps {
  candidates: DocumentFileReconciliationCandidateSource;
  now: () => string;
}

export interface DocumentFileReconciliationResult {
  scanned: number;
  timedOut: number;
  skippedNotDue: number;
  skippedStale: number;
}

/** GSI5SK format is `<deadlineIso>#FILE#<fileId>` (`document-file.ts`'s
 * `fileReconciliationGsi5Keys`) - deadline is always the segment before the first `#FILE#`. */
function deadlineFromGsi5Sk(gsi5sk: string): string {
  const marker = "#FILE#";
  const idx = gsi5sk.indexOf(marker);
  return idx === -1 ? gsi5sk : gsi5sk.slice(0, idx);
}

export async function reconcileTimedOutDocumentFiles(deps: DocumentFileReconciliationDeps): Promise<DocumentFileReconciliationResult> {
  const result: DocumentFileReconciliationResult = { scanned: 0, timedOut: 0, skippedNotDue: 0, skippedStale: 0 };
  const nowIso = deps.now();

  for (const status of NON_TERMINAL_STATUSES) {
    let exclusiveStartKey: Record<string, unknown> | undefined;
    for (let page = 0; page < MAX_PAGES_PER_STATUS; page++) {
      const scanPage = await deps.candidates.scanCandidates(status, exclusiveStartKey);
      // Deadline-ordered WITHIN each returned page - the best ordering guarantee available
      // given this is a cross-tenant Scan (see candidate-source.ts's doc comment); a
      // pathological backlog spanning many pages is still bounded by MAX_PAGES_PER_STATUS and
      // picked up again next run, same discipline as every other Scan-based worker here.
      const ordered = [...scanPage.items].sort((a, b) => a.GSI5SK.localeCompare(b.GSI5SK));
      for (const candidate of ordered) {
        await processOneCandidate(deps, candidate, nowIso, result);
      }
      if (!scanPage.lastEvaluatedKey) break;
      exclusiveStartKey = scanPage.lastEvaluatedKey;
    }
  }

  return result;
}

async function processOneCandidate(
  deps: DocumentFileReconciliationDeps,
  candidate: DocumentFileReconciliationCandidate,
  nowIso: string,
  result: DocumentFileReconciliationResult,
): Promise<void> {
  result.scanned += 1;

  if (deadlineFromGsi5Sk(candidate.GSI5SK) > nowIso) {
    result.skippedNotDue += 1;
    return;
  }

  const outcome = await applyFileScanTimeout(deps, {
    tenantId: candidate.tenantId,
    documentId: candidate.documentId,
    seq: candidate.seq,
    fileId: candidate.fileId,
    observedGsi5Pointer: { GSI5PK: candidate.GSI5PK, GSI5SK: candidate.GSI5SK },
  });

  if (outcome === "TIMED_OUT") result.timedOut += 1;
  else result.skippedStale += 1; // already advanced concurrently (event, or a previous/parallel sweep) - never double-processed.
}
