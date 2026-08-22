/**
 * Document — data-model.md line 34: PK=`TENANT#t#ITEM#i`, SK=`DOC#d`. State set matches the
 * approved data model exactly: PENDING_UPLOAD/SCANNING/CLEAN/REJECTED/UNSUPPORTED/TIMEOUT/
 * DELETED (implementation-blueprint.md §12.2-12.3; TIMEOUT is driven by
 * UploadSlotReconciliationWorker for scans that never resolve, not by the malware/finalizer
 * workers directly). M6 design §2.1 adds uploadEvidence/malwareEvidence (independent evidence
 * fields, never presuming which arrives first - see document-state-machine.ts) and
 * retentionClass/purgeAfter (privacy-lgpd.md §4 USER_DOCUMENT class materialized on the entity
 * from day one, not bolted on later).
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { DocumentObjectReference } from "./document-object-reference.js";
import type { MalwareEvidence } from "./malware-scan-result.js";
import type { DocumentRetentionClass } from "./retention.js";

export type DocumentStatus = "PENDING_UPLOAD" | "SCANNING" | "CLEAN" | "REJECTED" | "UNSUPPORTED" | "TIMEOUT" | "DELETED";

export interface UploadEvidence {
  object: DocumentObjectReference;
  contentLength: number;
  mediaType: string;
  checksumSha256: string;
  /** Whether the observed object matched what was declared at reservation time AND (for PDFs)
   * passed the sandbox parser's structural validation. `advanceAfterEvidence()` reads THIS
   * field, never just "evidence is present" - presence alone would wrongly treat an invalid
   * upload as valid (real bug caught during implementation, see advance-after-evidence.ts). */
  valid: boolean;
  observedAt: string;
}

export interface Document extends EntityKey {
  entityType: "Document";
  tenantId: string;
  itemId: string;
  documentId: string;
  uploadSlotId: string;
  fileName: string;
  mediaType: string;
  contentLength: number;
  checksumSha256: string;
  status: DocumentStatus;
  quarantineObject: DocumentObjectReference;
  /** Only present once promoted - never populated before status === "CLEAN". */
  cleanObject?: DocumentObjectReference;
  uploadEvidence?: UploadEvidence;
  malwareEvidence?: MalwareEvidence;
  extractionRunId?: string; // M7, unused by M6, kept for schema forward-compatibility only.
  retentionClass: Extract<DocumentRetentionClass, "USER_DOCUMENT">;
  purgeAfter?: string; // set only once a terminal/deletion event establishes the clock.
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export function documentKey(tenantId: string, itemId: string, documentId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#ITEM#${itemId}`, SK: `DOC#${documentId}` };
}
