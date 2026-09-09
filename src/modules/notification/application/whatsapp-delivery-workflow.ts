/**
 * WhatsAppDeliveryWorker composition-root logic (fatia 2/5,
 * `docs/architecture/reviews/whatsapp-channel-scoping/estado-final-consolidado.md`). Mirrors
 * `email-delivery-workflow.ts` field-for-field and decision-for-decision - same lease/OCC/
 * fenced-SUBMITTING-claim discipline, same staleness handling via `applyStaleDeliveryDecision`
 * (already generic over `CorrectiveIntentDeps`, reused verbatim, not duplicated).
 *
 * NOT wired to the router yet (`notification-router.ts`'s `SUPPORTED_CHANNELS` still routes
 * `EMAIL` alone - that wiring is fatia 5/5, D-197's "próxima ação real"). This worker is
 * reachable today only via a direct SQS message on `whatsapp-deliver-queue` or a direct unit/
 * integration-test call - never by the real notification flow, by design of this fatia's
 * boundary.
 */
import { itemKey, type ExpirationItem } from "../../expiration/domain/expiration-item.js";
import { authorizedTenantIdFromPersistedEntity } from "../../identity/domain/authorization.js";
import type { NotificationIntent } from "../../reminder/domain/notification-intent.js";
import {
  notificationAttemptLookupKey,
  type NotificationAttempt,
  type NotificationAttemptLookup,
} from "../domain/notification-attempt.js";
import type { NotificationStore } from "../ports/notification-store.js";
import { isTransactionCanceled, isConditionalCheckFailed } from "../../../shared/dynamodb/occ.js";
import { buildVersionedUpdate } from "../../../shared/dynamodb/occ.js";
import type { WhatsAppProviderAdapter, WhatsAppSendResult } from "../ports/whatsapp-provider.js";
import { WhatsAppSendError } from "../ports/whatsapp-provider.js";
import { decideSendAction, nextWhatsAppStatusAfterSendAttempt } from "./whatsapp-delivery.js";
import { applyStaleDeliveryDecision } from "./notification-router-workflow.js";
import { executeTenantBusinessMutation } from "../../../shared/tenant-lifecycle/tenant-business-mutation.js";

export interface WhatsAppDeliverCommandData {
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

export interface WhatsAppDeliveryWorkflowDeps {
  store: NotificationStore;
  tableName: string;
  whatsAppProvider: WhatsAppProviderAdapter;
  /** Resolves the CURRENT E.164 phone for a recipient, already gated by both `Membership`/
   * `GlobalUser.identityStatus` (same eligibility rule `resolveRecipientEmail` enforces) AND
   * `WhatsAppOptIn` existing for that EXACT phone (D-5: "leitura sempre contra o telefone
   * ATUAL de GlobalUser" - a phone change invalidates the old opt-in by construction). Returns
   * `undefined` for any of: not a member, not active, no phone on file, or no matching opt-in. */
  resolveRecipientPhone: (input: { tenantId: string; userId: string }) => Promise<string | undefined>;
  renderTemplate: (input: { templateId: string; templateVersion: number; locale: string; item: ExpirationItem }) => {
    templateName: string;
    templateLanguage: string;
    templateParams: string[];
  };
  now: () => string;
  newIntentId: () => string;
  leaseDurationMs?: number;
}

export type WhatsAppDeliveryOutcome =
  | { kind: "DEFERRED" }
  | { kind: "SKIPPED_NO_ATTEMPT" }
  | { kind: "SKIPPED_IN_PROGRESS" }
  | { kind: "SKIPPED_RESOLVED" }
  | { kind: "RECONCILED_UNKNOWN" }
  | { kind: "SKIPPED_LOST_LEASE_RACE" }
  | { kind: "SKIPPED_TENANT_NOT_ACTIVE" }
  | { kind: "NOT_SENT_STALE"; correctiveKind: "REPLACEMENT" | "CORRECTIVE" }
  | { kind: "SENT"; providerMessageId: string }
  | { kind: "SEND_FAILED"; nextStatus: string };

export async function processWhatsAppDelivery(deps: WhatsAppDeliveryWorkflowDeps, command: WhatsAppDeliverCommandData): Promise<WhatsAppDeliveryOutcome> {
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
  const item = await deps.store.get<ExpirationItem>(itemKey(authorizedTenantIdFromPersistedEntity(command), command.itemId), true);
  const intent = await deps.store.get<NotificationIntent>({ PK: intentPk, SK: "META" }, true);

  const isStale = !item || item.status !== "ACTIVE" || item.version !== command.expectedItemVersion;
  if (isStale) {
    const marked = await tryConditionalUpdate(deps, attempt, { status: "NOT_SENT_STALE" }, now);
    if (!marked) return { kind: "SKIPPED_LOST_LEASE_RACE" };

    let correctiveKind: "REPLACEMENT" | "CORRECTIVE" = "REPLACEMENT";
    if (intent && item) {
      const outcome = await applyStaleDeliveryDecision(deps, intent, correctiveKind, now, item.version, intent.policyVersion);
      correctiveKind = outcome.correctiveKind;
    }
    return { kind: "NOT_SENT_STALE", correctiveKind };
  }

  // Same W3-07/D-067 fence as email: the SUBMITTING claim is the real admission point for a
  // paid/external WhatsApp send - no new admission once the tenant is DELETING.
  const leaseExpiresAt = new Date(Date.parse(now) + leaseDurationMs).toISOString();
  const claim = await tryFencedSubmittingClaim(deps, attempt, { status: "SUBMITTING", leaseExpiresAt, submitStartedAt: now }, now);
  if (claim === "LOST_RACE") return { kind: "SKIPPED_LOST_LEASE_RACE" };
  if (claim === "TENANT_NOT_ACTIVE") return { kind: "SKIPPED_TENANT_NOT_ACTIVE" };

  const recipientUserId = intent?.recipientUserId;
  const to = recipientUserId ? await deps.resolveRecipientPhone({ tenantId: command.tenantId, userId: recipientUserId }) : undefined;

  if (!to || !item) {
    // No resolved/opted-in phone - conclusive terminal failure, not ambiguous.
    const nextStatus = nextWhatsAppStatusAfterSendAttempt({ kind: "FAILURE", failureKind: "CONCLUSIVE_TERMINAL" });
    await forceUpdateAttemptStatus(deps, { ...attempt, status: "SUBMITTING", version: attempt.version + 1 }, nextStatus, now);
    return { kind: "SEND_FAILED", nextStatus };
  }

  const rendered = deps.renderTemplate({ templateId: command.templateId, templateVersion: command.templateVersion, locale: command.locale, item });

  let sendResult: WhatsAppSendResult;
  try {
    sendResult = await deps.whatsAppProvider.send({
      to,
      templateName: rendered.templateName,
      templateLanguage: rendered.templateLanguage,
      templateParams: rendered.templateParams,
      tags: { attemptId: attempt.attemptId, intentId: command.intentId, tenantId: command.tenantId, correlationId: command.correlationId },
    });
  } catch (err) {
    const failureKind = err instanceof WhatsAppSendError ? err.kind : "AMBIGUOUS";
    const nextStatus = nextWhatsAppStatusAfterSendAttempt({ kind: "FAILURE", failureKind });
    await forceUpdateAttemptStatus(deps, { ...attempt, status: "SUBMITTING", version: attempt.version + 1 }, nextStatus, now);
    return { kind: "SEND_FAILED", nextStatus };
  }

  const nextStatus = nextWhatsAppStatusAfterSendAttempt({ kind: "ACCEPTED", providerMessageId: sendResult.providerMessageId });
  await forceUpdateAttemptStatus(deps, { ...attempt, status: "SUBMITTING", version: attempt.version + 1 }, nextStatus, now, sendResult.providerMessageId);
  return { kind: "SENT", providerMessageId: sendResult.providerMessageId };
}

async function tryConditionalUpdate(
  deps: WhatsAppDeliveryWorkflowDeps,
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

async function tryFencedSubmittingClaim(
  deps: WhatsAppDeliveryWorkflowDeps,
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

async function forceUpdateAttemptStatus(
  deps: WhatsAppDeliveryWorkflowDeps,
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
