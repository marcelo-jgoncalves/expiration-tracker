/**
 * DocumentFile — D-163 (`docs/architecture/reviews/document-file-scoping/estado-final-
 * consolidado.md`). Generalizes M6's proven upload/malware-scan pipeline
 * (`src/modules/document/domain/{document.ts,malware-scan-result.ts,document-object-
 * reference.ts}`) from "1 Document = 1 file, keyed by itemId" to "N files per
 * DocumentVersion, keyed by versionId" — reuses the same evidence/object-reference types
 * verbatim rather than redeclaring them.
 *
 * `scanStatus` mirrors M6's `DocumentStatus` taxonomy exactly (same terminal states, same
 * meaning) — never a new vocabulary for the same concept.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { UploadEvidence } from "../../document/domain/document.js";
import type { DocumentObjectReference } from "../../document/domain/document-object-reference.js";
import type { MalwareEvidence } from "../../document/domain/malware-scan-result.js";
import { formatVersionSeq } from "./document-version.js";

// D-163 §1 (symmetric evidence correlation): reused verbatim, not redeclared — the first
// physical event to arrive consolidates `quarantineObject` from its own observed triple, the
// second verifies exact equality against it via this same function.
export { sameObjectVersion } from "../../document/domain/document-object-reference.js";

export type DocumentFileRole = "PRINCIPAL" | "ATTACHMENT";

export type DocumentFileScanStatus = "PENDING_UPLOAD" | "SCANNING" | "CLEAN" | "REJECTED" | "UNSUPPORTED" | "TIMEOUT";

/** Non-terminal states — a file in one of these can still be advanced by a physical event
 * (S3 Object Created / GuardDuty finding) or by reconciliation timeout. */
const NON_TERMINAL_SCAN_STATUSES: readonly DocumentFileScanStatus[] = ["PENDING_UPLOAD", "SCANNING"];

export function isNonTerminalFileScanStatus(status: DocumentFileScanStatus): boolean {
  return NON_TERMINAL_SCAN_STATUSES.includes(status);
}

export interface DocumentFile extends EntityKey {
  entityType: "DocumentFile";
  tenantId: string;
  documentId: string;
  versionId: string;
  seq: number;
  fileId: string;
  role: DocumentFileRole;
  scanStatus: DocumentFileScanStatus;
  mediaType: string;
  contentLength: number;
  checksumSha256: string;
  quarantineObject: DocumentObjectReference;
  cleanObject?: DocumentObjectReference;
  uploadEvidence?: UploadEvidence;
  malwareEvidence?: MalwareEvidence;
  createdAt: string;
  updatedAt: string;
  version: number;
  /** MaintenanceDueIndex pointer (D-179 slice 3/D-166 follow-up) — present only while
   * `scanStatus` is non-terminal, removed atomically by the same transaction that reaches a
   * terminal state. REPLACES the GSI5-based `fileReconciliationGsi5Keys()` pointer D-164/D-166
   * defined: that mechanism was discovered, on re-reading the write path before this migration,
   * to have never had a real writer (`reserveFiles()` never called it) — the reconciliation
   * worker's Scan filtered on `attribute_exists(GSI5PK)` could therefore never find a real
   * candidate in production. GSI8 is a clean replacement, not a second mechanism alongside a
   * working one — same D-179 mandate the other 8 workers follow. */
  GSI8PK?: string;
  GSI8SK?: string;
}

export function documentFileKey(tenantId: string, documentId: string, seq: number, fileId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#DOCUMENT#${documentId}`, SK: `VERSION#${formatVersionSeq(seq)}#FILE#${fileId}` };
}

/** Upload+scan window (D-179 slice 3) — mirrors the presign URL's own TTL
 * (`document-archive-service.ts`'s `PRESIGN_TTL_SECONDS`, which imports this constant rather
 * than duplicating it): the whole reserve->scan lifecycle is bounded by the same window the
 * presigned upload URL itself expires under, so a file still non-terminal past this point can no
 * longer even be uploaded through the URL it was issued, and TIMEOUT is the right verdict. */
export const FILE_SCAN_TIMEOUT_SECONDS = 600;
const MS_PER_SECOND = 1000;

/** GSI8 (MaintenanceDueIndex, D-179) namespace this worker owns — the ONLY value any
 * document-file-reconciliation-scoped IAM policy's `dynamodb:LeadingKeys` condition may
 * reference (`infra/modules/dynamo-table/main.tf`), alongside the DLQ counterpart. */
export const DOCUMENT_FILE_RECONCILIATION_WORK_TYPE = "DOCUMENT_FILE_RECONCILIATION";

export interface MaintenanceDue {
  dueAtIso: string;
}

/**
 * deriveDocumentFileMaintenanceDue — D-179 slice 3's pure due-date function, same role as
 * `deriveMembershipMaintenanceDue()`/`deriveInvitationMaintenanceDue()`: single source of truth
 * reused by the write path (`reserveFiles()`), the backfill script, and the worker's own
 * processing (via `applyFileScanTimeout`'s fresh re-read).
 *
 * Closer to Invitation's PENDING branch than to Membership's REMOVED branch: the due date is
 * fully known at creation (`reserveFiles()`) — `createdAt + FILE_SCAN_TIMEOUT_SECONDS` — there is
 * no later transition ("scan started") to hang it on, since SCANNING is just evidence arriving
 * within the same fixed window, never a new clock start. `undefined` once terminal (never a real
 * candidate again).
 */
export function deriveDocumentFileMaintenanceDue(file: Pick<DocumentFile, "scanStatus" | "createdAt">): MaintenanceDue | undefined {
  if (!isNonTerminalFileScanStatus(file.scanStatus)) return undefined;
  return { dueAtIso: new Date(Date.parse(file.createdAt) + FILE_SCAN_TIMEOUT_SECONDS * MS_PER_SECOND).toISOString() };
}

/** `GSI8PK=WORK#DOCUMENT_FILE_RECONCILIATION` / `GSI8SK=<dueAtIso>#TENANT#<tenantId>#<fileId>`
 * (D-179's exact key spec, same shape as `membershipGsi8Keys()`/`invitationGsi8Keys()`) —
 * `documentId`/`seq` are not embedded here since a `KEYS_ONLY` GSI8 Query already returns the
 * base table's own `PK`/`SK`, which already encode them (`documentFileKey()`). */
export function documentFileGsi8Keys(input: { dueAtIso: string; tenantId: string; fileId: string }): { GSI8PK: string; GSI8SK: string } {
  return {
    GSI8PK: `WORK#${DOCUMENT_FILE_RECONCILIATION_WORK_TYPE}`,
    GSI8SK: `${input.dueAtIso}#TENANT#${input.tenantId}#${input.fileId}`,
  };
}

export interface FileUploadSpec {
  role: DocumentFileRole;
  mediaType: string;
  contentLength: number;
  checksumSha256: string;
}

export class InvalidFileSetError extends Error {
  constructor(reason: string) {
    super(`Invalid file set for reserveFiles: ${reason}`);
    this.name = "InvalidFileSetError";
  }
}

/** D-143 Decision 6: exactly one PRINCIPAL per batch. Pure validation, checked before any
 * write is attempted — the actual concurrency race between two batches reserving the same
 * DocumentVersion is closed separately, by the transaction's `fileSetSealed` fence in
 * `DocumentArchiveService.reserveFiles()` (D-163 §2), never by this check alone. */
export function assertExactlyOnePrincipal(files: readonly FileUploadSpec[]): void {
  if (files.length === 0) throw new InvalidFileSetError("at least one file is required");
  const principals = files.filter((f) => f.role === "PRINCIPAL");
  if (principals.length !== 1) throw new InvalidFileSetError(`exactly one PRINCIPAL is required, got ${principals.length}`);
}

/** D-163 §2: caps a single `reserveFiles` batch well under `TransactWriteItems`'s 100-action
 * limit (N Put + 1 Update = N+1 actions in the worst case). */
export const MAX_FILES_PER_VERSION = 20;
