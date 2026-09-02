/**
 * Narrow port for the DocumentFileReconciliationWorker (D-163/D-166, generalizing M6's
 * `UploadSlotReconciliationWorker` — `upload-slot-reconciliation/reconciliation.ts` — from a
 * single-file GSI6 sweep to DocumentFile's sparse GSI5 namespace,
 * `TENANT#<t>#DOCFILE-RECON#{PENDING_UPLOAD,SCANNING}`, D-163 §6/round4-claude-final.md §3).
 *
 * Deliberately a base-table `Scan` filtered by `entityType`/`scanStatus`/`attribute_exists(
 * GSI5PK)`, NOT a `Query` against GSI5 directly — same accepted cost tradeoff already
 * documented by `core-user-data-purge`/`security-audit-purge`/`quota-telemetry-purge`'s
 * candidate sources: unlike GSI6 (whose reconciliation/purge namespaces are deliberately
 * GLOBAL, not tenant-prefixed, so `UploadSlotReconciliationWorker` can `Query` them directly),
 * `DocumentFile`'s GSI5 pointer is tenant-scoped (`TENANT#<t>#DOCFILE-RECON#<status>`, matching
 * every other GSI5 namespace this module already owns — review queue, version lookup). A single
 * cross-tenant `Query` is therefore not possible without a tenant-enumeration port this module
 * has never needed (`document-archive-store.ts`'s `scanSatisfiedRequirements`/`scanActiveSeries`
 * accept the exact same tradeoff for the same structural reason). The exact GSI5PK/GSI5SK pair
 * observed here is still what closes the real race (see `apply-file-scan-result.ts`'s
 * `applyFileScanTimeout`) — this Scan is only ever a discovery mechanism, never itself a source
 * of truth for eligibility.
 */
import type { EntityKey } from "../../shared/dynamodb/occ.js";
import type { DocumentFileScanStatus } from "../../modules/document-archive/domain/document-file.js";

export interface DocumentFileReconciliationCandidate extends EntityKey {
  entityType: "DocumentFile";
  tenantId: string;
  documentId: string;
  seq: number;
  fileId: string;
  scanStatus: Extract<DocumentFileScanStatus, "PENDING_UPLOAD" | "SCANNING">;
  GSI5PK: string;
  GSI5SK: string;
}

export interface DocumentFileReconciliationScanPage {
  items: DocumentFileReconciliationCandidate[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface DocumentFileReconciliationCandidateSource {
  /** `Scan` with `FilterExpression: entityType = :documentFile AND scanStatus = :status AND
   * attribute_exists(GSI5PK)` — one independent bounded scan per non-terminal status, per D-163
   * §6/round4 §3 ("two independent bounded scans, one per status" — never merged into one). */
  scanCandidates(status: Extract<DocumentFileScanStatus, "PENDING_UPLOAD" | "SCANNING">, exclusiveStartKey?: Record<string, unknown>): Promise<DocumentFileReconciliationScanPage>;
}
