/**
 * D-192 §4 — batched Subject-reference resolution for Document/Requirement import rows
 * ("estado-final-consolidado.md" §4, fatia 5 of the D-192 implementation sequence).
 *
 * Two-phase `BatchGetItem` resolution, never one `GetItem` per row:
 *   Phase 1 resolves the DISTINCT `externalId` values from the whole batch against
 *   `SubjectExternalIdPointer` -> `subjectId`.
 *   Phase 2 resolves the DISTINCT `subjectId`s found in phase 1 against the real
 *   `TrackedSubject` row, confirming `status` at THIS moment (never trusted stale from the
 *   pointer, which carries no status of its own).
 *
 * Worst case (design's own number, 5000 rows all distinct): ~100 `BatchGetItem` calls total
 * (`SubjectStore.batchGet()`'s own 100-key chunking + `UnprocessedKeys` retry), never 5000
 * `GetItem`s.
 *
 * `subjectRefKind="SUBJECT_ID"` (the ColumnMapping's other option, D-192 §2) skips phase 1
 * entirely — the raw value already IS the id to resolve in phase 2. This module is only the
 * SUBJECT half of §4; the sibling `documentTypeRef` resolution (`documentTypeNamePointerKey`,
 * D-173) is a separate, not-yet-written module (next slice, see NEXT_SESSION_PROMPT.md).
 *
 * Deliberately NOT wired into `import-parse-service.ts` yet: the current parse loop is entirely
 * TrackedSubject-shaped (hardcoded `displayName`/`type`/`externalId` columns, no
 * `ColumnMapping`-driven field extraction for Document/Requirement rows at all). Wiring this
 * resolver into the parse loop is bundled with the DocumentType resolver in the next slice so
 * the loop only needs to branch on `targetEntityType` once, not twice across two slices.
 */
import { subjectExternalIdPointerKey, subjectKey, type SubjectExternalIdPointer, type TrackedSubject } from "../../subject/domain/tracked-subject.js";
import type { SubjectStore } from "../../subject/ports/subject-store.js";

export type SubjectReferenceKind = "EXTERNAL_ID" | "SUBJECT_ID";

export type SubjectReferenceResolution =
  | { kind: "RESOLVED"; subjectId: string }
  // The design's exact rejection reason (§4): "referência não resolvida -> REJECT
  // reason=SUBJECT_REFERENCE_NOT_FOUND" — covers both "pointer/id doesn't exist" AND "resolves
  // to a non-ACTIVE Subject" (ARCHIVED/DELETED) as the SAME external reason, mirroring the
  // Subject fence's own enumerated `status = ACTIVE` check (never `<> DELETED`) rather than
  // inventing a second, narrower taxonomy the design doesn't ask for.
  | { kind: "NOT_FOUND" };

/**
 * Resolves a batch of Subject references (mixed `EXTERNAL_ID`/`SUBJECT_ID` kind per row is NOT
 * supported here — a single `ColumnMapping` fixes one `subjectRefKind` for the whole file, D-192
 * §2 — callers pass the one kind that applies to the whole batch) to a `Map` keyed by the RAW
 * reference value exactly as it appeared in the CSV cell, so callers can look up each row's
 * outcome by its own raw value without re-deriving anything.
 */
export async function resolveSubjectReferences(
  subjectStore: SubjectStore,
  tenantId: string,
  refKind: SubjectReferenceKind,
  rawValues: readonly string[],
): Promise<Map<string, SubjectReferenceResolution>> {
  const distinctRawValues = [...new Set(rawValues)];
  const result = new Map<string, SubjectReferenceResolution>();
  if (distinctRawValues.length === 0) return result;

  // Phase 1 (EXTERNAL_ID only): distinct raw values -> subjectId, via SubjectExternalIdPointer.
  // Phase 2 works directly off distinct raw values when refKind is already SUBJECT_ID.
  const rawValueToSubjectId = new Map<string, string>();
  if (refKind === "EXTERNAL_ID") {
    const pointerKeys = distinctRawValues.map((externalId) => subjectExternalIdPointerKey(tenantId, externalId));
    const pointers = await subjectStore.batchGet<SubjectExternalIdPointer>(pointerKeys);
    const pointerByExternalId = new Map(pointers.map((p) => [p.externalId, p]));
    for (const rawValue of distinctRawValues) {
      const pointer = pointerByExternalId.get(rawValue);
      if (pointer) rawValueToSubjectId.set(rawValue, pointer.subjectId);
      else result.set(rawValue, { kind: "NOT_FOUND" });
    }
  } else {
    for (const rawValue of distinctRawValues) rawValueToSubjectId.set(rawValue, rawValue);
  }

  // Phase 2: distinct subjectIds (deduped AGAIN here - two different externalIds could in
  // principle point at the same subjectId, and SUBJECT_ID-kind rows can repeat the same id
  // across many rows) -> real TrackedSubject, status checked NOW.
  const distinctSubjectIds = [...new Set(rawValueToSubjectId.values())];
  if (distinctSubjectIds.length > 0) {
    const subjectKeys = distinctSubjectIds.map((subjectId) => subjectKey(tenantId, subjectId));
    const subjects = await subjectStore.batchGet<TrackedSubject>(subjectKeys);
    const subjectById = new Map(subjects.map((s) => [s.subjectId, s]));

    for (const [rawValue, subjectId] of rawValueToSubjectId) {
      const subject = subjectById.get(subjectId);
      result.set(rawValue, subject && subject.status === "ACTIVE" ? { kind: "RESOLVED", subjectId } : { kind: "NOT_FOUND" });
    }
  }

  return result;
}
