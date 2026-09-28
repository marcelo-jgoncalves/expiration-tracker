/**
 * WhatsAppDigestFlushWorker — D-347 §3.5. Scans GSI8 (`WORK#WHATSAPP_DIGEST`) for due
 * `DigestEntry` windows, same discovery pattern as `scheduled-reports/scheduler.ts`, then commits
 * a 2-action claim transaction per due window: `Update` OPEN->FLUSHED (+ removing the GSI8
 * pointer — a digest window is one-shot, never recurring, so there is no "next due date" to
 * repoint it to, unlike `ReportSubscription`'s weekly recompute) and an `Outbox` `Put`
 * (destination `SQS_NOTIFICATION_WHATSAPP_DIGEST_V1`) — same "claim + durable outbox event in
 * ONE TransactWriteItems" discipline `scheduled-reports/scheduler.ts`/`reminder-producer/
 * producer.ts` already established.
 *
 * The event payload carries the full `items` list (not just an id to re-fetch by) because, unlike
 * `ReportSubscription` (which the delivery worker re-reads fresh for recipients), a `DigestEntry`
 * this claim just marked FLUSHED is its own authoritative record of what to send — the delivery
 * worker still re-reads each referenced `ExpirationItem` fresh (never trusts anything beyond
 * id/version from here), same "recipients re-resolved fresh, item content re-resolved fresh"
 * split `ReportSubscriptionDeliveryWorker`/`WhatsAppDeliveryWorker` already establish.
 */
import { buildVersionedUpdate, isTransactionCanceled } from "../../shared/dynamodb/occ.js";
import { appendToTransaction, type DynamoTransactPutEntry } from "../../shared/outbox/outbox.js";
import type { DomainEvent } from "../../shared/contracts/events.js";
import { digestEntryKey, type DigestEntry } from "../../modules/notification/domain/digest-entry.js";
import type { NotificationStore } from "../../modules/notification/ports/notification-store.js";
import type { WhatsAppDigestCandidateSource } from "./candidate-source.js";

export interface WhatsAppDigestFlushDeps {
  store: NotificationStore;
  candidates: WhatsAppDigestCandidateSource;
  tableName: string;
  now: () => string;
  newEventId: () => string;
  correlationId: () => string;
}

export interface WhatsAppDigestFlushTickResult {
  scanned: number;
  claimed: number;
  skippedConcurrentlyModified: number;
  /** A candidate the GSI8 query returned but a fresh re-read no longer supports claiming -
   * `flushAt` already advanced past `now` (shouldn't happen - a window's `flushAt` is fixed at
   * creation, never recomputed) or the window was already FLUSHED by a concurrent tick.
   * Defensive only, same posture as `scheduled-reports/scheduler.ts`'s own `skippedNotDue`. */
  skippedNotDue: number;
  failed: { tenantId: string; recipientUserId: string; error: unknown }[];
  oldestCandidateAgeSeconds: number | undefined;
}

/** Hard cap on pages drained per invocation - same rationale as `scheduled-reports/scheduler.ts`'s
 * MAX_PAGES: bounds a single invocation against a pathological backlog; anything beyond this is
 * picked up by the next scheduled run. */
const MAX_PAGES = 25;

export async function runWhatsAppDigestFlushTick(deps: WhatsAppDigestFlushDeps): Promise<WhatsAppDigestFlushTickResult> {
  const result: WhatsAppDigestFlushTickResult = { scanned: 0, claimed: 0, skippedConcurrentlyModified: 0, skippedNotDue: 0, failed: [], oldestCandidateAgeSeconds: undefined };
  const nowIso = deps.now();
  const nowMs = Date.parse(nowIso);

  let exclusiveStartKey: Record<string, unknown> | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const gsi8Page = await deps.candidates.queryDue({ before: nowIso, exclusiveStartKey });

    if (page === 0 && gsi8Page.items.length > 0) {
      const oldest = gsi8Page.items[0]!;
      result.oldestCandidateAgeSeconds = Math.max(0, Math.floor((nowMs - Date.parse(oldest.flushAtIso)) / 1000));
    }

    for (const candidate of gsi8Page.items) {
      result.scanned += 1;
      try {
        const entry = await deps.store.get<DigestEntry>(digestEntryKey(candidate.tenantId, candidate.recipientUserId, "WHATSAPP", candidate.windowDate));
        if (!entry || entry.status !== "OPEN" || Date.parse(entry.flushAt) >= nowMs) {
          result.skippedNotDue += 1;
          continue;
        }

        const event: DomainEvent = {
          specVersion: "1.0",
          eventId: deps.newEventId(),
          eventType: "WhatsAppDigestFlushRequested",
          source: "expiration-tracker.whatsapp-digest-flush",
          occurredAt: nowIso,
          correlationId: deps.correlationId(),
          tenantId: entry.tenantId,
          actor: { type: "SYSTEM" },
          aggregate: { type: "DigestEntry", id: `${entry.recipientUserId}#${entry.windowDate}`, version: entry.version + 1 },
          data: { tenantId: entry.tenantId, recipientUserId: entry.recipientUserId, windowDate: entry.windowDate, items: entry.items },
        };
        const outboxEntries: DynamoTransactPutEntry[] = [];
        appendToTransaction(outboxEntries, deps.tableName, event, "SQS_NOTIFICATION_WHATSAPP_DIGEST_V1");

        await deps.store.transactWrite([
          {
            Update: buildVersionedUpdate({
              tableName: deps.tableName,
              key: digestEntryKey(entry.tenantId, entry.recipientUserId, "WHATSAPP", entry.windowDate),
              tenantId: entry.tenantId,
              expectedVersion: entry.version,
              now: nowIso,
              set: { status: "FLUSHED" },
              remove: ["GSI8PK", "GSI8SK"],
            }),
          },
          ...outboxEntries,
        ]);

        result.claimed += 1;
      } catch (err) {
        if (isTransactionCanceled(err)) {
          // Lost the claim race to a concurrent tick - not a failure to retry, self-heals next run.
          result.skippedConcurrentlyModified += 1;
          continue;
        }
        result.failed.push({ tenantId: candidate.tenantId, recipientUserId: candidate.recipientUserId, error: err });
      }
    }
    if (!gsi8Page.lastEvaluatedKey) break;
    exclusiveStartKey = gsi8Page.lastEvaluatedKey;
  }

  return result;
}

/** Pure alarm decision, mirrors `scheduled-reports/scheduler.ts`'s `shouldAlarmScheduledReports`
 * - extracted so the Lambda handler's "when should this tick throw" logic is unit-testable
 * without mocking the whole handler/composition root. */
export function shouldAlarmWhatsAppDigestFlush(result: WhatsAppDigestFlushTickResult): { alarm: boolean; reason?: string } {
  if (result.failed.length > 0) {
    return { alarm: true, reason: `whatsapp-digest-flush: ${result.failed.length} digest(s) failed to claim` };
  }
  return { alarm: false };
}
