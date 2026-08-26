/** Writes the OCR text artifact to the `EXTRACTION_TRANSIENT` S3 class (`privacy-lgpd.md` §4,
 * `claude-reconciliation-final-design.md` §1.4) — dedicated bucket/prefix, no versioning/
 * backup/replication, deleted explicitly by `ExtractionValidationTaskHandler` at run closure
 * (never by `TextractTaskHandler` itself, design §3), 24h S3 lifecycle as safety net only. */
export interface ExtractionArtifactRef {
  bucket: string;
  key: string;
}

export interface OcrArtifactStore {
  /** `blocksJson` is the serialized Textract block array — never logged, never placed on an
   * event/DLQ payload (design §1.9/§20.5: OCR text never leaves this store as a value). */
  put(runId: string, blocksJson: string): Promise<ExtractionArtifactRef>;
}
