/**
 * Requirement — D-143 (`docs/architecture/reviews/document-domain-scoping/
 * estado-final-consolidado.md` Decision 5) + `document-domain-functional-decisions.md` D9.
 * "Algo que um Subject precisa possuir, apresentar ou manter válido." Entity #1 of Nucleus 2
 * (guest access and recurrence are separate, deferred follow-ups per D-143 — not implemented
 * here).
 *
 * `applicability` is a PERSISTED fact (Decision 5 explicitly corrects an earlier draft that
 * tried to derive it) — it is never inferred from evidence, only ever set by an explicit
 * caller action (`createRequirement`/`updateRequirement`).
 *
 * `status` is a DERIVED value, computed by `deriveRequirementStatus` below from
 * `applicability` + `evidenceVersionId` + the referenced DocumentVersion's `state`/
 * `validUntil` — it is stored (denormalized, for GSI1 status-filtered listing without a full
 * table scan) but re-derived and rewritten on every mutation that could change its inputs
 * (`linkEvidence`/`unlinkEvidence`/`updateRequirement`'s applicability change, and the daily
 * reindex worker for pure time-based drift — SATISFIED -> NOT_SATISFIED as `validUntil`
 * passes with no other write ever touching the Requirement).
 *
 * `EXPIRING` is deliberately NOT part of `RequirementStatus` — Decision 5/D9: it is a
 * read-time subdivision of SATISFIED, computed the same way `frontend/src/api/presentation.ts`'s
 * `presentItemUrgency` already subdivides an ACTIVE ExpirationItem into "vence em breve"/no
 * urgency (`SOON_THRESHOLD_DAYS = 7`) — mirrored here as `deriveRequirementUrgency` so the same
 * 7-day window means the same thing across both domains, without a second persisted state.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";
import type { UnifiedValidityState } from "../../../shared/domain/validity-state.js";
import { deriveValidityStateFromExpiry } from "../../../shared/domain/validity-state.js";
import type { DocumentVersionState } from "./document-version.js";
import { isTerminalDocumentVersionState } from "./document-version.js";

/** Persisted fact — never derived (Decision 5). */
export type RequirementApplicability = "APPLICABLE" | "NOT_APPLICABLE";

/** Persisted, derived status — see module doc comment for the derivation contract.
 * `EXPIRING` is intentionally absent (D9: read-time subdivision of SATISFIED only). */
export type RequirementStatus = "MISSING" | "PENDING" | "SATISFIED" | "NOT_SATISFIED" | "NOT_APPLICABLE";

export interface Requirement extends EntityKey {
  entityType: "Requirement";
  requirementId: string;
  tenantId: string;
  subjectId: string;
  /** Free-text label of what is required (e.g. "Certidão de antecedentes"), same style as
   * the older subject-module `RequirementAssignment.requirementName` — a distinct concept
   * per D9, not reused (see `identity/domain/authorization.ts`'s naming-collision comment). */
  name: string;
  notes?: string;
  applicability: RequirementApplicability;
  /** Singular by design (Decision 5 explicitly corrects an earlier draft that modeled this as
   * a list) — a Requirement links to at most one CURRENT evidence DocumentVersion at a time. */
  evidenceVersionId?: string;
  /** The owning Document of `evidenceVersionId` — stored alongside it (not resolved via a GSI
   * lookup) because D-143 Decision 2's `versionLookupGsi5Keys` (AP11, reserved for exactly
   * this "resolve a versionId to its Document" need) shares its GSI5PK/GSI5SK attributes with
   * the sparse review-queue index (`document-version.ts`'s `reviewQueueGsi5Keys`), which
   * REMOVES them the moment a version leaves RECEIVED/UNDER_REVIEW — permanently occupying
   * that same attribute pair for version-lookup would make it disappear right when a version
   * becomes ACCEPTED, the only state a Requirement actually needs to look it up in. Denormalizing
   * `evidenceDocumentId` here avoids that conflict entirely without touching GSI5's existing
   * contract. Always present together with `evidenceVersionId` (both set/cleared atomically). */
  evidenceDocumentId?: string;
  /** The `seq` of the evidence DocumentVersion within its Document — combined with
   * `evidenceDocumentId`, lets a caller navigate straight to `documentVersionKey()` without a
   * second lookup. Always present together with `evidenceVersionId`/`evidenceDocumentId`. */
  evidenceSeq?: number;
  /** `state`/`validUntil` of the evidence DocumentVersion AT LINK TIME — the exact inputs
   * `deriveRequirementStatus` needs, cached here (not re-read live) so the daily reindex worker
   * (module doc comment) only ever compares `evidenceValidUntil` against "now", never re-fetches
   * the DocumentVersion row. Refreshed together with `evidenceVersionId` on every `linkEvidence`
   * call; a DocumentVersion whose state changes AFTER the link (e.g. accepted evidence later
   * superseded elsewhere) is caught the next time something re-links or re-derives this
   * Requirement, not instantly — the same bounded-staleness window Decision 5 accepts. */
  evidenceState?: DocumentVersionState;
  evidenceValidUntil?: string;
  status: RequirementStatus;
  /** Provenance of a Requirement materialized by `applyTemplate` (P0.1) — AUDIT TRAIL ONLY.
   * No read path, derivation or worker ever consults these three: applying a RequirementTemplate
   * is a SNAPSHOT (copy), never a live link, so editing/archiving/deleting the template later
   * must not reach a Requirement that already exists. `sourceTemplateAppliedVersion` is the
   * template version the apply transaction actually FENCED on (`status = ACTIVE AND version =`),
   * so it is a protected fact rather than "the version I happened to read before the race". */
  sourceTemplateId?: string;
  sourceTemplateItemId?: string;
  sourceTemplateAppliedVersion?: number;
  createdAt: string;
  updatedAt: string;
  version: number;
  GSI1PK: string;
  GSI1SK: string;
  /** MaintenanceDueIndex pointer (D-179/D-185, 4th of 9 workers migrated) — present only while
   * `status === "SATISFIED"` AND `evidenceValidUntil` is set (see `deriveRequirementMaintenanceDue`
   * below); absent otherwise (MISSING/PENDING/NOT_SATISFIED/NOT_APPLICABLE, or a SATISFIED
   * evidence with no expiration, never drifts on its own). */
  GSI8PK?: string;
  GSI8SK?: string;
  /** GSI_EVIDENCE reverse index (D-193 slice 5, physical GSI9 — GSI1-GSI8 already claimed,
   * see `infra/modules/dynamo-table/main.tf`) — present ONLY while `evidenceVersionId` is set
   * (genuinely sparse, written/removed atomically together with `evidenceVersionId` inside
   * `linkEvidence`/`unlinkEvidence`, never left stale). Lets the async
   * `requirement-evidence-refresh` worker (D-193, next slice) find every Requirement
   * referencing a given DocumentVersion as evidence WITHOUT a direct transaction coupling
   * between `confirmField`/`rejectField` and `Requirement` — the exact decoupling D-193's design
   * calls for (`confirmField`/`rejectField` deliberately never touch `Requirement`). Tenant-scoped
   * (PK carries `TENANT#<t>#...`, unlike the tenantless GSI3/GSI6/GSI8), so it is a normal
   * `tenant_facing_index_names` entry, not an isolated-IAM index. */
  GSI9PK?: string;
  GSI9SK?: string;
}

/**
 * Co-located under the owning Subject's partition (Decision 5), the same collection pattern
 * already used by the older `subject/domain/requirement-assignment.ts`
 * (`TENANT#t#SUBJECT#s`/`REQASSIGN#a`) and by `subject/domain/document-request.ts`'s
 * co-location convention — a Requirement is not co-located under its Document (unlike
 * DocumentVersion/DocumentVersionEvent, which physically belong to one Document) because a
 * Requirement's lifecycle is owned by the Subject, not by whichever Document currently
 * satisfies it; `evidenceVersionId` is the only pointer across that boundary.
 */
export function requirementKey(tenantId: string, subjectId: string, requirementId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#SUBJECT#${subjectId}`, SK: `REQUIREMENT#${requirementId}` };
}

/** Prefix for `Query(PK, begins_with(SK, ...))` listing every Requirement of a Subject —
 * no GSI needed for this access pattern, same convention as `REQUIREMENT_ASSIGNMENT_SK_PREFIX`. */
export const REQUIREMENT_SK_PREFIX = "REQUIREMENT#";

/**
 * GSI1 (same physical index Document already claims for its DOCSTATUS namespace, discriminated
 * by prefix — REQSTATUS is a distinct namespace on the same GSI1, never a new index, per
 * Decision 5/`document.ts`'s `documentGsi1Keys` precedent): Requirements by Organization+status,
 * ordered by most-recently-updated — mirrors `documentGsi1Keys` exactly.
 */
export function requirementGsi1Keys(tenantId: string, status: RequirementStatus, updatedAt: string, requirementId: string): { GSI1PK: string; GSI1SK: string } {
  return {
    GSI1PK: `TENANT#${tenantId}#REQSTATUS#${status}`,
    GSI1SK: `UPDATED#${updatedAt}#REQUIREMENT#${requirementId}`,
  };
}

export interface CreateRequirementInput {
  subjectId: string;
  name: string;
  notes?: string;
  applicability: RequirementApplicability;
}

/** Fields an authenticated caller may change directly via `updateRequirement`. Never includes
 * `evidenceVersionId`/`status`/`version` — those are controlled by `linkEvidence`/
 * `unlinkEvidence` and the derivation function, never a free-form field update. */
export interface UpdateRequirementInput {
  name?: string;
  notes?: string;
  applicability?: RequirementApplicability;
}

/** The minimal shape of the linked evidence DocumentVersion this derivation needs — never the
 * full `DocumentVersion` type, so a caller can pass a partial read/projection. */
export interface EvidenceVersionForDerivation {
  state: DocumentVersionState;
  validUntil?: string;
}

/**
 * Pure status-derivation function (Decision 5) — no I/O, unit-testable in isolation, same
 * style/discipline as `document-version.ts`'s `assertValidDocumentVersionTransition`.
 *
 * Branch order matters and is deliberately fail-closed-toward-MISSING/NOT_SATISFIED:
 *  1. `applicability = NOT_APPLICABLE` always wins — status is NOT_APPLICABLE regardless of
 *     any evidence link (Decision 5: applicability is a persisted fact, evidence never
 *     overrides it).
 *  2. No evidence linked at all -> MISSING.
 *  3. Evidence linked but its DocumentVersion has not reached ACCEPTED yet (still DRAFT/
 *     RECEIVED/UNDER_REVIEW, or terminal-but-not-accepted like REJECTED/WITHDRAWN/SUPERSEDED
 *     — the latter two should never realistically be the CURRENT evidence pointer, but the
 *     function stays total rather than assuming a caller-side invariant) -> PENDING.
 *  4. Evidence ACCEPTED, no `validUntil` (document doesn't expire) or `validUntil` still in
 *     the future (`>= now`, not `> now` — a document valid through end-of-day today is not
 *     yet expired) -> SATISFIED.
 *  5. Evidence ACCEPTED but `validUntil` in the past -> NOT_SATISFIED.
 */
export function deriveRequirementStatus(
  applicability: RequirementApplicability,
  evidenceVersion: EvidenceVersionForDerivation | undefined,
  now: Date,
): RequirementStatus {
  if (applicability === "NOT_APPLICABLE") return "NOT_APPLICABLE";
  if (!evidenceVersion) return "MISSING";
  if (evidenceVersion.state !== "ACCEPTED") return "PENDING";
  if (!evidenceVersion.validUntil) return "SATISFIED";
  return new Date(evidenceVersion.validUntil).getTime() >= now.getTime() ? "SATISFIED" : "NOT_SATISFIED";
}

/** Same "vence em breve" window as `frontend/src/api/presentation.ts`'s `SOON_THRESHOLD_DAYS`
 * — kept as an independent constant (not imported across the backend/frontend boundary,
 * which this codebase never crosses) but MUST be changed together with that one if the
 * product decision behind the 7-day window ever changes. */
const EXPIRING_SOON_THRESHOLD_DAYS = 7;

/** D9: EXPIRING is a read-time subdivision of SATISFIED, never persisted. Only meaningful
 * when `status === "SATISFIED"` and a `validUntil` exists — returns `false` for every other
 * status (including a SATISFIED requirement whose evidence has no `validUntil` at all: a
 * document with no expiration can never be "about to expire"). */
export function isRequirementExpiringSoon(status: RequirementStatus, validUntil: string | undefined, now: Date): boolean {
  if (status !== "SATISFIED" || !validUntil) return false;
  const daysUntil = Math.ceil((new Date(validUntil).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return daysUntil >= 0 && daysUntil <= EXPIRING_SOON_THRESHOLD_DAYS;
}

/**
 * D-194 fatia 1: `UnifiedValidityState` adapter — the 8-line table from
 * `estado-final-consolidado.md` covering every real `status`x`evidenceState` combination
 * `deriveRequirementStatus` can produce. `NOT_APPLICABLE`/`MISSING` have no validity to present
 * (`undefined`); `PENDING` with evidence still mid-flow (not yet a terminal
 * `DocumentVersionState`) -> `AGUARDANDO_REVISAO`, but `PENDING` with a terminal-but-not-accepted
 * evidence (REJECTED/WITHDRAWN/SUPERSEDED — states `deriveRequirementStatus` stays total for but
 * that should never realistically be the CURRENT evidence pointer) is excluded (`undefined`)
 * rather than misrepresented as "awaiting review"; `SATISFIED` delegates to
 * `deriveValidityStateFromExpiry` (PERMANENTE/VALIDO/VENCENDO, never VENCIDO here — the
 * derivation invariant guarantees `evidenceValidUntil` is absent or still `>= now` whenever
 * `status === "SATISFIED"`); `NOT_SATISFIED` -> `VENCIDO` directly, no date math needed.
 */
export function deriveRequirementValidityState(
  requirement: Pick<Requirement, "status" | "evidenceState" | "evidenceValidUntil">,
  now: Date,
): UnifiedValidityState | undefined {
  switch (requirement.status) {
    case "NOT_APPLICABLE":
    case "MISSING":
      return undefined;
    case "PENDING":
      return requirement.evidenceState !== undefined && !isTerminalDocumentVersionState(requirement.evidenceState)
        ? "AGUARDANDO_REVISAO"
        : undefined;
    case "SATISFIED":
      return deriveValidityStateFromExpiry(requirement.evidenceValidUntil, now);
    case "NOT_SATISFIED":
      return "VENCIDO";
  }
}

/** GSI8 namespace for `requirement-reindex` (D-179/D-185, 4th of 9 MaintenanceDueIndex
 * migrations) — see the module doc comment / `requirement-reindex/reindex.ts` for why this is
 * `evidenceValidUntil`, not a second "reindex schedule" concept: the daily worker's ONLY job is
 * the pure time-based SATISFIED -> NOT_SATISFIED drift, and `evidenceValidUntil` compared against
 * `now` is exactly that `dueAt` (D-179 Round 3's correction). */
export const REQUIREMENT_REINDEX_WORK_TYPE = "REQUIREMENT_REINDEX";

/** Due only while `status === "SATISFIED"` AND an `evidenceValidUntil` exists — a SATISFIED
 * requirement whose evidence never expires (no `validUntil`) is SATISFIED forever, by
 * construction, and never needs a reindex. Every other status is never a candidate (MISSING/
 * PENDING/NOT_SATISFIED/NOT_APPLICABLE do not drift on their own — some other explicit mutation
 * is always the trigger for those). */
export function deriveRequirementMaintenanceDue(status: RequirementStatus, evidenceValidUntil: string | undefined): { dueAtIso: string } | undefined {
  if (status !== "SATISFIED" || !evidenceValidUntil) return undefined;
  return { dueAtIso: evidenceValidUntil };
}

/** `GSI8SK` embeds `requirementId` (not `subjectId`) for uniqueness — the candidate source
 * recovers `tenantId`/`subjectId`/`requirementId` from the base table's own `PK`/`SK`
 * (`requirementKey()`'s shape), same "KEYS_ONLY already returns them for free" posture as
 * `documentFileGsi8Keys()`. */
export function requirementGsi8Keys(input: { dueAtIso: string; tenantId: string; requirementId: string }): { GSI8PK: string; GSI8SK: string } {
  return {
    GSI8PK: `WORK#${REQUIREMENT_REINDEX_WORK_TYPE}`,
    GSI8SK: `${input.dueAtIso}#TENANT#${input.tenantId}#REQUIREMENT#${input.requirementId}`,
  };
}

/**
 * GSI_EVIDENCE (D-193 slice 5, physical GSI9): sparse reverse index from an evidence
 * `DocumentVersion` back to every `Requirement` that currently links it — `linkEvidence`
 * SETs these two attributes, `unlinkEvidence` REMOVEs them (genuinely absent afterward, never
 * set-to-null), same "removed field, not nulled field" discipline as GSI8's pointer above.
 * `GSI9SK` embeds `requirementId` for uniqueness (a Subject's Requirements never collide, but two
 * DIFFERENT Subjects' Requirements can legitimately reference the same evidence versionId, e.g.
 * two Requirements pointing at one shared certificate — the SK must disambiguate those, not just
 * be a constant marker). Deliberately NOT keyed by `subjectId` — the whole point of this index is
 * "which Requirement(s) reference this DocumentVersion", found from the DocumentVersion side,
 * where the caller does not yet know which Subject(s) to look under.
 */
/** The partition-key half of `requirementGsi9Keys()`, exposed standalone for the QUERY side
 * (the reverse-lookup caller has a `tenantId`/`evidenceVersionId` pair but no `requirementId` —
 * that's the whole point of the query) — `Query(GSI9PK = requirementGsi9PartitionKey(...))`
 * returns every `Requirement` currently linking that DocumentVersion, no `requirementId` needed
 * up front. `requirementGsi9Keys()` below reuses this rather than duplicating the template. */
export function requirementGsi9PartitionKey(tenantId: string, evidenceVersionId: string): string {
  return `TENANT#${tenantId}#DOCVERSION#${evidenceVersionId}`;
}

export function requirementGsi9Keys(input: { tenantId: string; evidenceVersionId: string; requirementId: string }): { GSI9PK: string; GSI9SK: string } {
  return {
    GSI9PK: requirementGsi9PartitionKey(input.tenantId, input.evidenceVersionId),
    GSI9SK: `REQUIREMENT#${input.requirementId}`,
  };
}
