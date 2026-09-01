/**
 * DocumentRequestRecurrenceMaterializer — D-143 Decision 8 (D-147). The periodic "what's due"
 * producer + transactional materializer, mirroring the split between
 * `src/modules/subject/application/document-chasing-producer.ts` (decide what's due) and
 * `document-chasing-materializer.ts` (materialize it) — here folded into one worker module
 * (same pragmatic collapse `requirement-reindex/reindex.ts` already makes for a single daily
 * job) rather than two files for a periodic job this small.
 *
 * Source of "what's due": `store.scanActiveSeries` (cross-tenant `Scan`, same accepted cost
 * tradeoff as `requirement-reindex/reindex.ts`'s `scanSatisfiedRequirements` — this module has
 * no tenant-enumeration port method, so a GSI1 query keyed by a specific tenant partition can't
 * answer "every ACTIVE series across every tenant").
 *
 * For each due series (`nextDueAt <= now`) with no attempt yet in its current cycle
 * (`latestAttemptIndex === 0`), materializes attempt 1 via the SAME `buildMaterializeAttemptEntries`
 * transaction shape the interactive `DocumentRequestRecurrenceService.materializeAttempt` uses
 * (Decision 8's partial-failure fix applies identically here — no separate, weaker code path for
 * the scheduled trigger). Never calls `authorize()` (no `RequestContext` exists for a scheduler
 * invocation) — same posture as `requirement-reindex/reindex.ts`.
 */
import { isTransactionCanceled } from "../../shared/dynamodb/occ.js";
import type { DocumentArchiveStore } from "../../modules/document-archive/ports/document-archive-store.js";
import type { DocumentArchiveIdGenerator } from "../../modules/document-archive/application/id-generator.js";
import { buildMaterializeAttemptEntries } from "../../modules/document-archive/application/document-request-recurrence-service.js";
import type { DocumentRequestSeries } from "../../modules/document-archive/domain/document-request-series.js";

export interface DocumentRequestRecurrenceMaterializerDeps {
  store: DocumentArchiveStore;
  tableName: string;
  ids: DocumentArchiveIdGenerator;
  now: () => string;
}

export interface DocumentRequestRecurrenceMaterializerResult {
  scanned: number;
  materialized: number;
  skippedConcurrentlyModified: number;
  skippedNotYetDue: number;
  skippedAlreadyAttempted: number;
}

/** Hard cap on pages drained per invocation — same rationale as
 * `requirement-reindex/reindex.ts`'s `MAX_PAGES`: bounds a single invocation against a
 * pathological backlog; anything beyond this is picked up by the next scheduled run. */
const MAX_PAGES = 25;

export async function runDocumentRequestRecurrenceMaterializer(deps: DocumentRequestRecurrenceMaterializerDeps): Promise<DocumentRequestRecurrenceMaterializerResult> {
  const result: DocumentRequestRecurrenceMaterializerResult = { scanned: 0, materialized: 0, skippedConcurrentlyModified: 0, skippedNotYetDue: 0, skippedAlreadyAttempted: 0 };
  const nowIso = deps.now();
  const nowMs = new Date(nowIso).getTime();

  let exclusiveStartKey: Record<string, unknown> | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const scanPage = await deps.store.scanActiveSeries<DocumentRequestSeries>(exclusiveStartKey);
    for (const series of scanPage.items) {
      result.scanned += 1;
      if (new Date(series.nextDueAt).getTime() > nowMs) {
        result.skippedNotYetDue += 1;
        continue;
      }
      if (series.latestAttemptIndex > 0) {
        // Already has an attempt for this cycle (e.g. a manual materializeAttempt beat the
        // scheduler to it) — this worker only materializes attempt 1 of a due cycle, never a
        // retry/resend (that stays an explicit, interactive `materializeAttempt` call).
        result.skippedAlreadyAttempted += 1;
        continue;
      }
      const newRequestId = deps.ids.newDocumentRequestId();
      const { entries } = buildMaterializeAttemptEntries({ tableName: deps.tableName, series, newRequestId, now: nowIso });
      try {
        await deps.store.transactWrite(entries);
        result.materialized += 1;
      } catch (err) {
        if (isTransactionCanceled(err)) {
          // A duplicate scheduler tick (or a concurrent manual trigger) already advanced this
          // series past the version this scan observed — safe no-op, exactly the property
          // `computeSeriesOccurrenceId`'s determinism plus this OCC condition together
          // guarantee (Decision 8).
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
