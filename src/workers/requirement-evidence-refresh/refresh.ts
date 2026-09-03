/**
 * RequirementEvidenceRefresh — D-193 item 6/9 ("Convergência de `Requirement` — assíncrona,
 * nunca fan-out síncrono", `estado-final-consolidado.md`). Consumes the
 * `SQS_REQUIREMENT_EVIDENCE_REFRESH_V1` outbox destination (D-193 slice 4/5): the event is
 * ONLY ever a "wake up" hint, NEVER a value carrier — this file never reads anything from the
 * event payload beyond `tenantId`/`versionId`, and even those two are used only to DISCOVER
 * candidates via `findRequirementsByEvidenceVersion` (D-193 slice 5's GSI9 reverse index),
 * never to decide the outcome. Every value this worker writes is re-derived from a fresh
 * `store.get()` of the `Requirement` AND its evidence `DocumentVersion`, re-read independently
 * for EACH candidate — this is the exact design property the Round 3-5 critique history
 * worried about (ordering/loss risk from trusting event payloads), and the whole reason this
 * mechanism is async-with-reread instead of an in-transaction fan-out from
 * `confirmFieldForDocumentArchive`.
 *
 * One Requirement at a time, its own bounded OCC retry loop (`refreshOneRequirementWithRetry`)
 * — a conflict or a terminal failure on one candidate is caught and recorded, never rethrown
 * to abort the rest of the batch (same batch-isolation discipline
 * `dispatch-outbox-relay-processor.ts` already holds per-record, applied here one level deeper,
 * per-Requirement within a single record's candidate list).
 *
 * A Requirement whose fresh re-read already matches what would be written (no evidence change
 * since the wake-up was queued — the common case for a duplicate/replayed/reordered message) is
 * a deliberate no-op: no `transactWrite`, no version bump, matching G-V3's "no spurious
 * rewrite" requirement.
 */
import { buildVersionedUpdate, isTransactionCanceled } from "../../shared/dynamodb/occ.js";
import type { DocumentArchiveStore } from "../../modules/document-archive/ports/document-archive-store.js";
import type { DocumentArchiveService } from "../../modules/document-archive/application/document-archive-service.js";
import { documentVersionKey, type DocumentVersion } from "../../modules/document-archive/domain/document-version.js";
import {
  deriveRequirementMaintenanceDue,
  deriveRequirementStatus,
  requirementGsi1Keys,
  requirementGsi8Keys,
  requirementKey,
  type Requirement,
} from "../../modules/document-archive/domain/requirement.js";

export interface RequirementEvidenceRefreshDeps {
  /** Only `findRequirementsByEvidenceVersion` is used — a SYSTEM query, no `RequestContext`,
   * same posture as `requirement-reindex`'s use of `store` directly instead of a
   * ctx-authorized service method (D-193 slice 5's doc comment on that method). */
  documentArchive: Pick<DocumentArchiveService, "findRequirementsByEvidenceVersion">;
  store: DocumentArchiveStore;
  tableName: string;
  now: () => string;
}

/** The ONLY two fields this worker ever reads from the wake-up event — deliberately not a
 * wider "OutboxRecord payload" type, so nothing else the payload might carry (a stale
 * `validUntil`, a stale `state`, anything) is even reachable from this function's signature. */
export interface RequirementEvidenceRefreshHint {
  tenantId: string;
  versionId: string;
}

export type RequirementRefreshOutcome = "UPDATED" | "NOOP";

export interface RequirementEvidenceRefreshResult {
  discovered: number;
  updated: number;
  noop: number;
  failed: number;
  failedRequirementIds: string[];
}

/** Bounded per-Requirement OCC retry — a concurrent caller mutation (linkEvidence/
 * unlinkEvidence/updateRequirement, or another refresh of the same Requirement racing on
 * relink) can invalidate the version this attempt read; re-reading fresh and retrying a few
 * times converges without ever trusting a stale read across the retry boundary. */
const MAX_OCC_ATTEMPTS = 5;

export async function refreshRequirementsForEvidenceVersion(
  deps: RequirementEvidenceRefreshDeps,
  hint: RequirementEvidenceRefreshHint,
): Promise<RequirementEvidenceRefreshResult> {
  const result: RequirementEvidenceRefreshResult = { discovered: 0, updated: 0, noop: 0, failed: 0, failedRequirementIds: [] };

  // Discovery only — GSI9 is never a source of eligibility, same posture GSI8 consumers already
  // hold. Every candidate returned here is re-fetched fresh before this worker acts on it.
  const candidates = await deps.documentArchive.findRequirementsByEvidenceVersion(hint.tenantId, hint.versionId);
  result.discovered = candidates.length;

  for (const candidate of candidates) {
    try {
      const outcome = await refreshOneRequirementWithRetry(deps, hint.tenantId, candidate.subjectId, candidate.requirementId);
      if (outcome === "UPDATED") result.updated += 1;
      else result.noop += 1;
    } catch {
      // One Requirement's terminal failure (exhausted retries, or a genuinely unexpected error)
      // must never abort the rest of the batch — recorded, not rethrown.
      result.failed += 1;
      result.failedRequirementIds.push(candidate.requirementId);
    }
  }

  return result;
}

async function refreshOneRequirementWithRetry(
  deps: RequirementEvidenceRefreshDeps,
  tenantId: string,
  subjectId: string,
  requirementId: string,
): Promise<RequirementRefreshOutcome> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_OCC_ATTEMPTS; attempt++) {
    try {
      return await refreshOneRequirement(deps, tenantId, subjectId, requirementId);
    } catch (err) {
      if (!isTransactionCanceled(err)) throw err;
      lastErr = err;
      // Loop again: the next iteration re-reads the Requirement (and its evidence
      // DocumentVersion) fresh — never reuses the read that lost the OCC race.
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Exhausted OCC retries refreshing Requirement ${requirementId}.`);
}

async function refreshOneRequirement(deps: RequirementEvidenceRefreshDeps, tenantId: string, subjectId: string, requirementId: string): Promise<RequirementRefreshOutcome> {
  // Fresh read #1: the Requirement itself. Never the GSI9 query result — that projection can
  // already be behind a concurrent mutation by the time this worker gets to it.
  const requirement = await deps.store.get<Requirement>(requirementKey(tenantId, subjectId, requirementId));
  if (!requirement || requirement.tenantId !== tenantId) return "NOOP"; // deleted since discovery.
  if (!requirement.evidenceVersionId || !requirement.evidenceDocumentId || requirement.evidenceSeq === undefined) {
    return "NOOP"; // unlinked since discovery — nothing left to refresh.
  }

  // Fresh read #2: the evidence DocumentVersion, located via the Requirement's OWN current
  // evidenceDocumentId/evidenceSeq (never the event payload's versionId) — if the Requirement
  // was relinked to different evidence since the wake-up was queued, this naturally follows the
  // CURRENT link, not the stale one the event was originally about.
  const version = await deps.store.get<DocumentVersion>(documentVersionKey(tenantId, requirement.evidenceDocumentId, requirement.evidenceSeq));
  if (!version || version.tenantId !== tenantId || version.versionId !== requirement.evidenceVersionId) {
    // Defensive only: evidenceDocumentId/evidenceSeq pointed somewhere that no longer matches
    // evidenceVersionId (a relink raced this read) — never act on a mismatched pair.
    return "NOOP";
  }

  const nowIso = deps.now();
  const nextStatus = deriveRequirementStatus(requirement.applicability, { state: version.state, validUntil: version.validUntil }, new Date(nowIso));

  const evidenceStateChanged = requirement.evidenceState !== version.state;
  const evidenceValidUntilChanged = requirement.evidenceValidUntil !== version.validUntil;
  const statusChanged = requirement.status !== nextStatus;
  if (!evidenceStateChanged && !evidenceValidUntilChanged && !statusChanged) {
    // G-V3: no real change derived — never a spurious rewrite/version bump.
    return "NOOP";
  }

  const set: Record<string, unknown> = {
    evidenceState: version.state,
    status: nextStatus,
    ...requirementGsi1Keys(tenantId, nextStatus, nowIso, requirementId),
  };
  if (version.validUntil !== undefined) set["evidenceValidUntil"] = version.validUntil;
  const due = deriveRequirementMaintenanceDue(nextStatus, version.validUntil);
  const gsi8Fields = due ? requirementGsi8Keys({ dueAtIso: due.dueAtIso, tenantId, requirementId }) : {};
  Object.assign(set, gsi8Fields);
  const remove = [...(version.validUntil === undefined ? ["evidenceValidUntil"] : []), ...(Object.keys(gsi8Fields).length === 0 ? ["GSI8PK", "GSI8SK"] : [])];

  const update = buildVersionedUpdate({
    tableName: deps.tableName,
    key: requirementKey(tenantId, subjectId, requirementId),
    tenantId,
    expectedVersion: requirement.version,
    set,
    remove: remove.length > 0 ? remove : undefined,
    now: nowIso,
  });

  // TransactWriteItems (never a standalone UpdateItem) — matches `buildVersionedUpdate`/
  // `store.transactWrite()`'s real mechanism everywhere else in this module (linkEvidence,
  // unlinkEvidence, requirement-reindex). Throws (isTransactionCanceled) on a lost OCC race,
  // caught by `refreshOneRequirementWithRetry`'s caller.
  await deps.store.transactWrite([{ Update: update }]);
  return "UPDATED";
}
