/**
 * Parses the tenantId/documentId/seq/fileId out of a `document-archive`-namespaced quarantine
 * object key, built verbatim by `DocumentArchiveService.buildQuarantineKey()`:
 * `document-archive/tenant/<tenantId>/document/<documentId>/version/<seq>/file/<fileId>`
 * (D-163 §7).
 *
 * D-193 (`estado-final-consolidado.md`, "Ingestão física") — this is the parser real production
 * `dev` was missing: `upload-finalizer-handler.ts`/`malware-result-handler.ts` only ever tried
 * `document/domain/quarantine-key.ts#parseQuarantineKey` (M6's `tenant/<t>/item/<i>/...` shape)
 * and `subject/domain/submission-quarantine-key.ts#parseSubmissionQuarantineKey` (M10's
 * `tenant/<t>/subject/<s>/...` shape) — a `document-archive/...` key matched NEITHER (this
 * format's leading `document-archive/` segment never appears in either of those patterns), so it
 * fell through to "unrecognized key shape", logged, and silently dropped forever with no retry/
 * DLQ. `DocumentFile`/`DocumentVersion` uploads therefore got stuck in `PENDING_UPLOAD`
 * permanently — this parser plus the third handler branch (see `upload-finalizer-handler.ts`/
 * `malware-result-handler.ts`) is the fix.
 *
 * Never collides with either existing format (`document-archive/` is a segment neither of the
 * other two patterns can ever produce at that position) — same "additive, never overlapping"
 * discipline `submission-quarantine-key.ts`'s own doc comment establishes for its own addition.
 */
export interface ParsedDocumentArchiveQuarantineKey {
  tenantId: string;
  documentId: string;
  seq: number;
  fileId: string;
}

const KEY_PATTERN = /^document-archive\/tenant\/([^/]+)\/document\/([^/]+)\/version\/([^/]+)\/file\/([^/]+)$/;

export function parseDocumentArchiveQuarantineKey(key: string): ParsedDocumentArchiveQuarantineKey | undefined {
  const match = KEY_PATTERN.exec(key);
  if (!match) return undefined;
  const [, tenantId, documentId, seqStr, fileId] = match;
  if (!tenantId || !documentId || !seqStr || !fileId) return undefined;
  const seq = Number(seqStr);
  if (!Number.isInteger(seq) || seq <= 0) return undefined;
  return { tenantId, documentId, seq, fileId };
}
