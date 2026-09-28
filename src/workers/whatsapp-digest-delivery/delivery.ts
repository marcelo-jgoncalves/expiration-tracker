/**
 * WhatsAppDigestDeliveryWorker — D-347 §3.5. Consumes `SQS_NOTIFICATION_WHATSAPP_DIGEST_V1`, fed
 * by `whatsapp-digest-flush.ts`'s claim transaction (bare `WhatsAppDigestFlushRequested.data`
 * payload — `tenantId`/`recipientUserId`/`windowDate`/`items` — no envelope wrapper, same
 * convention `SQS_REPORT_SUBSCRIPTION_DELIVERY_V1` already established for a scheduler-fed
 * destination). Sends exactly ONE consolidated WhatsApp message per window, then transitions
 * every underlying `NotificationAttempt` (DIGESTED -> ACCEPTED, one of the FAILED_ statuses, or
 * UNKNOWN) that was folded into it — the ONE external call's outcome applies uniformly to every
 * eligible item in the window (unlike `whatsapp-delivery-workflow.ts`'s per-attempt sends, there
 * is no per-item send to fail independently here).
 *
 * Round 1 Codex review found the first version had no admission/lease at all (redelivery sent
 * twice). Round 2 found the FIX still had two gaps: (a) `markAttemptsForRefs` only accepted
 * `DIGESTED`, so a retryable-failure-then-successful-retry left attempts stuck at
 * `FAILED_RETRYABLE` forever; (b) the entry moved to a terminal status (SENT/FAILED/UNKNOWN)
 * BEFORE the per-attempt updates, so a crash in between orphaned unmarked attempts with no way to
 * recover (redelivery found the entry already terminal and exited immediately). Both fixed by
 * `DigestEntry.resolution` (`digest-entry.ts`) — the durable, replayable record of the outcome,
 * written atomically with the terminal status transition and REPLAYED (never re-sent) by any
 * later invocation that finds the entry already resolved.
 */
import { buildVersionedUpdate, isTransactionCanceled, isConditionalCheckFailed, getCancellationReasonCodes } from "../../shared/dynamodb/occ.js";
import { executeTenantBusinessMutation } from "../../shared/tenant-lifecycle/tenant-business-mutation.js";
import { itemKey, type ExpirationItem } from "../../modules/expiration/domain/expiration-item.js";
import { authorizedTenantIdFromPersistedEntity } from "../../modules/identity/domain/authorization.js";
import { notificationAttemptKey, notificationAttemptLookupKey, type NotificationAttempt, type NotificationAttemptLookup, type NotificationAttemptStatus } from "../../modules/notification/domain/notification-attempt.js";
import { digestEntryKey, type DigestEntry, type DigestEntryItem, type DigestEntryResolution } from "../../modules/notification/domain/digest-entry.js";
import type { NotificationStore } from "../../modules/notification/ports/notification-store.js";
import type { WhatsAppProviderAdapter, WhatsAppSendResult } from "../../modules/notification/ports/whatsapp-provider.js";
import { WhatsAppSendError } from "../../modules/notification/ports/whatsapp-provider.js";
import { nextWhatsAppStatusAfterSendAttempt } from "../../modules/notification/application/whatsapp-delivery.js";
import { checkAndRecordWhatsAppPortfolioQuota } from "../../modules/notification/application/whatsapp-portfolio-quota-service.js";

export interface WhatsAppDigestDeliverCommand {
  tenantId: string;
  recipientUserId: string;
  windowDate: string;
  items: DigestEntryItem[];
}

export interface WhatsAppDigestDeliveryDeps {
  store: NotificationStore;
  tableName: string;
  whatsAppProvider: WhatsAppProviderAdapter;
  resolveRecipientPhone: (input: { tenantId: string; userId: string }) => Promise<string | undefined>;
  /** Renders ONE consolidated message from every item still live in this window — re-reads each
   * `ExpirationItem` fresh here (never trusts anything beyond id/version from claim time), same
   * "never trust a snapshot" discipline `WhatsAppDeliveryWorkflowDeps.renderTemplate` already
   * establishes for the non-digested path. An item no longer ACTIVE by flush time is simply left
   * out of the rendered list (this worker already filters those before calling this), never
   * fails the whole digest over one stale item. */
  renderDigestTemplate: (input: { items: ExpirationItem[] }) => { templateName: string; templateLanguage: string; templateParams: string[] };
  now: () => string;
  leaseDurationMs?: number;
  /** D-8 (fatia 4/5): the real Cloud API 24h unique-recipient tier ceiling for this portfolio's
   * phone number - a digest message is still one real template message against that same
   * ceiling, so it is checked/recorded here exactly like `whatsapp-delivery-workflow.ts`'s own
   * per-attempt send, right before the external call. */
  portfolioQuotaTierLimit: number;
}

export type WhatsAppDigestDeliveryOutcome =
  | { kind: "SKIPPED_NO_ENTRY" }
  // Round 2 Codex review: a crashed invocation's SENDING lease can outlive the queue's own
  // visibility timeout - a redelivery landing here must be retried again (never silently
  // dropped) until the lease actually expires and gets reconciled to UNKNOWN.
  | { kind: "SKIPPED_IN_PROGRESS" }
  | { kind: "SKIPPED_RESOLVED" }
  | { kind: "SKIPPED_NOT_DUE" }
  | { kind: "SKIPPED_TENANT_NOT_ACTIVE" }
  | { kind: "SKIPPED_LOST_LEASE_RACE" }
  | { kind: "RECONCILED_UNKNOWN" }
  | { kind: "SKIPPED_NO_ELIGIBLE_ITEMS" }
  | { kind: "SKIPPED_NO_PHONE" }
  // Retryable (SQS should redeliver): unlike the immediate per-attempt path (which leaves
  // FAILED_RETRYABLE for a future generic redrive mechanism that does not exist yet - see this
  // file's own doc comment), a digest window that regresses to FLUSHED has NO other trigger path
  // once its GSI8 pointer is gone (dropped at flush-claim time, one-shot, never recurring) -
  // native SQS redelivery (bounded by the queue's own maxReceiveCount before DLQ) is the only
  // real safety net available without new infra, strictly better than permanent loss.
  | { kind: "SKIPPED_PORTFOLIO_QUOTA" }
  | { kind: "SENT"; providerMessageId: string; itemCount: number }
  | { kind: "SEND_FAILED"; retryable: boolean };

export async function processWhatsAppDigestDelivery(deps: WhatsAppDigestDeliveryDeps, command: WhatsAppDigestDeliverCommand): Promise<WhatsAppDigestDeliveryOutcome> {
  const now = deps.now();
  const entryKey = digestEntryKey(command.tenantId, command.recipientUserId, "WHATSAPP", command.windowDate);
  const entry = await deps.store.get<DigestEntry>(entryKey, true);
  if (!entry) return { kind: "SKIPPED_NO_ENTRY" };

  if (entry.status === "SENT" || entry.status === "FAILED" || entry.status === "UNKNOWN") {
    // Resumable completion sweep (Round 2 Codex review) - `entry.resolution` is the durable
    // record of the decision already made; replaying it is always safe (read-only data, never a
    // second external call) and completes any attempt a prior crashed invocation left unmarked.
    if (entry.resolution) await applyResolution(deps, command.tenantId, entry.resolution, now);
    return { kind: "SKIPPED_RESOLVED" };
  }

  if (entry.status === "SENDING") {
    if (entry.leaseExpiresAt && Date.parse(entry.leaseExpiresAt) > Date.parse(now)) {
      return { kind: "SKIPPED_IN_PROGRESS" };
    }
    // Lease expired without resolution (worker crashed/timed out mid-send) - never resend
    // blindly, same posture NotificationAttemptStatus.UNKNOWN/decideSendAction already establish.
    const resolution: DigestEntryResolution = { eligibleRefs: command.items, eligibleAttemptStatus: "UNKNOWN", excludedRefs: [], excludedAttemptStatus: "UNKNOWN" };
    const reconciled = await tryConditionalEntryUpdate(deps, entry, { status: "UNKNOWN", resolution }, now);
    if (reconciled) await applyResolution(deps, command.tenantId, resolution, now);
    return { kind: "RECONCILED_UNKNOWN" };
  }

  if (entry.status !== "FLUSHED") {
    // Defensive only - the flush worker never dispatches this command before setting FLUSHED.
    return { kind: "SKIPPED_NOT_DUE" };
  }

  // Round 4 Codex review: the lease must expire comfortably BEFORE the queue's own redelivery
  // budget runs out, or a SENDING lease can outlive every SQS receive attempt and the message
  // reaches the DLQ while the entry is still stuck SENDING - with no automatic path to UNKNOWN
  // left at all (a DLQ message no longer triggers this worker). The digest queue
  // (`infra/main.tf`'s `whatsapp_digest_deliver_queue`, `consumer_timeout_seconds = 10`) gets
  // `visibility_timeout_seconds = 60` and `maxReceiveCount = 5` from `sqs-worker-queue/main.tf`'s
  // fixed sizing - i.e. up to ~5 receive attempts, ~60s apart (t=0,60,120,180,240) before DLQ.
  // 90s means a lease claimed on receive #1 (t=0) is still valid at #2 (t=60, SKIPPED_IN_PROGRESS,
  // forces redelivery again) but has expired by #3 (t=120) - reconciliation to UNKNOWN succeeds
  // with 2 receive attempts to spare, never reaching the DLQ on this path.
  const leaseDurationMs = deps.leaseDurationMs ?? 90_000;
  const leaseExpiresAt = new Date(Date.parse(now) + leaseDurationMs).toISOString();
  const claim = await tryFencedSendingClaim(deps, entry, entryKey, { status: "SENDING", leaseExpiresAt }, now);
  if (claim === "LOST_RACE") return { kind: "SKIPPED_LOST_LEASE_RACE" };
  if (claim === "TENANT_NOT_ACTIVE") return { kind: "SKIPPED_TENANT_NOT_ACTIVE" };
  const claimedEntry: DigestEntry = { ...entry, status: "SENDING", leaseExpiresAt, version: entry.version + 1 };

  const eligible: { ref: DigestEntryItem; item: ExpirationItem }[] = [];
  const excludedRefs: DigestEntryItem[] = [];
  for (const ref of command.items) {
    const item = await deps.store.get<ExpirationItem>(itemKey(authorizedTenantIdFromPersistedEntity(command), ref.itemId), true);
    if (item && item.status === "ACTIVE") eligible.push({ ref, item });
    else excludedRefs.push(ref);
  }

  if (eligible.length === 0) {
    const resolution: DigestEntryResolution = { eligibleRefs: [], eligibleAttemptStatus: "FAILED_TERMINAL", excludedRefs, excludedAttemptStatus: "FAILED_TERMINAL" };
    await finalizeEntry(deps, claimedEntry, "FAILED", resolution, now);
    await applyResolution(deps, command.tenantId, resolution, now);
    return { kind: "SKIPPED_NO_ELIGIBLE_ITEMS" };
  }
  const eligibleRefs = eligible.map((e) => e.ref);

  const to = await deps.resolveRecipientPhone({ tenantId: command.tenantId, userId: command.recipientUserId });
  if (!to) {
    const resolution: DigestEntryResolution = { eligibleRefs, eligibleAttemptStatus: "FAILED_TERMINAL", excludedRefs, excludedAttemptStatus: "FAILED_TERMINAL" };
    await finalizeEntry(deps, claimedEntry, "FAILED", resolution, now);
    await applyResolution(deps, command.tenantId, resolution, now);
    return { kind: "SKIPPED_NO_PHONE" };
  }

  // D-8: same "admit before the external call" discipline whatsapp-delivery-workflow.ts already
  // follows. Unlike the eligibility/phone checks above (conclusively terminal), a quota refusal
  // is retryable - the rolling 24h window means a later attempt can genuinely succeed - so the
  // entry goes back to FLUSHED (never a terminal status, no `resolution` recorded) and this
  // outcome must be reported as a batch failure by the handler so SQS redelivers it.
  const quota = await checkAndRecordWhatsAppPortfolioQuota({ store: deps.store, tierLimit: deps.portfolioQuotaTierLimit, now: deps.now }, to);
  if (!quota.allowed) {
    await resolveEntryStatus(deps, claimedEntry, "FLUSHED", now, { dropLease: true });
    await markAttemptsForRefs(deps, command.tenantId, eligibleRefs, "FAILED_RETRYABLE", now);
    return { kind: "SKIPPED_PORTFOLIO_QUOTA" };
  }

  // Round 1 Codex review: webhook delivery/read/failure callbacks correlate by the ONE
  // `biz_opaque_callback_data` (`tags`) Meta echoes back - a synthetic id with no
  // `NotificationAttemptLookup` row left every digest permanently `UNMATCHED`
  // (`whatsapp-webhook-workflow.ts`). The FIRST eligible item's REAL attempt already has a real
  // lookup row (created at DIGESTED-attempt-creation time, same as every other attempt) - reused
  // here as the correlation target, annotated with every OTHER eligible attempt as a sibling so
  // the webhook workflow can fan the same status out to all of them (see that file's own
  // `digestSiblingAttempts` handling).
  const primary = eligible[0]!.ref;
  const siblings = eligibleRefs.slice(1).map((ref) => ({ intentId: ref.intentId, attemptSk: notificationAttemptKey(command.tenantId, ref.intentId, 1, ref.attemptId).SK }));
  if (siblings.length > 0) {
    const lookupKey = notificationAttemptLookupKey(command.tenantId, primary.attemptId);
    const lookup = await deps.store.get<NotificationAttemptLookup>(lookupKey, true);
    if (lookup) await deps.store.update<NotificationAttemptLookup>({ ...lookup, digestSiblingAttempts: siblings });
  }

  const rendered = deps.renderDigestTemplate({ items: eligible.map((e) => e.item) });
  const correlationId = `digest:${command.recipientUserId}:${command.windowDate}`;

  let sendResult: WhatsAppSendResult;
  try {
    sendResult = await deps.whatsAppProvider.send({
      to,
      templateName: rendered.templateName,
      templateLanguage: rendered.templateLanguage,
      templateParams: rendered.templateParams,
      tags: { attemptId: primary.attemptId, intentId: primary.intentId, tenantId: command.tenantId, correlationId },
    });
  } catch (err) {
    const failureKind = err instanceof WhatsAppSendError ? err.kind : "AMBIGUOUS";
    const nextAttemptStatus = nextWhatsAppStatusAfterSendAttempt({ kind: "FAILURE", failureKind });
    const retryable = failureKind === "CONCLUSIVE_RETRYABLE";
    if (retryable) {
      // Retryable regresses to FLUSHED, same as the quota-refusal path above - no `resolution`
      // recorded (nothing is final yet), attempts marked FAILED_RETRYABLE only for visibility; a
      // later successful retry's own resolution overwrites this via markAttemptsForRefs' allowed-
      // source-status check (Round 2 Codex review: it must accept FAILED_RETRYABLE, not just
      // DIGESTED, or a successful retry can never un-stick an attempt this branch just marked).
      await resolveEntryStatus(deps, claimedEntry, "FLUSHED", now, { dropLease: true });
      await markAttemptsForRefs(deps, command.tenantId, eligibleRefs, nextAttemptStatus, now);
      return { kind: "SEND_FAILED", retryable: true };
    }
    const nextEntryStatus = failureKind === "CONCLUSIVE_TERMINAL" ? "FAILED" : "UNKNOWN";
    const resolution: DigestEntryResolution = { eligibleRefs, eligibleAttemptStatus: nextAttemptStatus, excludedRefs, excludedAttemptStatus: "FAILED_TERMINAL" };
    await finalizeEntry(deps, claimedEntry, nextEntryStatus, resolution, now);
    await applyResolution(deps, command.tenantId, resolution, now);
    return { kind: "SEND_FAILED", retryable: false };
  }

  const nextAttemptStatus = nextWhatsAppStatusAfterSendAttempt({ kind: "ACCEPTED", providerMessageId: sendResult.providerMessageId });
  const resolution: DigestEntryResolution = { eligibleRefs, eligibleAttemptStatus: nextAttemptStatus, excludedRefs, excludedAttemptStatus: "FAILED_TERMINAL", providerMessageId: sendResult.providerMessageId };
  await finalizeEntry(deps, claimedEntry, "SENT", resolution, now);
  await applyResolution(deps, command.tenantId, resolution, now);
  return { kind: "SENT", providerMessageId: sendResult.providerMessageId, itemCount: eligible.length };
}

/**
 * Round 3 Codex review: every catch block in this file used to treat ANY
 * `TransactionCanceledException` as "safe to skip, someone else already applied this" - but only
 * a PROVEN `ConditionalCheckFailed` actually demonstrates that (the version check lost because
 * the row is already at a newer state). A bare `TransactionConflict` (real DynamoDB contention,
 * e.g. two invocations racing this exact write) proves nothing was persisted by anyone - treating
 * it the same way silently discarded the write and returned a success-shaped outcome
 * (`SKIPPED_RESOLVED`/`RECONCILED_UNKNOWN`/`SENT`) the caller/handler never retries. Every
 * transaction in this file has EXACTLY ONE `Update` entry, so checking reason index 0 is
 * sufficient - anything that isn't a proven ConditionalCheckFailed is rethrown, propagating to the
 * handler's outer catch, which DOES push a batch item failure and lets SQS redeliver.
 */
function isProvenConditionalCheckFailure(err: unknown): boolean {
  if (isConditionalCheckFailed(err)) return true;
  if (!isTransactionCanceled(err)) return false;
  return getCancellationReasonCodes(err)?.[0] === "ConditionalCheckFailed";
}

async function tryConditionalEntryUpdate(deps: WhatsAppDigestDeliveryDeps, entry: DigestEntry, set: Record<string, unknown>, now: string): Promise<boolean> {
  try {
    await deps.store.transactWrite([
      { Update: buildVersionedUpdate({ tableName: deps.tableName, key: { PK: entry.PK, SK: entry.SK }, tenantId: entry.tenantId, expectedVersion: entry.version, now, set }) },
    ]);
    return true;
  } catch (err) {
    if (isProvenConditionalCheckFailure(err)) return false;
    throw err;
  }
}

/** Fenced variant, used ONLY for the FLUSHED->SENDING claim - the one transition here that
 * represents a NEW admission of an external, paid WhatsApp send, mirroring exactly why
 * `whatsapp-delivery-workflow.ts`'s own `tryFencedSubmittingClaim` routes through
 * `executeTenantBusinessMutation` (W3-07/D-067): a tenant that has moved to DELETING can never
 * admit a new SENDING lease, even under concurrent retries. Every OTHER transactWrite in this
 * file resolves an already-admitted lease, never fenced, same split that file's own comment
 * documents. */
async function tryFencedSendingClaim(
  deps: WhatsAppDigestDeliveryDeps,
  entry: DigestEntry,
  key: { PK: string; SK: string },
  set: Record<string, unknown>,
  now: string,
): Promise<"CLAIMED" | "LOST_RACE" | "TENANT_NOT_ACTIVE"> {
  try {
    await executeTenantBusinessMutation({
      store: deps.store,
      tableName: deps.tableName,
      tenantId: entry.tenantId,
      entries: [{ Update: buildVersionedUpdate({ tableName: deps.tableName, key, tenantId: entry.tenantId, expectedVersion: entry.version, now, set }) }],
    });
    return "CLAIMED";
  } catch (err) {
    if (err instanceof Error && err.name === "TenantNotActiveError") return "TENANT_NOT_ACTIVE";
    if (isProvenConditionalCheckFailure(err)) return "LOST_RACE";
    throw err;
  }
}

/** Best-effort transition to a NON-terminal status (FLUSHED, for a retryable outcome) - no
 * `resolution` involved, since nothing is final yet. Conditioned on the exact version this
 * worker's own claim advanced it to. `dropLease` removes `leaseExpiresAt` - leaving a stale lease
 * behind would make a LATER claim attempt miscompute its own expiry comparison against the WRONG
 * lease. */
async function resolveEntryStatus(deps: WhatsAppDigestDeliveryDeps, claimedEntry: DigestEntry, status: DigestEntry["status"], now: string, options?: { dropLease?: boolean }): Promise<void> {
  try {
    await deps.store.transactWrite([
      {
        Update: buildVersionedUpdate({
          tableName: deps.tableName,
          key: { PK: claimedEntry.PK, SK: claimedEntry.SK },
          tenantId: claimedEntry.tenantId,
          expectedVersion: claimedEntry.version,
          now,
          set: { status },
          remove: options?.dropLease ? ["leaseExpiresAt"] : undefined,
        }),
      },
    ]);
  } catch (err) {
    if (!isProvenConditionalCheckFailure(err)) throw err;
  }
}

/** Transition to a TERMINAL status (SENT/FAILED/UNKNOWN), writing `resolution` in the SAME
 * versioned Update - Round 2 Codex review's fix for orphaned attempts: this write is the durable
 * decision record `applyResolution` replays on any later invocation, so a crash between this call
 * and that one never loses the outcome, only delays completing it. */
async function finalizeEntry(deps: WhatsAppDigestDeliveryDeps, claimedEntry: DigestEntry, status: DigestEntry["status"], resolution: DigestEntryResolution, now: string): Promise<void> {
  try {
    await deps.store.transactWrite([
      {
        Update: buildVersionedUpdate({
          tableName: deps.tableName,
          key: { PK: claimedEntry.PK, SK: claimedEntry.SK },
          tenantId: claimedEntry.tenantId,
          expectedVersion: claimedEntry.version,
          now,
          set: { status, resolution },
          remove: ["leaseExpiresAt"],
        }),
      },
    ]);
  } catch (err) {
    if (!isProvenConditionalCheckFailure(err)) throw err;
  }
}

/** Replays a `DigestEntryResolution` against every attempt it references - safe to call any
 * number of times (read-only data, `markAttemptsForRefs`' own allowed-source-status check makes
 * each individual attempt update idempotent). */
async function applyResolution(deps: WhatsAppDigestDeliveryDeps, tenantId: string, resolution: DigestEntryResolution, now: string): Promise<void> {
  if (resolution.eligibleRefs.length > 0) await markAttemptsForRefs(deps, tenantId, resolution.eligibleRefs, resolution.eligibleAttemptStatus, now, resolution.providerMessageId);
  if (resolution.excludedRefs.length > 0) await markAttemptsForRefs(deps, tenantId, resolution.excludedRefs, resolution.excludedAttemptStatus, now);
}

/** States this worker itself may have left an attempt at, from which a LATER call of this same
 * worker (a retry, or a resumable-completion replay) is allowed to advance it further. Anything
 * else (ACCEPTED/DELIVERED/BOUNCED/COMPLAINED/FAILED_TERMINAL/UNKNOWN) is already resolved -
 * possibly advanced further still by a webhook callback in the meantime - and must never be
 * overwritten by this worker again. Round 2 Codex review: the original guard only accepted
 * DIGESTED, which permanently stranded an attempt at FAILED_RETRYABLE even after a subsequent
 * send genuinely succeeded. */
const ATTEMPT_STATUSES_THIS_WORKER_MAY_OVERWRITE: readonly NotificationAttemptStatus[] = ["DIGESTED", "FAILED_RETRYABLE"];

/** Best-effort per-attempt update (same "never let one failed row corrupt the batch" posture as
 * `whatsapp-delivery-workflow.ts`'s own `forceUpdateAttemptStatus`). `attemptNumber` is always 1:
 * every DIGESTED attempt is created exactly once, by `notification-router-workflow.ts`'s
 * `applyRoutedDecision`, which never redrives (same invariant every other attempt in this router
 * already relies on). */
async function markAttemptsForRefs(deps: WhatsAppDigestDeliveryDeps, tenantId: string, refs: DigestEntryItem[], status: NotificationAttemptStatus, now: string, providerMessageId?: string): Promise<void> {
  for (const ref of refs) {
    const key = notificationAttemptKey(tenantId, ref.intentId, 1, ref.attemptId);
    const attempt = await deps.store.get<NotificationAttempt>(key, true);
    if (!attempt || !ATTEMPT_STATUSES_THIS_WORKER_MAY_OVERWRITE.includes(attempt.status)) continue;
    try {
      await deps.store.transactWrite([
        {
          Update: buildVersionedUpdate({
            tableName: deps.tableName,
            key,
            tenantId,
            expectedVersion: attempt.version,
            now,
            set: { status, ...(providerMessageId ? { providerMessageId, acceptedAt: now } : {}), completedAt: now },
          }),
        },
      ]);
    } catch (err) {
      if (!isProvenConditionalCheckFailure(err)) throw err;
    }
  }
}
