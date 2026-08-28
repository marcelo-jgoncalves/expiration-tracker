/**
 * W3-06 (D-061): non-sensitive proof-of-purge record, written transactionally alongside the
 * physical `Document` deletion so the evidence and the deletion itself can never diverge (the
 * transaction that removes the Document row is the same one that creates this). Deliberately
 * carries no document content and no third-party data - only internal identifiers and
 * timestamps, `retentionClassPurged` for audit, and `correlationId` to trace back to the worker
 * invocation that performed the purge.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export interface DocumentPurgeReceipt extends EntityKey {
  entityType: "DocumentPurgeReceipt";
  tenantId: string;
  documentId: string;
  itemId: string;
  retentionClassPurged: "USER_DOCUMENT";
  deletedAtOriginal: string;
  purgedAt: string;
  correlationId?: string;
  /** Reuses `DELIVERY_RECORD`'s existing "criação + 180 dias" retention (privacy-lgpd.md §4) -
   * same rationale (proof of process, not third-party data), not a new class for one entity. */
  retentionClass: "DELIVERY_RECORD";
  purgeAfter: string;
  GSI6PK?: string;
  GSI6SK?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export function documentPurgeReceiptKey(tenantId: string, documentId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#PURGERECEIPT#${documentId}`, SK: "META" };
}
