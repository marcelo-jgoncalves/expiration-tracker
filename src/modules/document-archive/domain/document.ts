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

export type DocumentStatus = "ACTIVE" | "ARCHIVED";

export interface Document extends EntityKey {
  SK: "METADATA";
  entityType: "Document";
  documentId: string;
  tenantId: string;
  subjectId: string;
  documentType: string;
  status: DocumentStatus;
  /** D3: documents without an expiration date are a legitimate first-class case, never
   * forced to carry a fabricated validity. */
  hasValidity: boolean;
  /** Denormalized pointer to the single ACCEPTED version, updated transactionally in the
   * same TransactWriteItems that flips the previous current version to SUPERSEDED (Decision 2's
   * `acceptVersion` transaction) — never a second, separately-committed write. */
  currentVersionId?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  GSI1PK: string;
  GSI1SK: string;
}

export function documentKey(tenantId: string, documentId: string): { PK: string; SK: "METADATA" } {
  return { PK: `TENANT#${tenantId}#DOCUMENT#${documentId}`, SK: "METADATA" };
}

/** GSI1 (discriminated by prefix — same GSI1 index physically shared with ExpirationItem's
 * ITEMSTATUS/Requirement's REQSTATUS namespaces, never a new index): Documents by
 * Organization+status, ordered by most-recently-updated (AP4) — not by Subject, which is a
 * separate access pattern (AP3, GSI2). */
export function documentGsi1Keys(tenantId: string, status: DocumentStatus, updatedAt: string, documentId: string): { GSI1PK: string; GSI1SK: string } {
  return {
    GSI1PK: `TENANT#${tenantId}#DOCSTATUS#${status}`,
    GSI1SK: `UPDATED#${updatedAt}#DOCUMENT#${documentId}`,
  };
}

/** GSI2 (new index, AP3 — verified free of any existing writer in the codebase before this
 * module claimed it, see D-143 Decision 2/round2-codex-critique.md's corrected finding):
 * Documents by Subject, grouped by documentType. */
export function documentGsi2Keys(tenantId: string, subjectId: string, documentType: string, documentId: string): { GSI2PK: string; GSI2SK: string } {
  return {
    GSI2PK: `TENANT#${tenantId}#SUBJECT#${subjectId}#DOC`,
    GSI2SK: `DOCTYPE#${documentType}#DOCUMENT#${documentId}`,
  };
}

export interface CreateDocumentInput {
  subjectId: string;
  documentType: string;
  hasValidity: boolean;
}
