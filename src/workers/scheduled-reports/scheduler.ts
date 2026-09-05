/**
 * ScheduledReportsScheduler — D-204 (Roadmap P1 item 15) decisions 3-4, implemented D-211 fatia
 * 2. Scans GSI8 (`WORK#REPORT_SUBSCRIPTION`) for due `ReportSubscription`s, same discovery
 * pattern as `requirement-reindex/reindex.ts`, then commits a 2-action claim transaction per due
 * subscription: `Update` advancing `nextRunAt` (+ recomputed GSI8 pointer, `ConditionCheck` on
 * `version`) and an `Outbox` `Put` (destination `SQS_REPORT_SUBSCRIPTION_DELIVERY_V1`) - same
 * "claim + durable outbox event in ONE TransactWriteItems" discipline `reminder-producer/
 * producer.ts` established (a bare claim followed by a direct SQS SendMessage is NOT atomic;
 * Lambda can die between the two, leaving a claimed subscription with no queued delivery).
 *
 * The event payload is deliberately minimal (`subscriptionId`/`tenantId`/`scheduledFor`/`runId`)
 * - decision 6 requires the delivery worker (fatia 3, not yet built) to re-resolve
 * `recipientUserIds` FRESH (Membership ACTIVE + GlobalUser ACTIVE) at send time, never trusted
 * from claim time, so there is no value in embedding a snapshot of `reportTypes`/
 * `recipientUserIds` here - the delivery worker re-fetches the full `ReportSubscription` anyway.
 * `runId` is generated HERE (not by the delivery worker) so the future `ReportSubscriptionRun`/
 * `ReportDeliveryAttempt` rows fatia 3 creates share one stable id across SQS redeliveries
 * (at-least-once) - same idempotency-key-generated-at-claim-time posture as `reminder-producer`'s
 * `deduplicationKey`.
 */
import { buildVersionedUpdate } from "../../shared/dynamodb/occ.js";
import { appendToTransaction, type DynamoTransactPutEntry } from "../../shared/outbox/outbox.js";
import type { DomainEvent } from "../../shared/contracts/events.js";
import { reportSubscriptionGsi8Keys, reportSubscriptionKey, type ReportSubscription } from "../../modules/reports/domain/report-subscription.js";
import { nextWeeklyOccurrenceUtc } from "../../modules/reports/domain/report-subscription-schedule.js";
import { isTransactionCanceled, type ReportSubscriptionStore } from "../../modules/reports/ports/report-subscription-store.js";
import type { ScheduledReportsCandidateSource } from "./candidate-source.js";

export interface ScheduledReportsDeps {
  store: ReportSubscriptionStore;
  candidates: ScheduledReportsCandidateSource;
  tableName: string;
  now: () => string;
  newEventId: () => string;
  correlationId: () => string;
}

export interface ScheduledReportsTickResult {
  scanned: number;
  claimed: number;
  skippedConcurrentlyModified: number;
  /** A candidate the GSI8 query returned but a fresh re-read no longer supports claiming -
   * `nextRunAt` was already advanced past `now` by a concurrent tick, or the subscription was
   * deleted between the query and this read. Defensive only, same posture as the other GSI8
   * workers' `skippedNotDue`. */
  skippedNotDue: number;
  failed: { subscriptionId: string; tenantId: string; error: unknown }[];
  oldestCandidateAgeSeconds: number | undefined;
}

/** Hard cap on pages drained per invocation — same rationale as `requirement-reindex/reindex.ts`'s
 * MAX_PAGES: bounds a single invocation against a pathological backlog; anything beyond this is
 * picked up by the next scheduled run. */
const MAX_PAGES = 25;

export async function runScheduledReportsTick(deps: ScheduledReportsDeps): Promise<ScheduledReportsTickResult> {
  const result: ScheduledReportsTickResult = { scanned: 0, claimed: 0, skippedConcurrentlyModified: 0, skippedNotDue: 0, failed: [], oldestCandidateAgeSeconds: undefined };
  const nowIso = deps.now();
  const nowMs = Date.parse(nowIso);

  let exclusiveStartKey: Record<string, unknown> | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const gsi8Page = await deps.candidates.queryDue({ before: nowIso, exclusiveStartKey });

    if (page === 0 && gsi8Page.items.length > 0) {
      const oldest = gsi8Page.items[0]!;
      result.oldestCandidateAgeSeconds = Math.max(0, Math.floor((nowMs - Date.parse(oldest.dueAtIso)) / 1000));
    }

    for (const candidate of gsi8Page.items) {
      result.scanned += 1;
      try {
        const subscription = await deps.store.get<ReportSubscription>(reportSubscriptionKey(candidate.tenantId, candidate.subscriptionId));
        // Defensive only — queryDue()'s own `GSI8SK < :before` filter means this should never be
        // reachable in practice, but eligibility is always re-derived here, never assumed (same
        // posture as requirement-reindex's own defensive check).
        if (!subscription || Date.parse(subscription.nextRunAt) >= nowMs) {
          result.skippedNotDue += 1;
          continue;
        }

        const dueAtIso = subscription.nextRunAt;
        const newNextRunAt = nextWeeklyOccurrenceUtc(dueAtIso, subscription.dayOfWeek, subscription.localTime, subscription.timeZone);
        const newVersion = subscription.version + 1;
        const runId = deps.newEventId();
        const correlationId = deps.correlationId();

        const event: DomainEvent = {
          specVersion: "1.0",
          eventId: deps.newEventId(),
          eventType: "ReportSubscriptionRunRequested",
          source: "expiration-tracker.scheduled-reports-scheduler",
          occurredAt: nowIso,
          correlationId,
          tenantId: subscription.tenantId,
          actor: { type: "SYSTEM" },
          aggregate: { type: "ReportSubscription", id: subscription.subscriptionId, version: newVersion },
          data: { runId, subscriptionId: subscription.subscriptionId, tenantId: subscription.tenantId, scheduledFor: dueAtIso },
        };
        const outboxEntries: DynamoTransactPutEntry[] = [];
        appendToTransaction(outboxEntries, deps.tableName, event, "SQS_REPORT_SUBSCRIPTION_DELIVERY_V1");

        await deps.store.transactWrite([
          {
            Update: buildVersionedUpdate({
              tableName: deps.tableName,
              key: reportSubscriptionKey(subscription.tenantId, subscription.subscriptionId),
              tenantId: subscription.tenantId,
              expectedVersion: subscription.version,
              set: {
                nextRunAt: newNextRunAt,
                ...reportSubscriptionGsi8Keys({ dueAtIso: newNextRunAt, tenantId: subscription.tenantId, subscriptionId: subscription.subscriptionId }),
              },
            }),
          },
          ...outboxEntries,
        ]);

        result.claimed += 1;
      } catch (err) {
        if (isTransactionCanceled(err)) {
          // Lost the claim race to a concurrent tick — not a failure to retry, self-heals next run.
          result.skippedConcurrentlyModified += 1;
          continue;
        }
        result.failed.push({ subscriptionId: candidate.subscriptionId, tenantId: candidate.tenantId, error: err });
      }
    }
    if (!gsi8Page.lastEvaluatedKey) break;
    exclusiveStartKey = gsi8Page.lastEvaluatedKey;
  }

  return result;
}

/** Pure alarm decision, mirrors `reminder-producer/producer.ts`'s `shouldAlarm` - extracted so the
 * Lambda handler's "when should this tick throw" logic is unit-testable without mocking the
 * whole handler/composition root. */
export function shouldAlarmScheduledReports(result: ScheduledReportsTickResult): { alarm: boolean; reason?: string } {
  if (result.failed.length > 0) {
    return { alarm: true, reason: `scheduled-reports: ${result.failed.length} subscription(s) failed to claim` };
  }
  return { alarm: false };
}
