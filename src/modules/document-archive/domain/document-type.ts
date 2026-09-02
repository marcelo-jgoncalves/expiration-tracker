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
  createdAt: string;
  updatedAt: string;
  version: number;
  GSI1PK: string;
  GSI1SK: string;
}

export function documentTypeKey(tenantId: string, documentTypeId: string): { PK: string; SK: "METADATA" } {
  return { PK: `TENANT#${tenantId}#DOCTYPE#${documentTypeId}`, SK: "METADATA" };
}

/** GSI1 (discriminated by prefix — same physical GSI1 index already shared by Document/
 * ExpirationItem/Requirement's own status namespaces, no new index): DocumentTypes by
 * status, ordered by normalized name so a catalog listing sorts alphabetically for free. */
export function documentTypeGsi1Keys(tenantId: string, status: DocumentTypeStatus, normalizedName: string, documentTypeId: string): { GSI1PK: string; GSI1SK: string } {
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

export function documentTypeNamePointerKey(tenantId: string, normalizedName: string): { PK: string; SK: "POINTER" } {
  return { PK: `TENANT#${tenantId}#DOCTYPENAME#${normalizedName}`, SK: "POINTER" };
}

export interface CreateDocumentTypeInput {
  displayName: string;
}
