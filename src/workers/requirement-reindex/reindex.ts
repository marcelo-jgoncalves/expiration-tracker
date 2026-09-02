/**
 * RequirementReindex — D-143 Decision 5 (`requirement.ts`'s module doc comment): the daily
 * job that keeps GSI1's REQSTATUS index coherent with pure TIME-based drift. A Requirement's
 * `status` is written eagerly on every mutation (`linkEvidence`/`unlinkEvidence`/
 * `updateRequirement`), but SATISFIED -> NOT_SATISFIED as `evidenceValidUntil` passes with NO
 * other write ever touching the Requirement is a transition nothing else triggers — this
 * worker is that trigger, run once a day (EventBridge Scheduler, same shape as
 * `reminder-reconciliation-handler.ts`'s DST pass).
 *
 * Migrated off the base-table `Scan` onto GSI8 by D-179 slice 4 (4th of 9 workers,
 * `candidate-source.ts`'s doc comment has the full rationale). GSI8 is discovery-only — every
 * candidate is re-fetched fresh via `store.get()` before acting, never trusted from the KEYS_ONLY
 * query result, same "GSI8 is never a source of eligibility" posture every other GSI8 consumer
 * holds. No poison-record/DLQ mechanism here (unlike `membership-purge`/`invitation-purge`):
 * there is no tenant-lifecycle fence that can fail permanently for the same candidate, only a
 * transient OCC conflict against a concurrent caller mutation, and that already self-heals on the
 * next scheduled run — same reasoning `document-file-reconciliation` used to skip it too.
 *
 * Reads ONLY the Requirement's own denormalized `evidenceState`/`evidenceValidUntil` (never
 * re-fetches the evidence DocumentVersion — see `requirement.ts`'s doc comment on why those
 * fields are cached), so this worker is a pure comparison against `now`, not a second source
 * of truth for evidence state.
 */
import { buildVersionedUpdate, isTransactionCanceled } from "../../shared/dynamodb/occ.js";
import type { DocumentArchiveStore } from "../../modules/document-archive/ports/document-archive-store.js";
import { deriveRequirementStatus, requirementGsi1Keys, requirementKey, type Requirement } from "../../modules/document-archive/domain/requirement.js";
import type { RequirementReindexCandidateSource } from "./candidate-source.js";

export interface RequirementReindexDeps {
  store: DocumentArchiveStore;
  candidates: RequirementReindexCandidateSource;
  tableName: string;
  now: () => string;
}

export interface RequirementReindexResult {
  scanned: number;
  transitioned: number;
  skippedConcurrentlyModified: number;
  /** A candidate the GSI8 query returned but a fresh re-read no longer supports transitioning —
   * evidence re-linked with a later `evidenceValidUntil` (or cleared entirely) between the query
   * and this worker's own read. Defensive only, same posture as the other GSI8 workers'
   * `skippedNotDue`/`skippedStale`. */
  skippedNotDue: number;
  /** Age in seconds of the oldest due candidate this run's GSI8 query returned. `undefined` when
   * no candidate was returned at all - same observability shape membership-purge/invitation-purge/
   * document-file-reconciliation added for their own GSI8 migrations. */
  oldestCandidateAgeSeconds: number | undefined;
}

/** Hard cap on pages drained per invocation — same rationale as
 * `reminder-reconciliation-handler.ts`'s `MAX_PAGES`: bounds a single invocation against a
 * pathological backlog; anything beyond this is picked up by tomorrow's run. */
const MAX_PAGES = 25;

export async function runRequirementReindex(deps: RequirementReindexDeps): Promise<RequirementReindexResult> {
  const result: RequirementReindexResult = { scanned: 0, transitioned: 0, skippedConcurrentlyModified: 0, skippedNotDue: 0, oldestCandidateAgeSeconds: undefined };
  const nowIso = deps.now();
  const nowMs = new Date(nowIso).getTime();

  let exclusiveStartKey: Record<string, unknown> | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const gsi8Page = await deps.candidates.queryDue({ before: nowIso, exclusiveStartKey });

    if (page === 0 && gsi8Page.items.length > 0) {
      const oldest = gsi8Page.items[0]!;
      result.oldestCandidateAgeSeconds = Math.max(0, Math.floor((nowMs - Date.parse(oldest.dueAtIso)) / 1000));
    }

    for (const candidate of gsi8Page.items) {
      result.scanned += 1;
      const requirement = await deps.store.get<Requirement>(requirementKey(candidate.tenantId, candidate.subjectId, candidate.requirementId));
      // Defensive only — queryDue()'s own `GSI8SK < :before` filter means this should never be
      // reachable in practice, but eligibility is always re-derived here, never assumed (same
      // posture as invitation-purge/membership-purge's own defensive check): a concurrent
      // linkEvidence pushing evidenceValidUntil forward, or unlinkEvidence clearing it, between
      // the query and this read, is caught here rather than acted on stale.
      if (!requirement || !requirement.evidenceValidUntil || new Date(requirement.evidenceValidUntil).getTime() >= nowMs) {
        result.skippedNotDue += 1;
        continue;
      }

      const nextStatus = deriveRequirementStatus(
        requirement.applicability,
        requirement.evidenceState ? { state: requirement.evidenceState, validUntil: requirement.evidenceValidUntil } : undefined,
        new Date(nowIso),
      );
      if (nextStatus === requirement.status) continue; // already reflects reality (e.g. a concurrent write beat us to it).

      const update = buildVersionedUpdate({
        tableName: deps.tableName,
        key: requirementKey(requirement.tenantId, requirement.subjectId, requirement.requirementId),
        tenantId: requirement.tenantId,
        expectedVersion: requirement.version,
        set: { status: nextStatus, ...requirementGsi1Keys(requirement.tenantId, nextStatus, nowIso, requirement.requirementId) },
        // `nextStatus` is never SATISFIED here (`deriveRequirementStatus` only reaches this branch
        // once `evidenceValidUntil` has already passed `now`) — the GSI8 pointer always clears,
        // unconditionally, same as `unlinkEvidence`'s unconditional clear.
        remove: ["GSI8PK", "GSI8SK"],
        now: nowIso,
      });
      try {
        await deps.store.transactWrite([{ Update: update }]);
        result.transitioned += 1;
      } catch (err) {
        // A concurrent write (a caller's own linkEvidence/unlinkEvidence/updateRequirement)
        // already moved this Requirement past the version this scan observed — not this
        // worker's job to retry mid-run; the NEXT scheduled run re-evaluates it from a fresh
        // read, same "eventually consistent, never silently wrong" posture as the DST pass.
        if (isTransactionCanceled(err)) {
          result.skippedConcurrentlyModified += 1;
          continue;
        }
        throw err;
      }
    }
    if (!gsi8Page.lastEvaluatedKey) break;
    exclusiveStartKey = gsi8Page.lastEvaluatedKey;
  }

  return result;
}
