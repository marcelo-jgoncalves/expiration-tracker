/**
 * D-192 §4 — batched DocumentType-reference resolution for Document import rows
 * ("estado-final-consolidado.md" §4, fatia 6 of the D-192 implementation sequence).
 *
 * Sibling of `resolve-subject-references.ts` (fatia 5) — same two-phase `BatchGetItem` shape,
 * same dedup-within-batch discipline, same "not resolved -> single external rejection reason"
 * posture, DocumentType side instead of Subject side:
 *   Phase 1 (`DISPLAY_NAME` kind only) resolves the DISTINCT raw values from the whole batch
 *   against `DocumentTypeNamePointer` (`documentTypeNamePointerKey`, D-173) -> `documentTypeId`.
 *   Phase 2 resolves the DISTINCT `documentTypeId`s found in phase 1 against the real
 *   `DocumentType` row, confirming `status` at THIS moment (never trusted stale from the
 *   pointer, which carries no status of its own).
 *
 * `documentTypeRefKind="DOCUMENT_TYPE_ID"` (the ColumnMapping's other option, D-192 §2) skips
 * phase 1 entirely - the raw value already IS the id to resolve in phase 2.
 *
 * DocumentType has only two statuses (`document-type.ts`: `"ACTIVE" | "DEPRECATED"`, not the
 * three-state ACTIVE/ARCHIVED/DELETED of TrackedSubject) - only `status="ACTIVE"` resolves, per
 * §4's exact text ("só status=ACTIVE resolve"); a `DEPRECATED` DocumentType resolves to the SAME
 * external rejection reason as "not found at all", mirroring `resolveSubjectReferences()`'s own
 * posture of not inventing a narrower taxonomy the design doesn't ask for. Renaming a
 * DocumentType between preview and commit does not affect an already-RESOLVED plan entry (§4:
 * "o documentTypeId RESOLVIDO fica congelado no plano") - a DEPRECATE landing after preview is
 * caught by the commit's own `ConditionCheck` (a row-level commit failure, never a job-level
 * one), not by this resolver re-running.
 *
 * Deliberately uses `DocumentArchiveStore` directly (not a duplicated lookup helper) - the same
 * cross-module application-layer access pattern `resolveSubjectReferences()` already established
 * for `import/application` -> `subject/domain` + `subject/ports` (fatia 5); `document-archive`
 * has no restriction in `.dependency-cruiser.cjs`/`eslint.config.js` against being imported BY
 * another module's application layer - only `domain/**` files are fenced off from reaching
 * another module's application/ports/http/persistence layers. Fatia 2's
 * `buildCreateDocumentEntries` note ("document-archive não pode importar subject/**") is about
 * the OPPOSITE direction (document-archive reaching into subject), not this one.
 */
import { documentTypeKey, documentTypeNamePointerKey, type DocumentType, type DocumentTypeNamePointer } from "../../document-archive/domain/document-type.js";
import type { DocumentArchiveStore } from "../../document-archive/ports/document-archive-store.js";

export type DocumentTypeReferenceKind = "DISPLAY_NAME" | "DOCUMENT_TYPE_ID";

export type DocumentTypeReferenceResolution =
  | { kind: "RESOLVED"; documentTypeId: string }
  // §4's exact rejection reason: "referência não resolvida -> REJECT
  // reason=DOCUMENT_TYPE_NOT_FOUND" - covers both "pointer/id doesn't exist" AND "resolves to a
  // non-ACTIVE DocumentType" (DEPRECATED) as the SAME external reason.
  | { kind: "NOT_FOUND" };

/**
 * Resolves a batch of DocumentType references (mixed `DISPLAY_NAME`/`DOCUMENT_TYPE_ID` kind per
 * row is NOT supported here - a single `ColumnMapping` fixes one `documentTypeRefKind` for the
 * whole file, D-192 §2 - callers pass the one kind that applies to the whole batch) to a `Map`
 * keyed by the RAW reference value exactly as it appeared in the CSV cell, so callers can look
 * up each row's outcome by its own raw value without re-deriving anything.
 */
export async function resolveDocumentTypeReferences(
  documentArchiveStore: DocumentArchiveStore,
  tenantId: string,
  refKind: DocumentTypeReferenceKind,
  rawValues: readonly string[],
): Promise<Map<string, DocumentTypeReferenceResolution>> {
  const distinctRawValues = [...new Set(rawValues)];
  const result = new Map<string, DocumentTypeReferenceResolution>();
  if (distinctRawValues.length === 0) return result;

  // Phase 1 (DISPLAY_NAME only): distinct raw values -> documentTypeId, via
  // DocumentTypeNamePointer. Phase 2 works directly off distinct raw values when refKind is
  // already DOCUMENT_TYPE_ID.
  const rawValueToDocumentTypeId = new Map<string, string>();
  if (refKind === "DISPLAY_NAME") {
    const pointerKeys = distinctRawValues.map((normalizedName) => documentTypeNamePointerKey(tenantId, normalizedName));
    const pointers = await documentArchiveStore.batchGet<DocumentTypeNamePointer>(pointerKeys);
    const pointerByNormalizedName = new Map(pointers.map((p) => [p.normalizedName, p]));
    for (const rawValue of distinctRawValues) {
      const pointer = pointerByNormalizedName.get(rawValue);
      if (pointer) rawValueToDocumentTypeId.set(rawValue, pointer.documentTypeId);
      else result.set(rawValue, { kind: "NOT_FOUND" });
    }
  } else {
    for (const rawValue of distinctRawValues) rawValueToDocumentTypeId.set(rawValue, rawValue);
  }

  // Phase 2: distinct documentTypeIds (deduped AGAIN here - two different display names could
  // in principle point at the same documentTypeId via a rename race, and DOCUMENT_TYPE_ID-kind
  // rows can repeat the same id across many rows) -> real DocumentType, status checked NOW.
  const distinctDocumentTypeIds = [...new Set(rawValueToDocumentTypeId.values())];
  if (distinctDocumentTypeIds.length > 0) {
    const documentTypeKeys = distinctDocumentTypeIds.map((documentTypeId) => documentTypeKey(tenantId, documentTypeId));
    const documentTypes = await documentArchiveStore.batchGet<DocumentType>(documentTypeKeys);
    const documentTypeById = new Map(documentTypes.map((dt) => [dt.documentTypeId, dt]));

    for (const [rawValue, documentTypeId] of rawValueToDocumentTypeId) {
      const documentType = documentTypeById.get(documentTypeId);
      result.set(rawValue, documentType && documentType.status === "ACTIVE" ? { kind: "RESOLVED", documentTypeId } : { kind: "NOT_FOUND" });
    }
  }

  return result;
}
