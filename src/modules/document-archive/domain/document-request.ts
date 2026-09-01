/**
 * DocumentRequest — document-archive's OWN minimal shape, D-143 Decision 4 (guest access). NOT
 * the older `src/modules/subject/domain/document-request.ts` (that entity belongs to the
 * subject module's M10 guest-upload slice, keyed under `TENANT#t#SUBJECT#s`/
 * `REQASSIGN#<assignmentId>#DOCREQ#<id>` and carrying its own `tokenSelectorHash` inline) — this
 * is a distinct, new entity scoped to the document-archive domain (Document/DocumentVersion/
 * Requirement), the one `estado-final-consolidado.md` Decision 8 (recurrence) references via
 * `requestId`/`attemptIndex`/`seriesId`.
 *
 * Deliberately minimal: this task (guest access, D-143 Decision 4) only needs "the business
 * request a RequestAccessCredential is issued against" — id/subjectId/tenantId/requirementId/
 * status/deadline. Recurrence (Decision 8, a separate follow-up task) is expected to ADD
 * `seriesId`/`occurrenceId`/`attemptIndex`/`parentRequestId` to this same entity rather than
 * introduce a parallel one — those fields are intentionally absent here, not forgotten.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

/** Mirrors the older subject-module DocumentRequest's status vocabulary (same states cover the
 * same real lifecycle — requested/opened/submitted/completed, plus the three ways it can die
 * early) — not reused by import (distinct module, distinct entity), just the same taxonomy. */
export type DocumentRequestStatus = "REQUESTED" | "OPENED" | "SUBMITTED" | "COMPLETED" | "CANCELLED" | "EXPIRED" | "REVOKED";

export interface DocumentRequest extends EntityKey {
  SK: `DOCREQUEST#${string}`;
  entityType: "DocumentRequest";
  documentRequestId: string;
  tenantId: string;
  subjectId: string;
  /** The Requirement this request asks the guest to satisfy — a request always targets exactly
   * one Requirement in this minimal shape (no fan-out to multiple Requirements per request). */
  requirementId: string;
  status: DocumentRequestStatus;
  /** Also the RequestAccessCredential's TTL (Decision 4: "TTL = prazo do Request de negócio") —
   * absent means no deadline, in which case credential issuance must supply an explicit TTL of
   * its own rather than defaulting to "forever" (see `issueRequestAccessCredential`). */
  deadline?: string;
  lastOpenedAt?: string;
  lastSubmissionId?: string;
  submissionCount: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function documentRequestKey(tenantId: string, subjectId: string, documentRequestId: string): { PK: string; SK: `DOCREQUEST#${string}` } {
  return { PK: `TENANT#${tenantId}#SUBJECT#${subjectId}`, SK: `DOCREQUEST#${documentRequestId}` };
}

export const DOCUMENT_REQUEST_SK_PREFIX = "DOCREQUEST#";

/** States a resolved credential/session may still act against — mirrors
 * `GuestSubmissionService.resolveToken`'s terminal-status rejection list (subject module
 * precedent) applied to this module's own status vocabulary. */
export function isDocumentRequestLive(status: DocumentRequestStatus): boolean {
  return status !== "CANCELLED" && status !== "REVOKED" && status !== "EXPIRED" && status !== "COMPLETED";
}
