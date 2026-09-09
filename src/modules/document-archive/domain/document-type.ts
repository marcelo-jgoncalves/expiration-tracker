/**
 * DocumentType — D-173 (`docs/architecture/reviews/document-type-scoping/
 * estado-final-consolidado.md` §1). Tenant-scoped catalog entry closing item 8 of D-161's
 * macro-order: gives DocumentType a stable, renamable-but-identity-stable identity a future
 * `Requirement` can reference (item 1, Requirement Templates). `Document.documentTypeId`
 * (item 4 of the design doc's "Próximo passo real") stores this id, not the renamable
 * `displayName` — GSI2 partitions by it so renaming a DocumentType never moves an existing
 * Document.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { AuthorizedTenantId } from "../../identity/domain/authorization.js";

export type DocumentTypeStatus = "ACTIVE" | "DEPRECATED";

export interface DocumentType extends EntityKey {
  SK: "METADATA";
  entityType: "DocumentType";
  documentTypeId: string;
  tenantId: string;
  /** Renamable — never used as the entity's identity (documentTypeId is, immutable, ULID,
   * never reused). */
  displayName: string;
  status: DocumentTypeStatus;
  /** D-218 (Roadmap P1, "metadata configurável por Document Type") — see
   * `docs/architecture/reviews/document-type-metadata-scoping/estado-final-consolidado.md`.
   * Embedded (not a separate entity), same convention as `RequirementTemplate.items` (D-191) —
   * the whole array is read/replaced together, never paginated independently. Absent (not an
   * empty array) until the first field is created, same sparse idiom as every other optional
   * field on this entity. */
  metadataFields?: readonly DocumentTypeMetadataFieldDefinition[];
  createdAt: string;
  updatedAt: string;
  version: number;
  GSI1PK: string;
  GSI1SK: string;
}

/** D-218 Decision 8 — closed taxonomy, each with an unambiguous storage representation.
 * `NUMBER` is an integer count/quantity, NEVER money (`DECIMAL` is); `DATE` is a civil date
 * (`YYYY-MM-DD`, no time/timezone), never a full timestamp. Deliberately distinct from
 * `extraction/domain/extracted-field.ts`'s `ExtractedFieldValueType` (`DATE`/`STRING`/
 * `NUMBER`, an OCR/extraction concept) — two different contracts, never reused one for the
 * other. */
export type DocumentTypeFieldValueType = "TEXT" | "NUMBER" | "DECIMAL" | "DATE" | "BOOLEAN" | "SINGLE_SELECT";

/** Never removed physically once created (D-218 checklist criterion 3, "tombstone, never
 * delete") — `ARCHIVED` only blocks NEW/EDITED values from referencing it (fenced at the
 * value-write boundary), it never invalidates a `Document.metadataValues` entry already
 * written under it. */
export type DocumentTypeFieldStatus = "ACTIVE" | "ARCHIVED";

/** Same tombstone discipline as `DocumentTypeFieldStatus` above, applied to one option of a
 * `SINGLE_SELECT` field. */
export type DocumentTypeFieldOptionStatus = "ACTIVE" | "ARCHIVED";

export const MAX_ACTIVE_METADATA_FIELDS = 20;
export const MAX_TOTAL_METADATA_FIELD_DEFINITIONS = 100;
export const MAX_ACTIVE_OPTIONS_PER_FIELD = 50;
export const MAX_TOTAL_OPTIONS_PER_FIELD = 150;
export const MAX_METADATA_FIELD_NAME_CHARS = 200;
export const MAX_METADATA_FIELD_OPTION_LABEL_CHARS = 200;

/** D-218 Decision 4/8 — `optionId` is the stable identity (ULID, immutable, never reused);
 * `label` is renamable and never used to key a stored value (`Document.metadataValues`' own
 * `SINGLE_SELECT` variant stores `optionId` + a `labelSnapshot` copy, never the live `label`
 * alone — see `document.ts`). Only meaningful when the owning field's `valueType ===
 * "SINGLE_SELECT"`. */
export interface DocumentTypeFieldOption {
  optionId: string;
  label: string;
  status: DocumentTypeFieldOptionStatus;
}

/** D-218 Decision 1/3 — one entry of `DocumentType.metadataFields`. `valueType` is IMMUTABLE
 * once created (Decision 3, the design's strongest invariant): no operation in this module's
 * service layer ever accepts a `valueType` change for an existing `fieldId` — changing type
 * means archiving this field and creating a new one (`fieldId` is never reused, so this is
 * always an expand, never an in-place mutation that could reinterpret an existing stored
 * value under the old type). */
export interface DocumentTypeMetadataFieldDefinition {
  fieldId: string;
  name: string;
  valueType: DocumentTypeFieldValueType;
  /** Prospective only (Decision 5) — never validated against a Document that is not currently
   * being written; `createDocument()` never consults this field at all (see `document.ts`'s
   * doc comment on `metadataValues`). */
  required: boolean;
  /** Present only when `valueType === "SINGLE_SELECT"`. */
  options?: readonly DocumentTypeFieldOption[];
  status: DocumentTypeFieldStatus;
  createdAt: string;
  updatedAt: string;
}

export function documentTypeKey(tenantId: AuthorizedTenantId, documentTypeId: string): { PK: string; SK: "METADATA" } {
  return { PK: `TENANT#${tenantId}#DOCTYPE#${documentTypeId}`, SK: "METADATA" };
}

/** GSI1 (discriminated by prefix — same physical GSI1 index already shared by Document/
 * ExpirationItem/Requirement's own status namespaces, no new index): DocumentTypes by
 * status, ordered by normalized name so a catalog listing sorts alphabetically for free. */
export function documentTypeGsi1Keys(tenantId: AuthorizedTenantId, status: DocumentTypeStatus, normalizedName: string, documentTypeId: string): { GSI1PK: string; GSI1SK: string } {
  return {
    GSI1PK: `TENANT#${tenantId}#DOCTYPESTATUS#${status}`,
    GSI1SK: `NAME#${normalizedName}#DOCTYPE#${documentTypeId}`,
  };
}

/** Dedupe pointer — §2 of the design doc. One pointer row per (tenant, normalizedName),
 * created/deleted transactionally alongside the DocumentType it names so two concurrent
 * creators (or a rename landing on an in-use name) can never both succeed. */
export interface DocumentTypeNamePointer extends EntityKey {
  SK: "POINTER";
  entityType: "DocumentTypeNamePointer";
  tenantId: string;
  normalizedName: string;
  documentTypeId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function documentTypeNamePointerKey(tenantId: AuthorizedTenantId, normalizedName: string): { PK: string; SK: "POINTER" } {
  return { PK: `TENANT#${tenantId}#DOCTYPENAME#${normalizedName}`, SK: "POINTER" };
}

export interface CreateDocumentTypeInput {
  displayName: string;
}

/** D-218 — input for creating one `DocumentTypeMetadataFieldDefinition`. `options` is only
 * meaningful (and only validated) when `valueType === "SINGLE_SELECT"`; each entry is a bare
 * label — `optionId`s are always minted by the service, never accepted from the caller (an
 * option is never renamed by re-supplying the same string twice, see `UpdateDocumentTypeMetadataFieldInput.optionsPatch`). */
export interface CreateDocumentTypeMetadataFieldInput {
  name: string;
  valueType: DocumentTypeFieldValueType;
  required: boolean;
  options?: readonly string[];
}

/** D-218 Decision 7 — one PATCH endpoint covers both the field itself (name/required/status)
 * and its options (`optionsPatch`), because both live inside the same embedded array inside
 * the same `DocumentType` item — one OCC-fenced write, never two separate concurrency
 * mechanisms. `valueType` is deliberately NOT a field here (Decision 3 — immutable). */
export interface UpdateDocumentTypeMetadataFieldInput {
  name?: string;
  required?: boolean;
  status?: DocumentTypeFieldStatus;
  optionsPatch?: readonly DocumentTypeFieldOptionPatchOp[];
}

export type DocumentTypeFieldOptionPatchOp =
  | { op: "ADD"; label: string }
  | { op: "RENAME"; optionId: string; label: string }
  | { op: "ARCHIVE"; optionId: string }
  | { op: "REACTIVATE"; optionId: string };
