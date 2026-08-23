/**
 * Parses the tenantId/jobId out of a raw CSV object key built by
 * ImportService.reserveImport() (`tenant/<tenantId>/imports/<jobId>/raw.csv`). Used only at
 * the Lambda handler boundary (S3 event carries no application context beyond bucket/key) -
 * mirrors document/domain/quarantine-key.ts's role exactly. Deliberately matches ONLY the
 * literal `raw.csv` suffix - the same bucket also receives the parse worker's OWN plan JSONL
 * writes (`.../plan/page-0.jsonl`), which must never re-trigger this parser (the EventBridge
 * rule itself filters on this suffix too - this parser is the defense-in-depth second check).
 */
export interface ParsedImportRawKey {
  tenantId: string;
  jobId: string;
}

const KEY_PATTERN = /^tenant\/([^/]+)\/imports\/([^/]+)\/raw\.csv$/;

export function parseImportRawKey(key: string): ParsedImportRawKey | undefined {
  const match = KEY_PATTERN.exec(key);
  if (!match) return undefined;
  const [, tenantId, jobId] = match;
  if (!tenantId || !jobId) return undefined;
  return { tenantId, jobId };
}
