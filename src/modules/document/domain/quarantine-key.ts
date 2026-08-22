/**
 * Parses the tenantId/itemId/documentId out of a quarantine object key built by
 * DocumentService.reserveUpload() (`tenant/<tenantId>/item/<itemId>/document/<documentId>/
 * slot/<uploadSlotId>/<random>`). Used only at the Lambda handler boundary (S3 event / GuardDuty
 * finding carry no application context beyond bucket/key/versionId) - the pure worker
 * functions themselves always take these as explicit parameters, never re-derive them.
 */
export interface ParsedQuarantineKey {
  tenantId: string;
  itemId: string;
  documentId: string;
  uploadSlotId: string;
}

const KEY_PATTERN = /^tenant\/([^/]+)\/item\/([^/]+)\/document\/([^/]+)\/slot\/([^/]+)\//;

export function parseQuarantineKey(key: string): ParsedQuarantineKey | undefined {
  const match = KEY_PATTERN.exec(key);
  if (!match) return undefined;
  const [, tenantId, itemId, documentId, uploadSlotId] = match;
  if (!tenantId || !itemId || !documentId || !uploadSlotId) return undefined;
  return { tenantId, itemId, documentId, uploadSlotId };
}
