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
  /** Sparse reconciliation pointer (D-163 §5/§6) — present only while `scanStatus` is
   * non-terminal, removed atomically by the same transaction that reaches a terminal state.
   * Reuses GSI5 (already allocated to this module for the review queue/version lookup),
   * discriminated by prefix exactly like GSI1 already is between Document/Requirement —
   * NEVER GSI6 (D-143 Decision 2 closes GSI6 to the document domain; a Rodada 3 proposal to
   * reuse it was reverted in Rodada 4 for exactly this reason). */
  GSI5PK?: string;
  GSI5SK?: string;
}

export function documentFileKey(tenantId: string, documentId: string, seq: number, fileId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#DOCUMENT#${documentId}`, SK: `VERSION#${formatVersionSeq(seq)}#FILE#${fileId}` };
}

/** Sparse GSI5 namespace for reconciliation candidates (D-163 §6) — two prefixes, one per
 * non-terminal `scanStatus`, so the reconciliation worker can run two independent bounded
 * deadline-ordered scans without ever touching GSI6. */
export function fileReconciliationGsi5Keys(
  tenantId: string,
  status: Extract<DocumentFileScanStatus, "PENDING_UPLOAD" | "SCANNING">,
  deadline: string,
  fileId: string,
): { GSI5PK: string; GSI5SK: string } {
  return { GSI5PK: `TENANT#${tenantId}#DOCFILE-RECON#${status}`, GSI5SK: `${deadline}#FILE#${fileId}` };
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
