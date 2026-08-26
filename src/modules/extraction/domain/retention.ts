/**
 * `EXTRACTION_TRANSIENT` (privacy-lgpd.md §4, added 2026-08-25 as a design prerequisite for
 * M7): the OCR text artifact is deleted explicitly by whichever step closes the run
 * (`ExtractionValidationTaskHandler`, ASL states 8-12) - this 24h value is only the S3
 * lifecycle safety net for a run that never reaches a terminal state (bug, stuck execution),
 * never the expected real-world lifetime of the artifact.
 */
const MS_PER_HOUR = 60 * 60 * 1000;

export const EXTRACTION_TRANSIENT_LIFECYCLE_HOURS = 24;

export function computeExtractionArtifactSafetyNetExpiry(createdAtIso: string): string {
  return new Date(Date.parse(createdAtIso) + EXTRACTION_TRANSIENT_LIFECYCLE_HOURS * MS_PER_HOUR).toISOString();
}
