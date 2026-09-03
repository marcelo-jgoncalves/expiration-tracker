/**
 * Parses the tenantId/documentId/versionId/fileId out of a `document-archive`-namespaced
 * CLEAN-bucket object key, built verbatim by `advance-file-after-evidence.ts`'s
 * `buildDocumentArchiveCleanKey()`: `document-archive/clean/<tenantId>/<documentId>/
 * <versionId>/<fileId>` (D-193 slice 1, versionId-based — never `seq`, per the approved
 * design's "Chave clean e identidade" decision).
 *
 * D-193 item 1/9 (`estado-final-consolidado.md`) — sibling to `document-archive-quarantine-
 * key.ts` (slice 1's parser for the QUARANTINE-bucket key). This one exists for the Starter
 * (item 3/9): `extraction-starter-handler.ts` gets a third branch that recognizes this prefix
 * on the S3 "Object Created" event fired for the CLEAN bucket (the same bucket/queue the OLD
 * `document`-module trigger already listens on — no new infra, exactly the same "reuse the
 * existing shared clean bucket" reasoning slice 1's own doc comment gives for the quarantine
 * side).
 *
 * Never collides with `clean-key.ts#parseCleanKey`'s `clean/<tenantId>/<itemId>/<documentId>`
 * shape (M6) — the leading `document-archive/` segment never appears there, same "additive,
 * never overlapping" discipline every other D-193/D-037 key parser in this codebase follows.
 */
export interface ParsedDocumentArchiveCleanKey {
  tenantId: string;
  documentId: string;
  versionId: string;
  fileId: string;
}

const KEY_PATTERN = /^document-archive\/clean\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/;

export function parseDocumentArchiveCleanKey(key: string): ParsedDocumentArchiveCleanKey | undefined {
  const match = KEY_PATTERN.exec(key);
  if (!match) return undefined;
  const [, tenantId, documentId, versionId, fileId] = match;
  if (!tenantId || !documentId || !versionId || !fileId) return undefined;
  return { tenantId, documentId, versionId, fileId };
}
