/**
 * Narrow port for the DocumentFileReconciliationWorker (D-163/D-166, migrated to GSI8 by D-179
 * slice 3 — 3rd of 9 workers, mirroring `membership-purge`/`invitation-purge`'s own migrations).
 *
 * Replaces the base-table `Scan` filtered by `attribute_exists(GSI5PK)` this worker used through
 * D-166 with a `Query` against GSI8 (`GSI8PK=WORK#DOCUMENT_FILE_RECONCILIATION`,
 * `GSI8SK=<dueAtIso>#TENANT#<tenantId>#<fileId>`, `KEYS_ONLY`). That Scan was discovered, on
 * re-reading the write path before this migration, to have never had a real writer
 * (`reserveFiles()` never called `fileReconciliationGsi5Keys()`) — this worker could never find a
 * real candidate in production. GSI8 is a clean replacement, not a second mechanism.
 *
 * Unlike `membership-purge`/`invitation-purge`, this worker has no tenant-ACTIVE fence and no
 * poison-record/backoff/DLQ mechanism (D-166's own file header: "a stuck upload is not a
 * retention decision, it never depended on tenant ACTIVE status") — every non-terminal
 * `DocumentFile` is either promoted/rejected by a real physical event or eventually times out,
 * unconditionally, once its deadline passes. GSI8 is discovery-only here too, but the actual
 * claim/revalidation already lives inside `applyFileScanTimeout()` (its own fresh `store.get()` +
 * OCC retry loop + exact-pointer `ConditionCheck`) — this port therefore only needs `queryDue()`,
 * never a separate `getFile()`/`transactWrite()` pair: composing with that existing transactional
 * fence, not duplicating it, is the whole point of this slice.
 *
 * GSI8 has no per-status partition (unlike the old per-status GSI5 namespace), so the two
 * independent bounded scans D-166 ran (one per `PENDING_UPLOAD`/`SCANNING`) collapse into a
 * single due-ordered `Query` covering both statuses at once — a real simplification GSI8 enables,
 * not just a mechanical swap.
 */
import type { EntityKey } from "../../shared/dynamodb/occ.js";

export interface DocumentFileGsi8Candidate extends EntityKey {
  dueAtIso: string;
  tenantId: string;
  documentId: string;
  seq: number;
  fileId: string;
}

export interface DocumentFileGsi8Page {
  items: DocumentFileGsi8Candidate[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface DocumentFileReconciliationCandidateSource {
  /** `Query GSI8PK = "WORK#DOCUMENT_FILE_RECONCILIATION" AND GSI8SK < :before`, ordered by due
   * date. `documentId`/`seq`/`fileId` are parsed from the base table's own `PK`/`SK`
   * (`documentFileKey()`'s shape), never re-derived from `GSI8SK` — `KEYS_ONLY` already returns
   * them for free. */
  queryDue(input: { before: string; exclusiveStartKey?: Record<string, unknown> }): Promise<DocumentFileGsi8Page>;
}
