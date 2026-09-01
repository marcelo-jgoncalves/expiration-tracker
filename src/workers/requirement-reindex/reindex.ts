/**
 * RequirementReindex — D-143 Decision 5 (`requirement.ts`'s module doc comment): the daily
 * job that keeps GSI1's REQSTATUS index coherent with pure TIME-based drift. A Requirement's
 * `status` is written eagerly on every mutation (`linkEvidence`/`unlinkEvidence`/
 * `updateRequirement`), but SATISFIED -> NOT_SATISFIED as `evidenceValidUntil` passes with NO
 * other write ever touching the Requirement is a transition nothing else triggers — this
 * worker is that trigger, run once a day (EventBridge Scheduler, same shape as
 * `reminder-reconciliation-handler.ts`'s DST pass).
 *
 * Reads ONLY the Requirement's own denormalized `evidenceState`/`evidenceValidUntil` (never
 * re-fetches the evidence DocumentVersion — see `requirement.ts`'s doc comment on why those
 * fields are cached), so this worker is a pure comparison against `now`, not a second source
 * of truth for evidence state.
 */
import { buildVersionedUpdate, isTransactionCanceled } from "../../shared/dynamodb/occ.js";
import type { DocumentArchiveStore } from "../../modules/document-archive/ports/document-archive-store.js";
import { deriveRequirementStatus, requirementGsi1Keys, requirementKey, type Requirement } from "../../modules/document-archive/domain/requirement.js";

export interface RequirementReindexDeps {
  store: DocumentArchiveStore;
  tableName: string;
  now: () => string;
}

export interface RequirementReindexResult {
  scanned: number;
  transitioned: number;
  skippedConcurrentlyModified: number;
}

/** Hard cap on pages drained per invocation — same rationale as
 * `reminder-reconciliation-handler.ts`'s `MAX_PAGES`: bounds a single invocation against a
 * pathological backlog; anything beyond this is picked up by tomorrow's run. */
const MAX_PAGES = 25;

export async function runRequirementReindex(deps: RequirementReindexDeps): Promise<RequirementReindexResult> {
  const result: RequirementReindexResult = { scanned: 0, transitioned: 0, skippedConcurrentlyModified: 0 };
  const nowIso = deps.now();
  const nowMs = new Date(nowIso).getTime();

  let exclusiveStartKey: Record<string, unknown> | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const scanPage = await deps.store.scanSatisfiedRequirements<Requirement>(exclusiveStartKey);
    for (const requirement of scanPage.items) {
      result.scanned += 1;
      if (!requirement.evidenceValidUntil) continue; // never expires — SATISFIED forever, by construction.
      if (new Date(requirement.evidenceValidUntil).getTime() >= nowMs) continue; // still valid, no drift yet.

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
    if (!scanPage.lastEvaluatedKey) break;
    exclusiveStartKey = scanPage.lastEvaluatedKey;
  }

  return result;
}
