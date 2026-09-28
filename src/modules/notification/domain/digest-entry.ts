/**
 * DigestEntry — D-347 §3.5 (WhatsApp margin protection, digest half of the mechanism Marcelo
 * authorized 2026-09-27; the real-cost AI/OCR budget, §3.7-3.8, is the other half, already
 * implemented) / `docs/architecture/roadmap-evolution/07-domain-model-escalation-watchers-digest.md`
 * ("Digest — questão aberta"), now implemented. Delivery-layer aggregation ONLY:
 * `NotificationIntent` stays exactly 1-per-event (never touched by this file) — this is where
 * multiple WHATSAPP-routed, non-urgent intents for the SAME tenantId+recipient+channel+day get
 * consolidated into at most one outbound message per §3.5's "no máximo 1 mensagem/destinatário/dia".
 *
 * `windowDate` is always the CURRENT UTC calendar date at the moment an item is added to it
 * (never a past/future date — see `digestFlushAtIso`) — that single fact is what makes the flush
 * schedule race-free without any extra locking: `flushAt` is always strictly after every possible
 * addition to that window, because clocks are monotonic and `now`'s calendar date can never fall
 * on an already-passed `windowDate` again.
 */
import type { EntityKey } from "../../../shared/dynamodb/occ.js";

export type DigestChannel = "WHATSAPP";

/**
 * Round 1 Codex review (D-347 §3.5) found the original two-state (`OPEN`/`FLUSHED`) model let a
 * redelivered `SQS_NOTIFICATION_WHATSAPP_DIGEST_V1` message send the same window's message twice
 * and left a retried-but-now-successful send's attempts recorded as failed. States below mirror
 * the SAME admission/lease/reconcile discipline `NotificationAttemptStatus`'s
 * PREPARED->SUBMITTING->resolved already establishes, applied to the WHOLE window instead of one
 * attempt (the digest's one external call covers N attempts, so the lease belongs on the entry,
 * not repeated per attempt):
 *   - `OPEN`: accumulating items, not yet due.
 *   - `FLUSHED`: claimed by the flush worker (GSI8 pointer dropped), outbox event dispatched,
 *     awaiting the delivery worker's admission.
 *   - `SENDING`: the delivery worker admitted this window for ONE external call attempt -
 *     `leaseExpiresAt` bounds how long a crash mid-send can block a retry (same lease-expiry
 *     concept `NotificationAttempt.leaseExpiresAt`/`decideSendAction` already use).
 *   - `SENT`: terminal success.
 *   - `FAILED`: terminal, conclusively never sendable (no eligible items left, or no resolvable
 *     phone) - never automatically retried.
 *   - `UNKNOWN`: an external call MAY have reached the provider without local confirmation
 *     (timeout/connection drop, or a `SENDING` lease that expired without resolution) - never
 *     retried blindly, same posture `NotificationAttemptStatus.UNKNOWN` already establishes.
 */
export type DigestEntryStatus = "OPEN" | "FLUSHED" | "SENDING" | "SENT" | "FAILED" | "UNKNOWN";

/** Hard cap on a single window's item list - Round 1 Codex review found an unbounded list risks
 * DynamoDB's 400KB item size limit (a rare but real risk at the fornecedor volumes D-347 §3.6
 * describes, 2.000-10.000/organização) and would fail the WHOLE router transaction (including
 * that intent's own EMAIL channel, if requested) if ever hit. Once a window is at capacity, the
 * router's digest branch falls back to BYPASS_IMMEDIATE for the next intent rather than growing
 * further or losing the notification - never silently dropped, never a size-related transaction
 * failure. Sized generously above any real per-recipient-per-day volume plausible today (D-347
 * §3.6's own worst-case scenarios are per-ORGANIZATION, spread across however many recipients the
 * organization has - never this concentrated onto one recipient/day in practice), while staying
 * far under the 400KB ceiling even with worst-case per-item field lengths. */
export const MAX_DIGEST_ITEMS = 200;

/** One underlying NotificationIntent/NotificationAttempt pair folded into this window's
 * eventual single message — never the full rendered content (the flush/delivery worker
 * re-reads `ExpirationItem` fresh at send time, same "never trust a snapshot" discipline
 * `WhatsAppDeliveryWorkflowDeps.renderTemplate` already uses for the non-digested path). */
export interface DigestEntryItem {
  intentId: string;
  attemptId: string;
  itemId: string;
  itemVersion: number;
  addedAt: string;
}

export interface DigestEntry extends EntityKey {
  SK: "META";
  entityType: "DigestEntry";
  tenantId: string;
  recipientUserId: string;
  channel: DigestChannel;
  /** UTC calendar date (YYYY-MM-DD) this window covers — see file header. */
  windowDate: string;
  status: DigestEntryStatus;
  items: DigestEntryItem[];
  /** ISO instant the flush worker claims/sends this window at — `digestFlushAtIso(windowDate)`. */
  flushAt: string;
  /** Set only while `status === "SENDING"` — same lease-expiry concept as
   * `NotificationAttempt.leaseExpiresAt`, bounding how long a crashed delivery invocation can
   * block a retry before `decideDigestDeliveryAction` reconciles it to UNKNOWN. */
  leaseExpiresAt?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** TRANSIENT retention (LGPD categorization, same class as the outbox's own
   * `purgeAfterTtl`/`OUTBOX_TRANSIENT_RETENTION_SECONDS`) — this is internal delivery-layer
   * bookkeeping, never the delivery record of record itself (that's `NotificationIntent`/
   * `NotificationAttempt`, deliberately untouched, no TTL). Set once at creation from
   * `windowDate`, never recomputed. */
  purgeAfterTtl: number;
}

export function digestEntryKey(tenantId: string, recipientUserId: string, channel: DigestChannel, windowDate: string): { PK: string; SK: "META" } {
  return { PK: `TENANT#${tenantId}#DIGEST#${channel}#${recipientUserId}#${windowDate}`, SK: "META" };
}

/** UTC calendar date of `iso` — the window an item routed "now" belongs to. */
export function digestWindowDateFromIso(iso: string): string {
  return iso.slice(0, 10);
}

/** Buffer past midnight UTC before a window is claimed — purely defensive against clock
 * skew between the router (writer) and the flush worker's `now()` (reader); not load-bearing
 * for the race-freedom argument in the file header, which holds even at buffer=0. */
const DIGEST_FLUSH_BUFFER_MINUTES = 20;

/** Flush always happens on the calendar day AFTER `windowDate` — never the same day — which is
 * the structural guarantee described in the file header: no item can arrive for a window whose
 * flush has already run, because doing so would require `now`'s calendar date to be `windowDate`
 * again after it already ended. */
export function digestFlushAtIso(windowDate: string): string {
  const startOfNextDayMs = Date.parse(`${windowDate}T00:00:00.000Z`) + 24 * 60 * 60_000;
  return new Date(startOfNextDayMs + DIGEST_FLUSH_BUFFER_MINUTES * 60_000).toISOString();
}

/** GSI8 (MaintenanceDueIndex) work-type namespace for this worker — same sparse, tenantless
 * "WORK#<type>" scan-for-due-items pattern `delivery-record-purge`/`report_subscription` already
 * established (`shared/delivery-record-gsi8.ts`, `reports/domain/report-subscription.ts`), reused
 * here rather than a new GSI (infra/modules/dynamo-table/main.tf's `gsi8_worker_types` map gets
 * one more entry, `LeadingKeys`-scoped like every other worker sharing this index). */
export const DIGEST_ENTRY_GSI8_WORK_TYPE = "WHATSAPP_DIGEST";

export function digestEntryGsi8Keys(input: { tenantId: string; recipientUserId: string; flushAt: string }): { GSI8PK: string; GSI8SK: string } {
  return {
    GSI8PK: `WORK#${DIGEST_ENTRY_GSI8_WORK_TYPE}`,
    GSI8SK: `${input.flushAt}#TENANT#${input.tenantId}#${input.recipientUserId}`,
  };
}

/** 30 days past `windowDate`'s own flush - generous past every real state transition this row
 * ever goes through (OPEN for at most 1 day, FLUSHED/SENDING/SENT/FAILED/UNKNOWN resolved within
 * minutes of flush in the overwhelming common case) while leaving a wide margin for a stuck
 * `UNKNOWN`/manual-reconciliation window before native DynamoDB TTL reclaims the row. */
const DIGEST_ENTRY_RETENTION_DAYS = 30;

export function digestEntryPurgeAfterTtl(windowDate: string): number {
  return Math.floor(Date.parse(`${windowDate}T00:00:00.000Z`) / 1000) + DIGEST_ENTRY_RETENTION_DAYS * 24 * 60 * 60;
}

/**
 * Pure merge: the next DigestEntry state after folding `newItem` into `existing` (or creating a
 * fresh entry when `existing` is undefined). Deduped by `intentId` — idempotent against a
 * redelivered/retried routing decision for the SAME intent (see
 * `notification-router-workflow.ts`'s digest branch, which can legitimately re-run after this
 * entry's own OCC race forces a RETRY). The caller (the DynamoDB writer, not this function)
 * decides Put-if-absent vs. versioned Update from whether `existing` was defined.
 */
export function appendDigestEntryItem(
  existing: DigestEntry | undefined,
  input: { tenantId: string; recipientUserId: string; channel: DigestChannel; windowDate: string; newItem: DigestEntryItem; now: string },
): DigestEntry {
  const flushAt = digestFlushAtIso(input.windowDate);
  const items = existing ? [...existing.items] : [];
  if (!items.some((existingItem) => existingItem.intentId === input.newItem.intentId)) {
    items.push(input.newItem);
  }
  return {
    ...digestEntryKey(input.tenantId, input.recipientUserId, input.channel, input.windowDate),
    entityType: "DigestEntry",
    tenantId: input.tenantId,
    recipientUserId: input.recipientUserId,
    channel: input.channel,
    windowDate: input.windowDate,
    status: "OPEN",
    items,
    flushAt,
    version: (existing?.version ?? 0) + 1,
    createdAt: existing?.createdAt ?? input.now,
    updatedAt: input.now,
    purgeAfterTtl: existing?.purgeAfterTtl ?? digestEntryPurgeAfterTtl(input.windowDate),
  };
}

/** Whether `existing` has already reached `MAX_DIGEST_ITEMS` - the router's digest branch calls
 * this BEFORE appending a new item (never after), so the cap is on the count BEFORE the
 * candidate item would be added: a window at exactly the cap falls back to BYPASS_IMMEDIATE for
 * the next intent, it is never grown past the cap. */
export function isDigestEntryAtCapacity(existing: DigestEntry | undefined): boolean {
  return (existing?.items.length ?? 0) >= MAX_DIGEST_ITEMS;
}
