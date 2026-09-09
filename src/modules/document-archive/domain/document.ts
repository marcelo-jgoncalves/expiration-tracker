/**
 * Document — D-143 (`docs/architecture/reviews/document-domain-scoping/estado-final-consolidado.md`
 * Decisão 1/2). A durable logical entity (D1, `document-domain-functional-decisions.md`) —
 * `Document.status` only ever flips ACTIVE/ARCHIVED and never encodes validity or review state
 * (those live on `DocumentVersion`/`Requirement`). Archiving is safe by construction: Requirement
 * status derivation (Decision 5) reads from `DocumentVersion`, never from `Document.status`, so
 * archiving a Document can never silently change whether it satisfies a Requirement (closes
 * adversarial case A10 from `document-domain-wireframes-validation-plan.md`).
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { AuthorizedTenantId } from "../../identity/domain/authorization.js";
import type { DocumentTypeFieldValueType } from "./document-type.js";

export type DocumentStatus = "ACTIVE" | "ARCHIVED";

export interface Document extends EntityKey {
  SK: "METADATA";
  entityType: "Document";
  documentId: string;
  tenantId: string;
  subjectId: string;
  documentTypeId: string;
  status: DocumentStatus;
  /** D3: documents without an expiration date are a legitimate first-class case, never
   * forced to carry a fabricated validity. */
  hasValidity: boolean;
  /** Denormalized pointer to the single ACCEPTED version, updated transactionally in the
   * same TransactWriteItems that flips the previous current version to SUPERSEDED (Decision 2's
   * `acceptVersion` transaction) — never a second, separately-committed write. */
  currentVersionId?: string;
  /** D-218 fatia 2 (Roadmap P1 "metadata configurável por Document Type") — see
   * `docs/architecture/reviews/document-type-metadata-scoping/estado-final-consolidado.md`
   * Decision 2. Keyed by `fieldId` (never the field's renamable `name`), same identity-not-label
   * discipline as `documentTypeId` vs. `displayName`. `createDocument()` NEVER accepts nor
   * writes this — every Document starts with the key entirely ABSENT (sparse, not an empty
   * object), regardless of how many `required` fields the DocumentType declares (Decision 5) —
   * the only writer is `updateDocumentMetadataValues()` (`document-archive-service.ts`). */
  metadataValues?: Readonly<Record<string, DocumentMetadataValue>>;
  /** D-225 Decision 1 — sparse, atomic cap counter for `ExternalShareLink` (max
   * `MAX_ACTIVE_SHARE_LINKS_PER_DOCUMENT`). Every writer uses `if_not_exists(...,0)` and never
   * allows underflow (`external-share-link-service.ts` is the sole writer, always inside the
   * SAME `TransactWriteItems` as the link Put/Update it accompanies). */
  activeExternalShareLinkCount?: number;
  createdAt: string;
  updatedAt: string;
  version: number;
  GSI1PK: string;
  GSI1SK: string;
  GSI2PK: string;
  GSI2SK: string;
}

/** D-218 Decision 2 — one value of `Document.metadataValues`, discriminated by `valueType` so
 * the compiler enforces `value`'s shape matches the type declared, never a mismatched pair
 * constructed by accident. `valueType` is copied from the `DocumentTypeMetadataFieldDefinition`
 * AT WRITE TIME (immutable there too, Decision 3) — this value is self-describing and never
 * needs to re-read the current field definition to know how to interpret itself, even if that
 * definition is later archived (checklist criterion 2). `documentTypeVersionAtWrite` is
 * TRACEABILITY ONLY (which `DocumentType.version` was in effect when this was written) — never
 * the source of correctness, which comes from `valueType` immutability + `optionId` stability. */
export type DocumentMetadataValue =
  | { valueType: "TEXT"; value: string; documentTypeVersionAtWrite: number; updatedAt: string; updatedBy: string }
  | { valueType: "NUMBER"; value: number; documentTypeVersionAtWrite: number; updatedAt: string; updatedBy: string }
  | { valueType: "DECIMAL"; value: string; documentTypeVersionAtWrite: number; updatedAt: string; updatedBy: string }
  | { valueType: "DATE"; value: string; documentTypeVersionAtWrite: number; updatedAt: string; updatedBy: string }
  | { valueType: "BOOLEAN"; value: boolean; documentTypeVersionAtWrite: number; updatedAt: string; updatedBy: string }
  | { valueType: "SINGLE_SELECT"; optionId: string; labelSnapshot: string; documentTypeVersionAtWrite: number; updatedAt: string; updatedBy: string };

/** Compile-time proof (same "independently-maintained, bidirectional `extends`" idiom as
 * `test/architecture/system-mutation-allowlist.test.ts`) that `DocumentMetadataValue`'s
 * `valueType` variants stay exactly in sync with `DocumentTypeFieldValueType` (`document-type.ts`)
 * — the two taxonomies are declared independently (one describes a field DEFINITION, the other
 * a stored VALUE) but must never silently drift apart. */
type AssertValueTypesMatchFieldTypes = DocumentMetadataValue["valueType"] extends DocumentTypeFieldValueType
  ? DocumentTypeFieldValueType extends DocumentMetadataValue["valueType"]
    ? true
    : ["FAIL: DocumentTypeFieldValueType has a member DocumentMetadataValue's valueType union is missing"]
  : ["FAIL: DocumentMetadataValue's valueType union has a member not in DocumentTypeFieldValueType"];
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- compile-time-only proof, never read at runtime.
const _assertValueTypesMatch: AssertValueTypesMatchFieldTypes = true;

/** D-218 Decision 2/5 — input for one field of `PATCH .../metadata-values`. `null` clears the
 * field entirely (removes the `fieldId` key from `Document.metadataValues`); a field simply
 * ABSENT from the input record means "do not touch" (true partial update) — these are two
 * distinct operations, never conflated (see `updateDocumentMetadataValues`'s doc comment). The
 * raw value shape mirrors `DocumentMetadataValue` minus the server-computed provenance fields
 * (`documentTypeVersionAtWrite`/`updatedAt`/`updatedBy`) and minus `labelSnapshot` (derived
 * server-side from the option's current `label`, never accepted from the caller). */
export type DocumentMetadataValueInput =
  | { valueType: "TEXT"; value: string }
  | { valueType: "NUMBER"; value: number }
  | { valueType: "DECIMAL"; value: string }
  | { valueType: "DATE"; value: string }
  | { valueType: "BOOLEAN"; value: boolean }
  | { valueType: "SINGLE_SELECT"; optionId: string }
  | null;

export const MAX_METADATA_TEXT_VALUE_CHARS = 500;
export const MAX_METADATA_DECIMAL_INTEGER_DIGITS = 15;
export const MAX_METADATA_DECIMAL_FRACTION_DIGITS = 4;
export const MAX_METADATA_NUMBER_ABS_VALUE = 1_000_000_000_000;
const DECIMAL_PATTERN = new RegExp(`^-?\\d{1,${MAX_METADATA_DECIMAL_INTEGER_DIGITS}}(\\.\\d{1,${MAX_METADATA_DECIMAL_FRACTION_DIGITS}})?$`);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** D-218 Decision 8 — the closed storage-representation rules for each `DocumentTypeFieldValueType`,
 * shared by whatever validates a raw `DocumentMetadataValueInput` before it is written (this
 * module owns the RULE, `document-archive-service.ts` owns the transactional WRITE). Returns a
 * human-readable reason string when invalid, `undefined` when the value is well-formed for its
 * declared type — deliberately never throws, so callers can attach their own error type/details. */
export function describeMetadataValueFormatError(input: Exclude<DocumentMetadataValueInput, null>): string | undefined {
  switch (input.valueType) {
    case "TEXT":
      if (input.value.length > MAX_METADATA_TEXT_VALUE_CHARS) return `TEXT value exceeds ${MAX_METADATA_TEXT_VALUE_CHARS} characters.`;
      return undefined;
    case "NUMBER":
      if (!Number.isInteger(input.value)) return "NUMBER value must be an integer (never money — use DECIMAL for that).";
      if (Math.abs(input.value) > MAX_METADATA_NUMBER_ABS_VALUE) return `NUMBER value exceeds the allowed magnitude of ${MAX_METADATA_NUMBER_ABS_VALUE}.`;
      return undefined;
    case "DECIMAL":
      if (!DECIMAL_PATTERN.test(input.value)) return "DECIMAL value must be a normalized decimal string (e.g. \"1234.56\"), never a float literal.";
      return undefined;
    case "DATE":
      if (!DATE_PATTERN.test(input.value) || !isValidCalendarDate(input.value)) return "DATE value must be a real calendar date in YYYY-MM-DD format (civil date, no time/timezone).";
      return undefined;
    case "BOOLEAN":
      return undefined;
    case "SINGLE_SELECT":
      if (input.optionId.trim().length === 0) return "SINGLE_SELECT value must carry a non-empty optionId.";
      return undefined;
  }
}

/** `Date.parse`/`new Date(...)` silently normalizes an out-of-range day/month (e.g.
 * "2026-02-30" becomes March 2nd) instead of rejecting it — this reconstructs the ISO string
 * from the parsed components and compares, the same "does it round-trip" idiom used elsewhere
 * in the codebase for civil-date validation, never a second bespoke calendar implementation. */
function isValidCalendarDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

export function documentKey(tenantId: AuthorizedTenantId, documentId: string): { PK: string; SK: "METADATA" } {
  return { PK: `TENANT#${tenantId}#DOCUMENT#${documentId}`, SK: "METADATA" };
}

/** GSI1 (discriminated by prefix — same GSI1 index physically shared with ExpirationItem's
 * ITEMSTATUS/Requirement's REQSTATUS namespaces, never a new index): Documents by
 * Organization+status, ordered by most-recently-updated (AP4) — not by Subject, which is a
 * separate access pattern (AP3, GSI2). */
export function documentGsi1Keys(tenantId: AuthorizedTenantId, status: DocumentStatus, updatedAt: string, documentId: string): { GSI1PK: string; GSI1SK: string } {
  return {
    GSI1PK: `TENANT#${tenantId}#DOCSTATUS#${status}`,
    GSI1SK: `UPDATED#${updatedAt}#DOCUMENT#${documentId}`,
  };
}

/** GSI2 (new index, AP3 — verified free of any existing writer in the codebase before this
 * module claimed it, see D-143 Decision 2/round2-codex-critique.md's corrected finding):
 * Documents by Subject, grouped by DocumentType (D-173 §5: keyed by the stable
 * documentTypeId, not the renamable displayName — renaming a DocumentType must never move
 * where an existing Document sits in this index). */
export function documentGsi2Keys(tenantId: AuthorizedTenantId, subjectId: string, documentTypeId: string, documentId: string): { GSI2PK: string; GSI2SK: string } {
  return {
    GSI2PK: `TENANT#${tenantId}#SUBJECT#${subjectId}#DOC`,
    GSI2SK: `DOCTYPE#${documentTypeId}#DOCUMENT#${documentId}`,
  };
}

export interface CreateDocumentInput {
  subjectId: string;
  documentTypeId: string;
  hasValidity: boolean;
}
