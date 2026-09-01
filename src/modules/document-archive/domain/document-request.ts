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
 * status/deadline. Recurrence (Decision 8, D-147) ADDS `seriesId`/`occurrenceId`/
 * `attemptIndex`/`parentRequestId` below rather than introducing a parallel entity.
 *
 * D-147 (Decision 8, recurrence): all four new fields are OPTIONAL/additive — a bare
 * `DocumentRequest` created outside a series (the only kind guest access's existing tests
 * construct) simply omits them, same "no fabricated value" discipline as every other optional
 * field in this module (`requirement.ts`'s `evidenceValidUntil`, etc.). `attemptIndex` is the
 * one exception worth calling out: it defaults to `1` for a non-recurring request (see
 * `document-request-series.ts`'s `materializeAttempt`), so it is typed as a required `number`
 * with `1` as the implicit non-recurring value, not `attemptIndex?: number` — every
 * DocumentRequest that exists IS exactly one attempt, whether or not it belongs to a series.
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
  /** D-147 (Decision 8): present only when this request belongs to a `DocumentRequestSeries`
   * cycle — see `document-request-series.ts` for the series/cycle/attempt shape. */
  seriesId?: string;
  /** Deterministic per-cycle id (`computeSeriesOccurrenceId`) — stable across every attempt of
   * the SAME cycle, changes only when the series advances to its next cycle. Never present
   * without `seriesId`. */
  occurrenceId?: string;
  /** Which attempt within the cycle this is — `1` for a series' first attempt of a cycle,
   * incrementing on each `materializeAttempt` call within the same cycle. Optional (not
   * defaulted to `1`) rather than required: a bare, non-recurring `DocumentRequest` (guest
   * access's existing shape, no `seriesId`) has no cycle at all, so "attempt 1 of what?" does
   * not apply to it — forcing a fabricated `1` onto every non-recurring request would violate
   * this module's "no fabricated value" discipline (see `requirement.ts`'s `evidenceValidUntil`
   * for the same principle applied elsewhere). Always present together with `seriesId`. */
  attemptIndex?: number;
  /** Always the immediately-previous attempt of the SAME cycle (never the previous cycle's
   * last attempt) — preserves causality within a cycle while `occurrenceId` preserves cycle
   * identity across attempts (D-147/Decision 8). Absent for attempt 1 of any cycle. */
  parentRequestId?: string;
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
