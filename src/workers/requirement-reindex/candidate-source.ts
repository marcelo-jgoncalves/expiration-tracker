/**
 * Narrow port for the RequirementReindexWorker (D-143 Decision 5, migrated to GSI8 by D-179
 * slice 4 — 4th of 9 workers, mirroring `document-file-reconciliation`'s own migration).
 *
 * Replaces the cross-tenant `Scan` filtered to `entityType = "Requirement" AND status =
 * "SATISFIED"` (`scanSatisfiedRequirements`, removed from `DocumentArchiveStore` by this slice —
 * no other caller ever used it) with a `Query` against GSI8 (`GSI8PK=WORK#REQUIREMENT_REINDEX`,
 * `GSI8SK=<evidenceValidUntil>#TENANT#<tenantId>#REQUIREMENT#<requirementId>`, `KEYS_ONLY`).
 *
 * Unlike `membership-purge`/`invitation-purge`, this worker has no tenant-lifecycle fence and no
 * poison-record/backoff/DLQ mechanism: the only failure mode a claim can hit is
 * `expectedVersion` no longer matching (a concurrent `linkEvidence`/`unlinkEvidence`/
 * `updateRequirement` already moved the Requirement past the version this query observed), which
 * is always transitory and self-heals on the next scheduled run from a fresh read — the exact
 * same "eventually consistent, never silently wrong" posture the pre-migration worker already
 * had, not a new guarantee this migration invents. Composing with the existing OCC-versioned
 * update in `reindex.ts` (rather than a separate claim/revalidate pair) is the whole point of
 * this slice, same "don't duplicate a fence that already exists" discipline `document-file-
 * reconciliation` established for its own `applyFileScanTimeout()` composition.
 */
import type { EntityKey } from "../../shared/dynamodb/occ.js";

export interface RequirementGsi8Candidate extends EntityKey {
  dueAtIso: string;
  tenantId: string;
  subjectId: string;
  requirementId: string;
}

export interface RequirementGsi8Page {
  items: RequirementGsi8Candidate[];
  lastEvaluatedKey?: Record<string, unknown>;
}

export interface RequirementReindexCandidateSource {
  /** `Query GSI8PK = "WORK#REQUIREMENT_REINDEX" AND GSI8SK < :before`, ordered by due date.
   * `tenantId`/`subjectId`/`requirementId` are parsed from the base table's own `PK`/`SK`
   * (`requirementKey()`'s shape), never re-derived from `GSI8SK` — `KEYS_ONLY` already returns
   * them for free. The full `Requirement` (status/applicability/evidenceState/version) is always
   * re-fetched fresh by the worker before acting — GSI8 is discovery-only, never a source of
   * eligibility (same posture every other GSI8 consumer holds). */
  queryDue(input: { before: string; exclusiveStartKey?: Record<string, unknown> }): Promise<RequirementGsi8Page>;
}
