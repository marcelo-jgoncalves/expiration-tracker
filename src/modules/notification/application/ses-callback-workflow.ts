/**
 * SesCallbackWorker composition-root logic (M4). Takes an already-normalized SES/SNS
 * callback event (the Lambda handler's job is parsing the raw SNS/SES JSON into this
 * shape - kept separate so this workflow stays testable without SES-specific parsing
 * mixed in), correlates it to a NotificationAttempt via the SAME tenant-scoped lookup
 * pointer email-delivery-workflow.ts uses, and applies the monotonic transition from
 * ses-callback-processor.ts.
 *
 * Tags-first correlation (docs/architecture/m4-notification-engine-design.md fechamento
 * #2): if the tags (attemptId/intentId/tenantId) are missing or don't resolve to a real,
 * matching attempt, the event is marked UNMATCHED and alarmed - NEVER a cross-tenant
 * Query/scan. There is deliberately no GSI5 fallback path implemented yet (round3-fixes.md
 * item 2 leaves this open pending the sandbox tag-survival spike); once that spike
 * confirms tags survive in real SES events (as expected), this is the only correlation
 * path needed. If it doesn't, GSI5 fallback is a follow-up, not a silent gap - UNMATCHED
 * is always a safe, auditable default in the meantime.
 */
import type { NotificationIntent } from "../../reminder/domain/notification-intent.js";
import {
  notificationAttemptLookupKey,
  type NotificationAttempt,
  type NotificationAttemptLookup,
  type NotificationAttemptStatus,
} from "../domain/notification-attempt.js";
import { notificationPreferencesKey, type NotificationPreferences } from "../domain/notification-preferences.js";
import type { NotificationStore } from "../ports/notification-store.js";
import { isTransactionCanceled, isConditionalCheckFailed } from "../../../shared/dynamodb/occ.js";
import { buildVersionedUpdate } from "../../../shared/dynamodb/occ.js";
import { decideCallbackApplication, complaintRequiresSuppression, type SesCallbackEventKind } from "./ses-callback-processor.js";
import { deriveWebhookInboxMaintenanceDue, transientPurgeGsi8Keys } from "../../../shared/transient-purge-gsi8.js";

export interface ParsedSesCallbackEvent {
  snsMessageId: string;
  eventKind: SesCallbackEventKind;
  providerMessageId: string;
  tags: { attemptId?: string; intentId?: string; tenantId?: string };
  occurredAt: string;
}

export interface SesCallbackWorkflowDeps {
  store: NotificationStore;
  tableName: string;
  providerAccountId: string;
  now: () => string;
}

export type SesCallbackOutcome =
  | { kind: "DUPLICATE_INBOX" } // this exact SNS message was already processed
  | { kind: "UNMATCHED" } // missing/invalid tags, no safe correlation - alarmed upstream, never a global scan
  | { kind: "NO_OP_PRECEDENCE" } // correlated fine, but a higher-precedence status already applied
  | { kind: "APPLIED"; nextStatus: NotificationAttemptStatus; suppressed: boolean };

/** Tenant-scoped inbox key (data-model.md-style WebhookInbox row) - the idempotency
 * boundary for a specific SNS delivery of this SES event, keyed only once tenantId is
 * known from the tags (never a pre-tenant global inbox). */
function webhookInboxKey(tenantId: string, providerAccountId: string, snsMessageId: string) {
  return { PK: `TENANT#${tenantId}#WEBHOOK#SES#${providerAccountId}`, SK: `EVENT#${snsMessageId}` };
}

export async function processSesCallback(deps: SesCallbackWorkflowDeps, event: ParsedSesCallbackEvent): Promise<SesCallbackOutcome> {
  const { attemptId, intentId, tenantId } = event.tags;
  if (!attemptId || !intentId || !tenantId) {
    return { kind: "UNMATCHED" };
  }

  const now = deps.now();
  const inboxKey = webhookInboxKey(tenantId, deps.providerAccountId, event.snsMessageId);
  // D-179/D-188 (transient-purge, 7th GSI8 slice): WebhookInbox is create-once/immutable (never
  // updated after this Put) - the GSI8 pointer is written exactly once, here, at creation, same
  // shape as the append-only AuditEvent family (D-187/security-audit-purge).
  const due = deriveWebhookInboxMaintenanceDue({ createdAt: now });
  const gsi8 = transientPurgeGsi8Keys({ dueAtIso: due.dueAtIso, tenantId, entityType: "WebhookInbox", sk: inboxKey.SK });
  const inboxCreated = await deps.store.putIfAbsent({
    ...inboxKey,
    entityType: "WebhookInbox",
    tenantId,
    provider: "SES",
    providerAccountId: deps.providerAccountId,
    providerEventId: event.snsMessageId,
    providerMessageId: event.providerMessageId,
    eventKind: event.eventKind,
    attemptId,
    intentId,
    occurredAt: event.occurredAt,
    processingStatus: "PROCESSING",
    version: 1,
    createdAt: now,
    ...gsi8,
  });
  if (!inboxCreated) {
    return { kind: "DUPLICATE_INBOX" };
  }

  const lookup = await deps.store.get<NotificationAttemptLookup>(notificationAttemptLookupKey(tenantId, attemptId), true);
  if (!lookup || lookup.intentId !== intentId || lookup.tenantId !== tenantId || lookup.providerAccountId !== deps.providerAccountId) {
    await markInboxUnmatched(deps, inboxKey, now);
    return { kind: "UNMATCHED" };
  }

  const intentPk = `TENANT#${tenantId}#INTENT#${intentId}`;
  const attempt = await deps.store.get<NotificationAttempt>({ PK: intentPk, SK: lookup.attemptSk }, true);
  if (!attempt || attempt.tenantId !== tenantId) {
    await markInboxUnmatched(deps, inboxKey, now);
    return { kind: "UNMATCHED" };
  }

  const application = decideCallbackApplication(attempt.status, event.eventKind);
  if (!application.apply) {
    await markInboxProcessed(deps, inboxKey, now);
    return { kind: "NO_OP_PRECEDENCE" };
  }

  const suppress = complaintRequiresSuppression(event.eventKind);
  const intent = suppress ? await deps.store.get<NotificationIntent>({ PK: intentPk, SK: "META" }, true) : undefined;

  try {
    await deps.store.transactWrite([
      {
        Update: buildVersionedUpdate({
          tableName: deps.tableName,
          key: { PK: attempt.PK, SK: attempt.SK },
          tenantId,
          expectedVersion: attempt.version,
          now,
          set: { status: application.nextStatus, providerMessageId: event.providerMessageId, lastProviderEventAt: event.occurredAt },
        }),
      },
    ]);
  } catch (err) {
    if (!isTransactionCanceled(err) && !isConditionalCheckFailed(err)) throw err;
    // Lost a race against another (higher-precedence) callback applying concurrently - not
    // a failure, the winning transition already reflects the correct monotonic state.
  }

  let suppressed = false;
  if (suppress && intent?.recipientUserId) {
    suppressed = await suppressEmailForRecipient(deps, tenantId, intent.recipientUserId, now);
  }

  await markInboxProcessed(deps, inboxKey, now);
  return { kind: "APPLIED", nextStatus: application.nextStatus, suppressed };
}

async function markInboxProcessed(deps: SesCallbackWorkflowDeps, key: { PK: string; SK: string }, now: string): Promise<void> {
  const inbox = await deps.store.get<Record<string, unknown> & { PK: string; SK: string; version: number }>(key);
  if (!inbox) return;
  try {
    await deps.store.transactWrite([
      { Update: buildVersionedUpdate({ tableName: deps.tableName, key, tenantId: inbox["tenantId"] as string, expectedVersion: inbox.version, now, set: { processingStatus: "PROCESSED" } }) },
    ]);
  } catch (err) {
    if (!isTransactionCanceled(err) && !isConditionalCheckFailed(err)) throw err;
  }
}

async function markInboxUnmatched(deps: SesCallbackWorkflowDeps, key: { PK: string; SK: string }, now: string): Promise<void> {
  const inbox = await deps.store.get<Record<string, unknown> & { PK: string; SK: string; version: number }>(key);
  if (!inbox) return;
  try {
    await deps.store.transactWrite([
      { Update: buildVersionedUpdate({ tableName: deps.tableName, key, tenantId: inbox["tenantId"] as string, expectedVersion: inbox.version, now, set: { processingStatus: "UNMATCHED" } }) },
    ]);
  } catch (err) {
    if (!isTransactionCanceled(err) && !isConditionalCheckFailed(err)) throw err;
  }
}

/** Complaint suppression policy (round1-decisions-resolved.md §3): permanent, automatic,
 * no manual review gate for the initial block. Best-effort OCC update against the
 * recipient's existing NotificationPreferences - if the record doesn't exist yet, there's
 * nothing to suppress against (the router's own opt-in-default onboarding invariant means
 * this should be rare); logged upstream, not treated as a workflow failure. */
async function suppressEmailForRecipient(deps: SesCallbackWorkflowDeps, tenantId: string, userId: string, now: string): Promise<boolean> {
  const key = notificationPreferencesKey(tenantId, userId);
  const preferences = await deps.store.get<NotificationPreferences>(key);
  if (!preferences) return false;
  if (!preferences.emailEnabled) return true; // already suppressed
  try {
    await deps.store.transactWrite([
      { Update: buildVersionedUpdate({ tableName: deps.tableName, key, tenantId, expectedVersion: preferences.version, now, set: { emailEnabled: false } }) },
    ]);
    return true;
  } catch (err) {
    if (isTransactionCanceled(err) || isConditionalCheckFailed(err)) return false;
    throw err;
  }
}
