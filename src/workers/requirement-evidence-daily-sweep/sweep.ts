/**
 * RequirementEvidenceDailySweep — D-193 item 7/9 (`estado-final-consolidado.md`'s "Rede de
 * reparo autoritativa", the design's Rodada 5 closure). This is purely a "did we miss anyone?"
 * finder+re-poker: it never writes a `Requirement` itself, never derives status, never touches
 * `DocumentVersion` — it pages through `store.scanRequirementsWithEvidence` (status-independent,
 * see that method's port doc comment) and, for every candidate found, re-enqueues the exact same
 * `{tenantId, versionId}` wake-up hint shape onto the SAME `SQS_REQUIREMENT_EVIDENCE_REFRESH_V1`
 * queue slice 6's `refresh.ts` already consumes — collapsing the write path to the single place
 * `refresh.ts` already owns, per the design's explicit "nunca escreve Requirement diretamente"
 * constraint.
 *
 * Deliberately NOT idempotency-sensitive: `refreshRequirementsForEvidenceVersion` is already a
 * safe no-op when a fresh re-read shows no real change (G-V3, `refresh.ts`'s own doc comment), so
 * re-enqueueing a candidate that a normal event-driven refresh already converged costs one extra
 * no-op message, never a wrong write. This is what closes the total-message-loss risk slice 6
 * left open: even if the `Outbox`->`SQS_REQUIREMENT_EVIDENCE_REFRESH_V1` dispatch is lost
 * entirely (relay failure, DLQ exhausted, anything), this daily sweep re-discovers the same
 * candidate from the base table itself within 24h and pokes it again.
 *
 * Same worker shape as `document-request-recurrence/materializer.ts`: pure logic taking injected
 * `store`/`now`/an enqueue function, unit-testable without live AWS, invoked by a thin handler
 * (`requirement-evidence-daily-sweep-handler.ts`) wired to an EventBridge Scheduler entry in
 * `infra/main.tf` mirroring `document_file_reconciliation_handler`'s shape.
 */
import type { DocumentArchiveStore } from "../../modules/document-archive/ports/document-archive-store.js";
import type { Requirement } from "../../modules/document-archive/domain/requirement.js";

/** The exact same wake-up hint shape `RequirementEvidenceRefreshHint` (slice 6's `refresh.ts`)
 * consumes — this worker only ever produces this shape, never anything wider, so there is no
 * temptation for a future caller to smuggle a cached `validUntil`/`status` onto the message. */
export interface RequirementEvidenceDailySweepHint {
  tenantId: string;
  versionId: string;
}

export interface RequirementEvidenceDailySweepDeps {
  /** Only `scanRequirementsWithEvidence` is used — a SYSTEM scan, no `RequestContext`, same
   * posture as `document-request-recurrence/materializer.ts`'s use of `store` directly. */
  store: Pick<DocumentArchiveStore, "scanRequirementsWithEvidence">;
  /** Re-enqueues one wake-up hint onto `SQS_REQUIREMENT_EVIDENCE_REFRESH_V1` — same
   * `(payload, correlationId) => Promise<void>` shape `buildOutboxRelayDeps`'s `send()` closure
   * already establishes for every other outbox destination, so the real handler can hand this
   * worker the exact same kind of sender the relay uses, without a second SQS abstraction. */
  enqueueRefresh: (hint: RequirementEvidenceDailySweepHint, correlationId: string) => Promise<void>;
  /** Correlation id generator — one per enqueued message, same posture as
   * `dispatch-outbox-relay-processor.ts` minting one per dispatched record. */
  newCorrelationId: () => string;
}

export interface RequirementEvidenceDailySweepResult {
  scanned: number;
  enqueued: number;
  skippedNoEvidence: number;
}

/** Hard cap on pages drained per invocation — same rationale as
 * `document-request-recurrence/materializer.ts`'s `MAX_PAGES`: bounds a single invocation
 * against a pathological backlog; anything beyond this is picked up by the next scheduled run
 * (daily cadence, so worst case one extra day of staleness on the tail of a huge backlog). */
const MAX_PAGES = 25;

export async function runRequirementEvidenceDailySweep(deps: RequirementEvidenceDailySweepDeps): Promise<RequirementEvidenceDailySweepResult> {
  const result: RequirementEvidenceDailySweepResult = { scanned: 0, enqueued: 0, skippedNoEvidence: 0 };

  let exclusiveStartKey: Record<string, unknown> | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const scanPage = await deps.store.scanRequirementsWithEvidence<Requirement>(exclusiveStartKey);
    for (const requirement of scanPage.items) {
      result.scanned += 1;
      // Defensive only: the Scan's own FilterExpression already guarantees this, but a fake/test
      // double or a future filter change should never make this worker enqueue a hint with no
      // real evidence link to re-derive from.
      if (!requirement.evidenceVersionId) {
        result.skippedNoEvidence += 1;
        continue;
      }
      const hint: RequirementEvidenceDailySweepHint = { tenantId: requirement.tenantId, versionId: requirement.evidenceVersionId };
      await deps.enqueueRefresh(hint, deps.newCorrelationId());
      result.enqueued += 1;
    }
    if (!scanPage.lastEvaluatedKey) break;
    exclusiveStartKey = scanPage.lastEvaluatedKey;
  }

  return result;
}
