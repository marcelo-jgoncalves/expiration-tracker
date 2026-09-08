/**
 * WhatsAppWebhookHandler composition-root logic (D-197 fatia 3/5, D-7). Mirrors
 * `ses-callback-workflow.ts` field-for-field where the shape is shared (create-once inbox row,
 * correlate-then-transition, `markInboxUnmatched` reused on the SAME row) - the one structural
 * difference is `WebhookInbox` here is ACCOUNT-scoped (`PK=WEBHOOK#WHATSAPP#<wabaId>`), never
 * tenant-scoped, and stays that way permanently even after correlating a `tenantId` (see
 * `docs/architecture/reviews/whatsapp-channel-scoping/webhook-inbox-purge-scoping/
 * estado-final-consolidado.md` - 3-round Claude<->Codex protocol, both final notes >=9.0).
 *
 * Every mutation on this row uses `buildAccountScopedVersionedUpdate()` (`shared/dynamodb/
 * occ.ts`), NOT `buildVersionedUpdate()` - a second, follow-up gap found while implementing this
 * very fatia (occ.ts's only pre-existing update builder hard-required a real `tenantId` attribute
 * match, which this permanently-tenant-less entity can never have): resolved via its own 3-round
 * Claude<->Codex protocol, both final notes >=9.0 (transcript: `occ-tenant-fence-round{1,2,3}` in
 * the same reviews directory as above). The row's own `accountId` (`event.wabaId`) is the fence.
 *
 * Signature verification and raw-body/JSON parsing happen in `whatsapp-webhook-handler.ts`
 * (the Lambda entrypoint) BEFORE this workflow is ever called - by the time `processWhatsApp
 * Webhook` runs, the event is already proven authentic (D-7: "verificação ANTES de qualquer
 * processamento"). This file never re-verifies anything, it only persists+correlates.
 */
import {
  notificationAttemptLookupKey,
  type NotificationAttempt,
  type NotificationAttemptLookup,
} from "../domain/notification-attempt.js";
import type { NotificationStore } from "../ports/notification-store.js";
import { isTransactionCanceled, isConditionalCheckFailed, buildVersionedUpdate, buildAccountScopedVersionedUpdate } from "../../../shared/dynamodb/occ.js";
import { decideWhatsAppCallbackApplication, type WhatsAppStatusEvent } from "./whatsapp-webhook-processor.js";
import { deriveWebhookInboxMaintenanceDue, accountScopedTransientPurgeGsi8Keys } from "../../../shared/transient-purge-gsi8.js";

export interface WhatsAppWebhookWorkflowDeps {
  store: NotificationStore;
  tableName: string;
  now: () => string;
}

export type WhatsAppWebhookOutcome =
  | { kind: "DUPLICATE_INBOX" } // this exact wamid#statusType was already processed
  | { kind: "UNMATCHED" } // missing/invalid biz_opaque_callback_data, no safe correlation
  | { kind: "NO_OP_PRECEDENCE" } // correlated fine, but a higher-precedence status already applied
  | { kind: "APPLIED"; nextStatus: string };

/** Account-scoped `WebhookInbox` key (D-7) - NEVER `TENANT#...`, unlike SES's, because a WhatsApp
 * webhook must be identifiable and idempotency-fenced BEFORE any correlation is even attempted
 * (correlation may permanently fail, e.g. an orphaned/replayed wamid, and the row must still
 * exist and still be purgeable - see the purge-scoping decision linked above). */
function webhookInboxKey(wabaId: string, wamid: string, statusType: string) {
  return { PK: `WEBHOOK#WHATSAPP#${wabaId}`, SK: `EVENT#${wamid}#${statusType}` };
}

export async function processWhatsAppWebhook(deps: WhatsAppWebhookWorkflowDeps, event: WhatsAppStatusEvent): Promise<WhatsAppWebhookOutcome> {
  const now = deps.now();
  const inboxKey = webhookInboxKey(event.wabaId, event.wamid, event.statusType);

  const due = deriveWebhookInboxMaintenanceDue({ createdAt: now });
  const gsi8 = accountScopedTransientPurgeGsi8Keys({ dueAtIso: due.dueAtIso, accountId: event.wabaId, entityType: "WebhookInbox", sk: inboxKey.SK });
  const inboxCreated = await deps.store.putIfAbsent({
    ...inboxKey,
    entityType: "WebhookInbox",
    // D-197 fatia 3/5 purge-scoping decision: permanently ACCOUNT-scoped, correlating a
    // tenantId below is observability metadata only, never changes who purges this row.
    purgeScope: "ACCOUNT",
    // `accountId` is the OCC/scope-fence attribute every `buildAccountScopedVersionedUpdate()`
    // call below asserts against - distinct in PURPOSE from `providerAccountId` (the pre-existing
    // SES-shaped business field carrying the same value) even though both equal `event.wabaId`.
    accountId: event.wabaId,
    provider: "META_CLOUD_API",
    providerAccountId: event.wabaId,
    providerEventId: `${event.wamid}#${event.statusType}`,
    eventKind: event.statusType,
    occurredAt: event.occurredAt,
    processingStatus: "PROCESSING",
    version: 1,
    createdAt: now,
    ...gsi8,
  });
  if (!inboxCreated) {
    return { kind: "DUPLICATE_INBOX" };
  }

  const { attemptId, intentId, tenantId } = event.tags;
  if (!attemptId || !intentId || !tenantId) {
    await markInboxUnmatched(deps, inboxKey, event.wabaId, now);
    return { kind: "UNMATCHED" };
  }

  const lookup = await deps.store.get<NotificationAttemptLookup>(notificationAttemptLookupKey(tenantId, attemptId), true);
  if (!lookup || lookup.intentId !== intentId || lookup.tenantId !== tenantId) {
    await markInboxUnmatched(deps, inboxKey, event.wabaId, now);
    return { kind: "UNMATCHED" };
  }

  const intentPk = `TENANT#${tenantId}#INTENT#${intentId}`;
  const attempt = await deps.store.get<NotificationAttempt>({ PK: intentPk, SK: lookup.attemptSk }, true);
  if (!attempt || attempt.tenantId !== tenantId) {
    await markInboxUnmatched(deps, inboxKey, event.wabaId, now);
    return { kind: "UNMATCHED" };
  }

  // Correlation succeeded: attach tenantId to the inbox row as observability metadata (never
  // read by the purge worker, which always fences on accountId for this row's purgeScope).
  await annotateInboxTenant(deps, inboxKey, event.wabaId, tenantId, attemptId, intentId, now);

  const application = decideWhatsAppCallbackApplication(attempt.status, event.statusType);
  if (!application.apply) {
    await markInboxProcessed(deps, inboxKey, event.wabaId, now);
    return { kind: "NO_OP_PRECEDENCE" };
  }

  try {
    await deps.store.transactWrite([
      {
        Update: buildVersionedUpdate({
          tableName: deps.tableName,
          key: { PK: attempt.PK, SK: attempt.SK },
          tenantId,
          expectedVersion: attempt.version,
          now,
          set: { status: application.nextStatus, lastProviderEventAt: event.occurredAt },
        }),
      },
    ]);
  } catch (err) {
    if (!isTransactionCanceled(err) && !isConditionalCheckFailed(err)) throw err;
    // Lost a race against another (higher-precedence) callback applying concurrently - not a
    // failure, the winning transition already reflects the correct monotonic state.
  }

  await markInboxProcessed(deps, inboxKey, event.wabaId, now);
  return { kind: "APPLIED", nextStatus: application.nextStatus };
}

async function annotateInboxTenant(
  deps: WhatsAppWebhookWorkflowDeps,
  key: { PK: string; SK: string },
  accountId: string,
  tenantId: string,
  attemptId: string,
  intentId: string,
  now: string,
): Promise<void> {
  const inbox = await deps.store.get<Record<string, unknown> & { PK: string; SK: string; version: number }>(key);
  if (!inbox) return;
  try {
    await deps.store.transactWrite([
      {
        Update: buildAccountScopedVersionedUpdate({
          tableName: deps.tableName,
          key,
          accountId,
          expectedVersion: inbox.version,
          now,
          set: { correlatedTenantId: tenantId, attemptId, intentId },
        }),
      },
    ]);
  } catch (err) {
    if (!isTransactionCanceled(err) && !isConditionalCheckFailed(err)) throw err;
  }
}

async function markInboxProcessed(deps: WhatsAppWebhookWorkflowDeps, key: { PK: string; SK: string }, accountId: string, now: string): Promise<void> {
  const inbox = await deps.store.get<Record<string, unknown> & { PK: string; SK: string; version: number }>(key);
  if (!inbox) return;
  try {
    await deps.store.transactWrite([
      { Update: buildAccountScopedVersionedUpdate({ tableName: deps.tableName, key, accountId, expectedVersion: inbox.version, now, set: { processingStatus: "PROCESSED" } }) },
    ]);
  } catch (err) {
    if (!isTransactionCanceled(err) && !isConditionalCheckFailed(err)) throw err;
  }
}

async function markInboxUnmatched(deps: WhatsAppWebhookWorkflowDeps, key: { PK: string; SK: string }, accountId: string, now: string): Promise<void> {
  const inbox = await deps.store.get<Record<string, unknown> & { PK: string; SK: string; version: number }>(key);
  if (!inbox) return;
  try {
    await deps.store.transactWrite([
      { Update: buildAccountScopedVersionedUpdate({ tableName: deps.tableName, key, accountId, expectedVersion: inbox.version, now, set: { processingStatus: "UNMATCHED" } }) },
    ]);
  } catch (err) {
    if (!isTransactionCanceled(err) && !isConditionalCheckFailed(err)) throw err;
  }
}
