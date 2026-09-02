/** Same injectable-id-generator pattern as `src/modules/expiration/application/id-generator.ts`
 * — production wiring uses real ULIDs/UUIDs, tests inject deterministic sequences. */
export interface DocumentArchiveIdGenerator {
  newDocumentId(): string;
  newVersionId(): string;
  newEventId(): string;
  /** D-143 Nucleus 2, Requirement (D-145). */
  newRequirementId(): string;
  /** D-143 Nucleus 2, recurrence (D-147). */
  newSeriesId(): string;
  newDocumentRequestId(): string;
  /** D-163 (`DocumentFile`). */
  newFileId(): string;
  /** D-173 (`DocumentType` catalog). */
  newDocumentTypeId(): string;
}
