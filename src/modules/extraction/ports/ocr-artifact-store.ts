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
   * event/DLQ payload (design §1.9/§20.5: OCR text never leaves this store as a value).
   *
   * W3-07 (D-070 chunk 6/N, OCR key determinism fix): the S3 key this writes to MUST be
   * deterministic from `tenantId`+`runId` alone (`ocr/<tenantId>/<runId>.json`, per the
   * approved design's §Q roadmap item), never a fresh random suffix per call - `runId` is
   * already the SFN execution's own idempotency key (`ExecutionAlreadyExists` makes retries of
   * the same run a no-op upstream), so a redelivered `COMPLETE_OCR` completion notification for
   * the same run must land on the SAME physical object, not create an orphaned duplicate whose
   * S3 lifecycle rule is the only thing that ever cleans it up. */
  put(tenantId: string, runId: string, blocksJson: string): Promise<ExtractionArtifactRef>;

  /** Reads back the serialized Textract block array written by `put()` — the two real
   * consumers are `PdfParserTaskHandler` (item 5) and `BedrockExtractionTaskHandler` (item 6),
   * per design §1.2 ("os estados seguintes do ASL... ainda precisam ler o artefato"). */
  get(ref: ExtractionArtifactRef): Promise<string>;

  /** Deletes the artifact — added in M7 item 7 (`ExtractionValidationTaskHandler`), the ONE
   * caller this port's contract was always reserved for (item 4's `S3OcrArtifactStore`
   * deliberately shipped without this method so accidental deletion from the wrong caller was
   * structurally impossible; item 7 is precisely the right caller, per design §3: "o único
   * ponto do sistema que sabe com certeza que nenhum estado subsequente vai mais ler o
   * artefato"). MUST be called only from `CompleteRun` / `MarkPendingConfirmation`'s FAILED
   * path / the concurrent-discard path — never from `TextractTaskHandler`'s `COMPLETE_OCR`
   * (design §3, rodada 6/7: that handler never deletes, in any outcome). Idempotent — deleting
   * an already-absent key (double invocation, retry) must not throw. */
  delete(ref: ExtractionArtifactRef): Promise<void>;
}
