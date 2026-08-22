/**
 * DocumentObjectReference — M6 runtime design (docs/architecture/reviews/
 * m6-document-upload-design/codex-reconciliation-round2-final-design.md §"Decisões-chave"):
 * the immutable identity of an S3 object is always `bucket + key + versionId`, never `key`
 * alone. With versioning enabled on both document buckets, a bare key can refer to multiple
 * physical objects over time - every event, dedupe key, and promotion decision must carry the
 * full triple, or a stale/duplicate S3 or GuardDuty event could be matched against the wrong
 * object version.
 */
export interface DocumentObjectReference {
  bucket: string;
  key: string;
  versionId: string;
}

export function sameObjectVersion(a: DocumentObjectReference, b: DocumentObjectReference): boolean {
  return a.bucket === b.bucket && a.key === b.key && a.versionId === b.versionId;
}
