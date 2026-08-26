/**
 * Parses the tenantId/itemId/documentId out of a clean-bucket object key built by
 * advanceAfterEvidence()'s promotion copy (`clean/<tenantId>/<itemId>/<documentId>`). Used
 * only at the Lambda handler boundary (S3 event carries no application context beyond
 * bucket/key/versionId) - mirrors parseQuarantineKey()'s role for the quarantine bucket.
 * M7 (ExtractionStarterWorker, D-035 §12.5): the S3 "Object Created" event that triggers
 * extraction is the only place this key format needs to be parsed back apart.
 */
export interface ParsedCleanKey {
  tenantId: string;
  itemId: string;
  documentId: string;
}

const KEY_PATTERN = /^clean\/([^/]+)\/([^/]+)\/([^/]+)$/;

export function parseCleanKey(key: string): ParsedCleanKey | undefined {
  const match = KEY_PATTERN.exec(key);
  if (!match) return undefined;
  const [, tenantId, itemId, documentId] = match;
  if (!tenantId || !itemId || !documentId) return undefined;
  return { tenantId, itemId, documentId };
}
