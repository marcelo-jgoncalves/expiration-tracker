/**
 * EmailDeliveryWorker composition-root logic (M4). Same role as
 * notification-router-workflow.ts: loads entities with consistent reads, calls the pure
 * decision functions (email-delivery.ts, corrective-intent-service.ts), translates the
 * result into real DynamoDB writes + (only on the SEND path) one external SES call.
 *
 * The SQS command (`notification.email-deliver.v1`) carries `attemptId` but not the
 * attempt's full SK (which embeds `attemptNumber`) - this worker resolves it via the SAME
 * NotificationAttemptLookup pointer the SesCallbackWorker uses (round3-fixes.md item 1),
 * reused here rather than inventing a second correlation mechanism for the same problem.
 */
import { itemKey, type ExpirationItem } from "../../expiration/domain/expiration-item.js";
import type { NotificationIntent } from "../../reminder/domain/notification-intent.js";
import {
  notificationAttemptLookupKey,
  type NotificationAttempt,
  type NotificationAttemptLookup,
} from "../domain/notification-attempt.js";
import type { NotificationStore } from "../ports/notification-store.js";
import { isTransactionCanceled, isConditionalCheckFailed } from "../../../shared/dynamodb/occ.js";
import { buildVersionedUpdate } from "../../../shared/dynamodb/occ.js";
import type { EmailProviderAdapter, EmailSendResult } from "../ports/email-provider.js";
import { EmailSendError } from "../ports/email-provider.js";
import { decideSendAction, nextStatusAfterSendAttempt } from "./email-delivery.js";
import { applyStaleDeliveryDecision } from "./notification-router-workflow.js";
import { executeTenantBusinessMutation } from "../../../shared/tenant-lifecycle/tenant-business-mutation.js";

export interface EmailDeliverCommandData {
  tenantId: string;
  intentId: string;
  attemptId: string;
  itemId: string;
  expectedItemVersion: number;
  templateId: string;
  templateVersion: number;
  locale: string;
  deliverNotBefore: string;
  correlationId: string;
}

export interface EmailDeliveryWorkflowDeps {
  store: NotificationStore;
  tableName: string;
  emailProvider: EmailProviderAdapter;
  resolveRecipientEmail: (input: { tenantId: string; userId: string }) => Promise<string | undefined>;
  renderTemplate: (input: { templateId: string; templateVersion: number; locale: string; item: ExpirationItem }) => Record<string, unknown>;
  now: () => string;
  newIntentId: () => string;
  leaseDurationMs?: number;
}

export type EmailDeliveryOutcome =
  | { kind: "DEFERRED" } // deliverNotBefore not reached yet - caller reschedules, never discards
  | { kind: "SKIPPED_NO_ATTEMPT" } // lookup/attempt missing - logged upstream, not a crash
  | { kind: "SKIPPED_IN_PROGRESS" }
  | { kind: "SKIPPED_RESOLVED" }
  | { kind: "RECONCILED_UNKNOWN" }
  | { kind: "SKIPPED_LOST_LEASE_RACE" } // another invocation already claimed this SUBMITTING transition
  | { kind: "SKIPPED_TENANT_NOT_ACTIVE" } // W3-07 (D-067): tenant is DELETING/deleted - no new SUBMITTING admission
  | { kind: "NOT_SENT_STALE"; correctiveKind: "REPLACEMENT" | "CORRECTIVE" }
  | { kind: "SENT"; providerMessageId: string }
  | { kind: "SEND_FAILED"; nextStatus: string };

export async function processEmailDelivery(deps: EmailDeliveryWorkflowDeps, command: EmailDeliverCommandData): Promise<EmailDeliveryOutcome> {
  const now = deps.now();
  if (Date.parse(command.deliverNotBefore) > Date.parse(now)) {
    return { kind: "DEFERRED" };
  }

  const lookup = await deps.store.get<NotificationAttemptLookup>(notificationAttemptLookupKey(command.tenantId, command.attemptId), true);
  if (!lookup) return { kind: "SKIPPED_NO_ATTEMPT" };

  const intentPk = `TENANT#${lookup.tenantId}#INTENT#${lookup.intentId}`;
  const attempt = await deps.store.get<NotificationAttempt>({ PK: intentPk, SK: lookup.attemptSk }, true);
  if (!attempt) return { kind: "SKIPPED_NO_ATTEMPT" };

  const leaseDurationMs = deps.leaseDurationMs ?? 5 * 60_000;
  const action = decideSendAction({ status: attempt.status, leaseExpiresAt: attempt.leaseExpiresAt }, now);

  if (action.action === "SKIP_IN_PROGRESS") return { kind: "SKIPPED_IN_PROGRESS" };
  if (action.action === "SKIP_RESOLVED") return { kind: "SKIPPED_RESOLVED" };

  if (action.action === "RECONCILE_UNKNOWN") {
    try {
      await deps.store.update({
        ...attempt,
        status: "UNKNOWN",
        version: attempt.version + 1,
        updatedAt: now,
      });
    } catch {
      // Best-effort - a concurrent writer already resolved this attempt out of SUBMITTING.
    }
    return { kind: "RECONCILED_UNKNOWN" };
  }

  // action.action === "SEND" from here.
  const item = await deps.store.get<ExpirationItem>(itemKey(command.tenantId, command.itemId), true);
  const intent = await deps.store.get<NotificationIntent>({ PK: intentPk, SK: "META" }, true);

  const isStale = !item || item.status !== "ACTIVE" || item.version !== command.expectedItemVersion;
  if (isStale) {
    const marked = await tryConditionalUpdate(deps, attempt, { status: "NOT_SENT_STALE" }, now);
    if (!marked) return { kind: "SKIPPED_LOST_LEASE_RACE" };

    let correctiveKind: "REPLACEMENT" | "CORRECTIVE" = "REPLACEMENT"; // attempt never left PREPARED/FAILED_RETRYABLE before this point
    if (intent && item) {
      const outcome = await applyStaleDeliveryDecision(deps, intent, correctiveKind, now, item.version, intent.policyVersion);
      correctiveKind = outcome.correctiveKind;
    }
    return { kind: "NOT_SENT_STALE", correctiveKind };
  }

  // W3-07 (D-067, SES post-DELETING policy, Option 1): the SUBMITTING claim is the actual
  // admission point for a paid/external SES send - it MUST go through the TenantBusinessMutation
  // fence so no NEW admission is possible once the tenant is DELETING. Once this claim commits
  // (tenant was ACTIVE at that atomic instant), the send below is allowed to proceed and resolve
  // normally even if ACTIVE->DELETING happens moments later - no cancel, no lease/drain. Every
  // OTHER transactWrite in this file (RECONCILE_UNKNOWN, NOT_SENT_STALE, forceUpdateAttemptStatus)
  // is a status resolution of an already-admitted attempt, not a new admission, so those stay
  // unfenced per the same "already-admitted operations may finish" contract quota.consume() uses.
  const leaseExpiresAt = new Date(Date.parse(now) + leaseDurationMs).toISOString();
  const claim = await tryFencedSubmittingClaim(deps, attempt, { status: "SUBMITTING", leaseExpiresAt, submitStartedAt: now }, now);
  if (claim === "LOST_RACE") return { kind: "SKIPPED_LOST_LEASE_RACE" };
  if (claim === "TENANT_NOT_ACTIVE") return { kind: "SKIPPED_TENANT_NOT_ACTIVE" };

  const recipientUserId = intent?.recipientUserId;
  const to = recipientUserId ? await deps.resolveRecipientEmail({ tenantId: command.tenantId, userId: recipientUserId }) : undefined;

  if (!to || !item) {
    // Can't send without a resolved address - conclusive terminal failure, not ambiguous.
    const nextStatus = nextStatusAfterSendAttempt({ kind: "FAILURE", failureKind: "CONCLUSIVE_TERMINAL" });
    await forceUpdateAttemptStatus(deps, { ...attempt, status: "SUBMITTING", version: attempt.version + 1 }, nextStatus, now);
    return { kind: "SEND_FAILED", nextStatus };
  }

  let sendResult: EmailSendResult;
  try {
    sendResult = await deps.emailProvider.send({
      to,
      templateId: command.templateId,
      templateVersion: command.templateVersion,
      locale: command.locale,
      renderContext: deps.renderTemplate({ templateId: command.templateId, templateVersion: command.templateVersion, locale: command.locale, item }),
      tags: { attemptId: attempt.attemptId, intentId: command.intentId, tenantId: command.tenantId, correlationId: command.correlationId },
    });
  } catch (err) {
    const failureKind = err instanceof EmailSendError ? err.kind : "AMBIGUOUS";
    const nextStatus = nextStatusAfterSendAttempt({ kind: "FAILURE", failureKind });
    await forceUpdateAttemptStatus(deps, { ...attempt, status: "SUBMITTING", version: attempt.version + 1 }, nextStatus, now);
    return { kind: "SEND_FAILED", nextStatus };
  }

  const nextStatus = nextStatusAfterSendAttempt({ kind: "ACCEPTED", providerMessageId: sendResult.providerMessageId });
  await forceUpdateAttemptStatus(deps, { ...attempt, status: "SUBMITTING", version: attempt.version + 1 }, nextStatus, now, sendResult.providerMessageId);
  return { kind: "SENT", providerMessageId: sendResult.providerMessageId };
}

/** OCC-conditional update FROM the attempt's currently-known status - if another invocation
 * already moved it (lease race), this returns false rather than overwriting concurrent
 * progress. */
async function tryConditionalUpdate(
  deps: EmailDeliveryWorkflowDeps,
  attempt: NotificationAttempt,
  set: Record<string, unknown>,
  now: string,
): Promise<boolean> {
  try {
    await deps.store.transactWrite([
      {
        Update: buildVersionedUpdate({
          tableName: deps.tableName,
          key: { PK: attempt.PK, SK: attempt.SK },
          tenantId: attempt.tenantId,
          expectedVersion: attempt.version,
          now,
          set,
        }),
      },
    ]);
    return true;
  } catch (err) {
    if (isTransactionCanceled(err) || isConditionalCheckFailed(err)) return false;
    throw err;
  }
}

/** Fenced variant of `tryConditionalUpdate`, used ONLY for the SUBMITTING claim (W3-07/D-067) -
 * the one transition in this file that represents a NEW admission of an external SES send, as
 * opposed to resolving the status of a send already admitted. Routes through
 * `executeTenantBusinessMutation` so the same TransactWriteItems that claims SUBMITTING also
 * asserts `TenantLifecycleRecord.status = ACTIVE`, atomically - a tenant that has moved to
 * DELETING can never claim a new SUBMITTING lease, even under concurrent retries. Returns
 * "LOST_RACE" for an ordinary lease-race loss (unchanged behavior) and "TENANT_NOT_ACTIVE" when
 * the lifecycle fence specifically is what rejected the claim, so the caller can report that
 * distinctly instead of collapsing it into the harmless recoverable lease race. */
async function tryFencedSubmittingClaim(
  deps: EmailDeliveryWorkflowDeps,
  attempt: NotificationAttempt,
  set: Record<string, unknown>,
  now: string,
): Promise<"CLAIMED" | "LOST_RACE" | "TENANT_NOT_ACTIVE"> {
  try {
    await executeTenantBusinessMutation({
      store: deps.store,
      tableName: deps.tableName,
      tenantId: attempt.tenantId,
      entries: [
        {
          Update: buildVersionedUpdate({
            tableName: deps.tableName,
            key: { PK: attempt.PK, SK: attempt.SK },
            tenantId: attempt.tenantId,
            expectedVersion: attempt.version,
            now,
            set,
          }),
        },
      ],
    });
    return "CLAIMED";
  } catch (err) {
    if (err instanceof Error && err.name === "TenantNotActiveError") return "TENANT_NOT_ACTIVE";
    if (isTransactionCanceled(err) || isConditionalCheckFailed(err)) return "LOST_RACE";
    throw err;
  }
}

/** Post-SEND status transition - the attempt was already moved to SUBMITTING (with a
 * bumped version) immediately before the external call, so this update's expected version
 * is that bumped value. Failure here (e.g. concurrent redrive) is logged upstream; the
 * attempt may be reconciled to UNKNOWN by a later invocation instead, which is acceptable
 * per the at-most-once policy. */
async function forceUpdateAttemptStatus(
  deps: EmailDeliveryWorkflowDeps,
  submittingAttempt: NotificationAttempt,
  nextStatus: string,
  now: string,
  providerMessageId?: string,
): Promise<void> {
  try {
    await deps.store.transactWrite([
      {
        Update: buildVersionedUpdate({
          tableName: deps.tableName,
          key: { PK: submittingAttempt.PK, SK: submittingAttempt.SK },
          tenantId: submittingAttempt.tenantId,
          expectedVersion: submittingAttempt.version,
          now,
          set: {
            status: nextStatus,
            ...(providerMessageId ? { providerMessageId, acceptedAt: now } : {}),
            completedAt: now,
          },
        }),
      },
    ]);
  } catch (err) {
    if (!isTransactionCanceled(err) && !isConditionalCheckFailed(err)) throw err;
  }
}
