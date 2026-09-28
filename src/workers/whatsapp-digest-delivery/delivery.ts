/**
 * WhatsAppDigestDeliveryWorker — D-347 §3.5. Consumes `SQS_NOTIFICATION_WHATSAPP_DIGEST_V1`, fed
 * by `whatsapp-digest-flush.ts`'s claim transaction (bare `WhatsAppDigestFlushRequested.data`
 * payload — `tenantId`/`recipientUserId`/`windowDate`/`items` — no envelope wrapper, same
 * convention `SQS_REPORT_SUBSCRIPTION_DELIVERY_V1` already established for a scheduler-fed
 * destination). Sends exactly ONE consolidated WhatsApp message per window, then transitions
 * every underlying `NotificationAttempt` (DIGESTED -> ACCEPTED, one of the FAILED_ statuses, or
 * UNKNOWN) that was folded into it — the ONE external call's outcome applies uniformly to every
 * item in the window
 * (unlike `whatsapp-delivery-workflow.ts`'s per-attempt sends, there is no per-item send to fail
 * independently here).
 */
import { buildVersionedUpdate, isTransactionCanceled } from "../../shared/dynamodb/occ.js";
import { itemKey, type ExpirationItem } from "../../modules/expiration/domain/expiration-item.js";
import { authorizedTenantIdFromPersistedEntity } from "../../modules/identity/domain/authorization.js";
import { notificationAttemptKey, type NotificationAttempt, type NotificationAttemptStatus } from "../../modules/notification/domain/notification-attempt.js";
import type { NotificationStore } from "../../modules/notification/ports/notification-store.js";
import type { WhatsAppProviderAdapter, WhatsAppSendResult } from "../../modules/notification/ports/whatsapp-provider.js";
import { WhatsAppSendError } from "../../modules/notification/ports/whatsapp-provider.js";
import { nextWhatsAppStatusAfterSendAttempt } from "../../modules/notification/application/whatsapp-delivery.js";
import { checkAndRecordWhatsAppPortfolioQuota } from "../../modules/notification/application/whatsapp-portfolio-quota-service.js";
import type { DigestEntryItem } from "../../modules/notification/domain/digest-entry.js";

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
  /** D-8 (fatia 4/5): the real Cloud API 24h unique-recipient tier ceiling for this portfolio's
   * phone number - a digest message is still one real template message against that same
   * ceiling, so it is checked/recorded here exactly like `whatsapp-delivery-workflow.ts`'s own
   * per-attempt send, right before the external call. */
  portfolioQuotaTierLimit: number;
}

export type WhatsAppDigestDeliveryOutcome =
  | { kind: "SKIPPED_NO_ELIGIBLE_ITEMS" }
  | { kind: "SKIPPED_NO_PHONE" }
  | { kind: "SKIPPED_PORTFOLIO_QUOTA" }
  | { kind: "SENT"; providerMessageId: string; itemCount: number }
  | { kind: "SEND_FAILED" };

export async function processWhatsAppDigestDelivery(deps: WhatsAppDigestDeliveryDeps, command: WhatsAppDigestDeliverCommand): Promise<WhatsAppDigestDeliveryOutcome> {
  const now = deps.now();

  const eligibleItems: ExpirationItem[] = [];
  for (const ref of command.items) {
    const item = await deps.store.get<ExpirationItem>(itemKey(authorizedTenantIdFromPersistedEntity(command), ref.itemId), true);
    if (item && item.status === "ACTIVE") eligibleItems.push(item);
  }

  if (eligibleItems.length === 0) {
    await markAttempts(deps, command, "FAILED_TERMINAL", now);
    return { kind: "SKIPPED_NO_ELIGIBLE_ITEMS" };
  }

  const to = await deps.resolveRecipientPhone({ tenantId: command.tenantId, userId: command.recipientUserId });
  if (!to) {
    await markAttempts(deps, command, "FAILED_TERMINAL", now);
    return { kind: "SKIPPED_NO_PHONE" };
  }

  // D-8: same "admit before the external call" discipline whatsapp-delivery-workflow.ts already
  // follows - a quota refusal (tier reached, or the quota read itself failed - fail-closed) means
  // no external call was ever attempted, so this is a CONCLUSIVE_RETRYABLE failure, never
  // ambiguous.
  const quota = await checkAndRecordWhatsAppPortfolioQuota({ store: deps.store, tierLimit: deps.portfolioQuotaTierLimit, now: deps.now }, to);
  if (!quota.allowed) {
    const nextStatus = nextWhatsAppStatusAfterSendAttempt({ kind: "FAILURE", failureKind: "CONCLUSIVE_RETRYABLE" });
    await markAttempts(deps, command, nextStatus, now);
    return { kind: "SKIPPED_PORTFOLIO_QUOTA" };
  }

  const rendered = deps.renderDigestTemplate({ items: eligibleItems });
  const correlationId = `digest:${command.recipientUserId}:${command.windowDate}`;

  let sendResult: WhatsAppSendResult;
  try {
    sendResult = await deps.whatsAppProvider.send({
      to,
      templateName: rendered.templateName,
      templateLanguage: rendered.templateLanguage,
      templateParams: rendered.templateParams,
      tags: { attemptId: correlationId, intentId: correlationId, tenantId: command.tenantId, correlationId },
    });
  } catch (err) {
    const failureKind = err instanceof WhatsAppSendError ? err.kind : "AMBIGUOUS";
    const nextStatus = nextWhatsAppStatusAfterSendAttempt({ kind: "FAILURE", failureKind });
    await markAttempts(deps, command, nextStatus, now);
    return { kind: "SEND_FAILED" };
  }

  const nextStatus = nextWhatsAppStatusAfterSendAttempt({ kind: "ACCEPTED", providerMessageId: sendResult.providerMessageId });
  await markAttempts(deps, command, nextStatus, now, sendResult.providerMessageId);
  return { kind: "SENT", providerMessageId: sendResult.providerMessageId, itemCount: eligibleItems.length };
}

/** Best-effort per-attempt update (same "never let one failed row corrupt the batch" posture as
 * `whatsapp-delivery-workflow.ts`'s own `forceUpdateAttemptStatus`), conditioned on the attempt
 * still being DIGESTED — a redelivered SQS message (at-least-once) that finds attempts already
 * resolved is a safe no-op, never a double transition. `attemptNumber` is always 1: every
 * DIGESTED attempt is created exactly once, by `notification-router-workflow.ts`'s
 * `applyRoutedDecision`, which never redrives (same invariant every other attempt in this router
 * already relies on). */
async function markAttempts(deps: WhatsAppDigestDeliveryDeps, command: WhatsAppDigestDeliverCommand, status: NotificationAttemptStatus, now: string, providerMessageId?: string): Promise<void> {
  for (const ref of command.items) {
    const key = notificationAttemptKey(command.tenantId, ref.intentId, 1, ref.attemptId);
    const attempt = await deps.store.get<NotificationAttempt>(key, true);
    if (!attempt || attempt.status !== "DIGESTED") continue;
    try {
      await deps.store.transactWrite([
        {
          Update: buildVersionedUpdate({
            tableName: deps.tableName,
            key,
            tenantId: command.tenantId,
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
