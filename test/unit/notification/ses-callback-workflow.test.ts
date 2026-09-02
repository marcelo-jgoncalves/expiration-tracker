import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryNotificationStore } from "./in-memory-store.js";
import { processSesCallback, type ParsedSesCallbackEvent, type SesCallbackWorkflowDeps } from "../../../src/modules/notification/application/ses-callback-workflow.js";
import { notificationAttemptKey, buildNotificationAttemptLookup, type NotificationAttempt } from "../../../src/modules/notification/domain/notification-attempt.js";
import { notificationPreferencesKey, type NotificationPreferences } from "../../../src/modules/notification/domain/notification-preferences.js";
import type { NotificationIntent } from "../../../src/modules/reminder/domain/notification-intent.js";

const TENANT = "t1";
const INTENT_ID = "intent1";
const ATTEMPT_ID = "attempt1";
const ACCOUNT = "default";
const NOW = "2026-09-10T12:05:00.000Z";

function makeAttempt(overrides: Partial<NotificationAttempt> = {}): NotificationAttempt {
  return {
    ...notificationAttemptKey(TENANT, INTENT_ID, 1, ATTEMPT_ID),
    entityType: "NotificationAttempt",
    tenantId: TENANT,
    intentId: INTENT_ID,
    attemptId: ATTEMPT_ID,
    attemptNumber: 1,
    redriveGeneration: 0,
    channel: "EMAIL",
    provider: "SES",
    providerAccountId: ACCOUNT,
    status: "ACCEPTED",
    expectedItemVersion: 3,
    commandMessageId: ATTEMPT_ID,
    destinationHash: "",
    templateId: "expiration-reminder",
    templateVersion: 1,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeIntent(overrides: Partial<NotificationIntent> = {}): NotificationIntent {
  return {
    PK: `TENANT#${TENANT}#INTENT#${INTENT_ID}`,
    SK: "META",
    entityType: "NotificationIntent",
    intentId: INTENT_ID,
    tenantId: TENANT,
    kind: "EXPIRATION_REMINDER",
    itemId: "item1",
    occurrenceId: "occ1",
    itemVersion: 3,
    policyId: "policy1",
    policyVersion: 1,
    scheduledAt: NOW,
    requestedChannels: ["EMAIL"],
    status: "DISPATCHED",
    supersedesIntentId: null,
    correctionReason: null,
    recipientUserId: "user1",
    version: 2,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<ParsedSesCallbackEvent> = {}): ParsedSesCallbackEvent {
  return {
    snsMessageId: "sns-1",
    eventKind: "DELIVERY",
    providerMessageId: "ses-msg-1",
    tags: { attemptId: ATTEMPT_ID, intentId: INTENT_ID, tenantId: TENANT },
    occurredAt: NOW,
    ...overrides,
  };
}

describe("processSesCallback", () => {
  let store: InMemoryNotificationStore;
  let deps: SesCallbackWorkflowDeps;

  beforeEach(() => {
    store = new InMemoryNotificationStore();
    deps = { store, tableName: "MainTable", providerAccountId: ACCOUNT, now: () => NOW };
  });

  async function seed(attempt = makeAttempt()) {
    await store.putIfAbsent(attempt);
    await store.putIfAbsent(buildNotificationAttemptLookup(attempt));
  }

  it("DELIVERY applies: attempt transitions ACCEPTED -> DELIVERED", async () => {
    await seed(makeAttempt({ status: "ACCEPTED" }));
    const outcome = await processSesCallback(deps, makeEvent({ eventKind: "DELIVERY" }));
    expect(outcome).toEqual({ kind: "APPLIED", nextStatus: "DELIVERED", suppressed: false });
    const attempt = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, INTENT_ID, 1, ATTEMPT_ID));
    expect(attempt?.status).toBe("DELIVERED");
  });

  it("D-179/D-188 (transient-purge, 7th GSI8 slice): the WebhookInbox row is stamped with a GSI8 pointer exactly once, at creation", async () => {
    await seed(makeAttempt({ status: "ACCEPTED" }));
    await processSesCallback(deps, makeEvent({ eventKind: "DELIVERY" }));
    const inbox = await store.get<Record<string, unknown> & { PK: string; SK: string }>({ PK: `TENANT#${TENANT}#WEBHOOK#SES#${ACCOUNT}`, SK: "EVENT#sns-1" });
    expect(inbox).toBeDefined();
    expect(inbox?.["GSI8PK"]).toBe("WORK#TRANSIENT");
    // createdAt = NOW ("2026-09-10T12:05:00.000Z") + 7 days.
    expect(inbox?.["GSI8SK"]).toBe("2026-09-17T12:05:00.000Z#TENANT#t1#WebhookInbox#EVENT#sns-1");
  });

  it("duplicate SNS delivery of the exact same event -> DUPLICATE_INBOX, no double-apply", async () => {
    await seed(makeAttempt({ status: "ACCEPTED" }));
    const event = makeEvent({ eventKind: "DELIVERY" });
    const first = await processSesCallback(deps, event);
    expect(first.kind).toBe("APPLIED");
    const second = await processSesCallback(deps, event);
    expect(second).toEqual({ kind: "DUPLICATE_INBOX" });
  });

  it("missing tags -> UNMATCHED, never a global scan", async () => {
    await seed();
    const outcome = await processSesCallback(deps, makeEvent({ tags: {} }));
    expect(outcome).toEqual({ kind: "UNMATCHED" });
  });

  it("tags reference a tenant/attempt with no matching lookup pointer -> UNMATCHED", async () => {
    await seed();
    const outcome = await processSesCallback(deps, makeEvent({ tags: { attemptId: "ghost", intentId: INTENT_ID, tenantId: TENANT } }));
    expect(outcome).toEqual({ kind: "UNMATCHED" });
  });

  it("out-of-order callback (lower precedence than current status) -> NO_OP_PRECEDENCE, attempt untouched", async () => {
    await seed(makeAttempt({ status: "BOUNCED" }));
    const outcome = await processSesCallback(deps, makeEvent({ eventKind: "DELIVERY" }));
    expect(outcome).toEqual({ kind: "NO_OP_PRECEDENCE" });
    const attempt = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, INTENT_ID, 1, ATTEMPT_ID));
    expect(attempt?.status).toBe("BOUNCED");
  });

  it("COMPLAINT applies and suppresses the recipient's e-mail preference automatically and permanently", async () => {
    await seed(makeAttempt({ status: "DELIVERED" }));
    await store.putIfAbsent(makeIntent());
    const preferences: NotificationPreferences = {
      ...notificationPreferencesKey(TENANT, "user1"),
      entityType: "NotificationPreferences",
      tenantId: TENANT,
      userId: "user1",
      emailEnabled: true,
      locale: "pt-BR",
      quietHours: null,
      consentSource: "ONBOARDING",
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    };
    await store.putIfAbsent(preferences);

    const outcome = await processSesCallback(deps, makeEvent({ eventKind: "COMPLAINT" }));
    expect(outcome).toEqual({ kind: "APPLIED", nextStatus: "COMPLAINED", suppressed: true });

    const updatedPreferences = await store.get<NotificationPreferences>(notificationPreferencesKey(TENANT, "user1"));
    expect(updatedPreferences?.emailEnabled).toBe(false);
  });

  it("BOUNCE does not suppress (only COMPLAINT does)", async () => {
    await seed(makeAttempt({ status: "ACCEPTED" }));
    await store.putIfAbsent(makeIntent());
    const outcome = await processSesCallback(deps, makeEvent({ eventKind: "BOUNCE" }));
    expect(outcome).toEqual({ kind: "APPLIED", nextStatus: "BOUNCED", suppressed: false });
  });

  it("callback arrives while attempt is still SUBMITTING (beat local MessageId persistence) -> still applies", async () => {
    await seed(makeAttempt({ status: "SUBMITTING" }));
    const outcome = await processSesCallback(deps, makeEvent({ eventKind: "DELIVERY" }));
    expect(outcome).toEqual({ kind: "APPLIED", nextStatus: "DELIVERED", suppressed: false });
  });
});
