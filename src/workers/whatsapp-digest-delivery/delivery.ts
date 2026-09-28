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
 * Round 1 Codex review (D-347 §3.5) found the first version had no admission/lease at all: a
 * redelivered SQS message (at-least-once, always possible) sent the message TWICE, and a
 * retryable-failure-then-successful-retry sequence left the attempts permanently recorded as
 * failed. `DigestEntry.status` now carries the SAME PREPARED->SUBMITTING->resolved lease
 * discipline `NotificationAttempt`/`decideSendAction` already establish, applied once per window
 * instead of once per attempt (`digest-entry.ts`'s own doc comment on `DigestEntryStatus`) — this
 * worker re-reads the `DigestEntry` FIRST and admits FLUSHED->SENDING (fenced against tenant
 * lifecycle, same `executeTenantBusinessMutation` lane the immediate WhatsApp send already uses)
 * before ever calling the provider.
 */
import { buildVersionedUpdate, isTransactionCanceled, isConditionalCheckFailed } from "../../shared/dynamodb/occ.js";
import { executeTenantBusinessMutation } from "../../shared/tenant-lifecycle/tenant-business-mutation.js";
import { itemKey, type ExpirationItem } from "../../modules/expiration/domain/expiration-item.js";
import { authorizedTenantIdFromPersistedEntity } from "../../modules/identity/domain/authorization.js";
import { notificationAttemptKey, notificationAttemptLookupKey, type NotificationAttempt, type NotificationAttemptLookup, type NotificationAttemptStatus } from "../../modules/notification/domain/notification-attempt.js";
import { digestEntryKey, type DigestEntry, type DigestEntryItem } from "../../modules/notification/domain/digest-entry.js";
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
    return { kind: "SKIPPED_RESOLVED" };
  }

  if (entry.status === "SENDING") {
    if (entry.leaseExpiresAt && Date.parse(entry.leaseExpiresAt) > Date.parse(now)) {
      return { kind: "SKIPPED_IN_PROGRESS" };
    }
    // Lease expired without resolution (worker crashed/timed out mid-send) - never resend
    // blindly, same posture NotificationAttemptStatus.UNKNOWN/decideSendAction already establish.
    const reconciled = await tryConditionalEntryUpdate(deps, entry, { status: "UNKNOWN" }, now);
    if (reconciled) await markAttempts(deps, command, "UNKNOWN", now);
    return { kind: "RECONCILED_UNKNOWN" };
  }

  if (entry.status !== "FLUSHED") {
    // Defensive only - the flush worker never dispatches this command before setting FLUSHED.
    return { kind: "SKIPPED_NOT_DUE" };
  }

  const leaseDurationMs = deps.leaseDurationMs ?? 5 * 60_000;
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
  // Round 1 Codex review: an item dropped from the rendered content must never share the SAME
  // ACCEPTED/providerMessageId as the items actually sent - it never appeared in the message.
  if (excludedRefs.length > 0) await markAttemptsForRefs(deps, command.tenantId, excludedRefs, "FAILED_TERMINAL", now);

  if (eligible.length === 0) {
    await resolveEntry(deps, claimedEntry, "FAILED", now);
    return { kind: "SKIPPED_NO_ELIGIBLE_ITEMS" };
  }
  const eligibleRefs = eligible.map((e) => e.ref);

  const to = await deps.resolveRecipientPhone({ tenantId: command.tenantId, userId: command.recipientUserId });
  if (!to) {
    await resolveEntry(deps, claimedEntry, "FAILED", now);
    await markAttemptsForRefs(deps, command.tenantId, eligibleRefs, "FAILED_TERMINAL", now);
    return { kind: "SKIPPED_NO_PHONE" };
  }

  // D-8: same "admit before the external call" discipline whatsapp-delivery-workflow.ts already
  // follows. Unlike the eligibility/phone checks above (conclusively terminal), a quota refusal
  // is retryable - the rolling 24h window means a later attempt can genuinely succeed - so the
  // entry goes back to FLUSHED (never FAILED) and this outcome must be reported as a batch
  // failure by the handler so SQS redelivers it.
  const quota = await checkAndRecordWhatsAppPortfolioQuota({ store: deps.store, tierLimit: deps.portfolioQuotaTierLimit, now: deps.now }, to);
  if (!quota.allowed) {
    await resolveEntry(deps, claimedEntry, "FLUSHED", now, { dropLease: true });
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
    const nextEntryStatus = retryable ? "FLUSHED" : failureKind === "CONCLUSIVE_TERMINAL" ? "FAILED" : "UNKNOWN";
    await resolveEntry(deps, claimedEntry, nextEntryStatus, now, { dropLease: retryable });
    await markAttemptsForRefs(deps, command.tenantId, eligibleRefs, nextAttemptStatus, now);
    return { kind: "SEND_FAILED", retryable };
  }

  await resolveEntry(deps, claimedEntry, "SENT", now);
  const nextAttemptStatus = nextWhatsAppStatusAfterSendAttempt({ kind: "ACCEPTED", providerMessageId: sendResult.providerMessageId });
  await markAttemptsForRefs(deps, command.tenantId, eligibleRefs, nextAttemptStatus, now, sendResult.providerMessageId);
  return { kind: "SENT", providerMessageId: sendResult.providerMessageId, itemCount: eligible.length };
}

async function tryConditionalEntryUpdate(deps: WhatsAppDigestDeliveryDeps, entry: DigestEntry, set: Record<string, unknown>, now: string): Promise<boolean> {
  try {
    await deps.store.transactWrite([
      { Update: buildVersionedUpdate({ tableName: deps.tableName, key: { PK: entry.PK, SK: entry.SK }, tenantId: entry.tenantId, expectedVersion: entry.version, now, set }) },
    ]);
    return true;
  } catch (err) {
    if (isTransactionCanceled(err) || isConditionalCheckFailed(err)) return false;
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
    if (isTransactionCanceled(err) || isConditionalCheckFailed(err)) return "LOST_RACE";
    throw err;
  }
}

/** Best-effort resolution of the SENDING lease - conditioned on the exact version this worker's
 * own claim advanced it to, so a lease-expiry reconciliation racing this same resolution can
 * never clobber it (whichever wins is the correct terminal state; the loser's write is a safe
 * no-op). `dropLease` removes `leaseExpiresAt` when returning to a non-SENDING status (FLUSHED
 * for a retryable failure) - leaving a stale lease behind would make a LATER claim attempt
 * miscompute its own expiry comparison against the WRONG lease. */
async function resolveEntry(deps: WhatsAppDigestDeliveryDeps, claimedEntry: DigestEntry, status: DigestEntry["status"], now: string, options?: { dropLease?: boolean }): Promise<void> {
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
    if (!isTransactionCanceled(err) && !isConditionalCheckFailed(err)) throw err;
  }
}

/** Best-effort per-attempt update (same "never let one failed row corrupt the batch" posture as
 * `whatsapp-delivery-workflow.ts`'s own `forceUpdateAttemptStatus`), conditioned on the attempt
 * still being DIGESTED — a redelivered SQS message (at-least-once) that finds attempts already
 * resolved is a safe no-op, never a double transition. `attemptNumber` is always 1: every
 * DIGESTED attempt is created exactly once, by `notification-router-workflow.ts`'s
 * `applyRoutedDecision`, which never redrives (same invariant every other attempt in this router
 * already relies on). */
async function markAttemptsForRefs(deps: WhatsAppDigestDeliveryDeps, tenantId: string, refs: DigestEntryItem[], status: NotificationAttemptStatus, now: string, providerMessageId?: string): Promise<void> {
  for (const ref of refs) {
    const key = notificationAttemptKey(tenantId, ref.intentId, 1, ref.attemptId);
    const attempt = await deps.store.get<NotificationAttempt>(key, true);
    if (!attempt || attempt.status !== "DIGESTED") continue;
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
      if (!isTransactionCanceled(err)) throw err;
    }
  }
}

async function markAttempts(deps: WhatsAppDigestDeliveryDeps, command: WhatsAppDigestDeliverCommand, status: NotificationAttemptStatus, now: string): Promise<void> {
  await markAttemptsForRefs(deps, command.tenantId, command.items, status, now);
}
