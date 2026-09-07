import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryNotificationStore } from "./in-memory-store.js";
import {
  processWhatsAppDelivery,
  type WhatsAppDeliverCommandData,
  type WhatsAppDeliveryWorkflowDeps,
} from "../../../src/modules/notification/application/whatsapp-delivery-workflow.js";
import { itemKey, type ExpirationItem } from "../../../src/modules/expiration/domain/expiration-item.js";
import type { NotificationIntent } from "../../../src/modules/reminder/domain/notification-intent.js";
import { notificationAttemptKey, buildNotificationAttemptLookup, type NotificationAttempt } from "../../../src/modules/notification/domain/notification-attempt.js";
import type { WhatsAppProviderAdapter } from "../../../src/modules/notification/ports/whatsapp-provider.js";
import { WhatsAppSendError } from "../../../src/modules/notification/ports/whatsapp-provider.js";
import { tenantLifecycleKey } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";

const TENANT = "t1";
const ITEM_ID = "item1";
const INTENT_ID = "intent1";
const ATTEMPT_ID = "attempt1";
const NOW = "2026-09-10T12:00:00.000Z";

function makeItem(overrides: Partial<ExpirationItem> = {}): ExpirationItem {
  return {
    ...itemKey(TENANT, ITEM_ID),
    entityType: "ExpirationItem",
    itemId: ITEM_ID,
    tenantId: TENANT,
    name: "Passport",
    category: "document",
    categoryNormalized: "document",
    dueDate: "2026-12-01",
    tags: [],
    status: "ACTIVE",
    createdAt: NOW,
    updatedAt: NOW,
    version: 3,
    GSI1PK: `TENANT#${TENANT}#DASHBOARD`,
    GSI1SK: "2026-12-01",
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
    itemId: ITEM_ID,
    occurrenceId: "occ1",
    itemVersion: 3,
    policyId: "policy1",
    policyVersion: 1,
    scheduledAt: NOW,
    requestedChannels: ["WHATSAPP"],
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

function makeAttempt(overrides: Partial<NotificationAttempt> = {}): NotificationAttempt {
  return {
    ...notificationAttemptKey(TENANT, INTENT_ID, 1, ATTEMPT_ID),
    entityType: "NotificationAttempt",
    tenantId: TENANT,
    intentId: INTENT_ID,
    attemptId: ATTEMPT_ID,
    attemptNumber: 1,
    redriveGeneration: 0,
    channel: "WHATSAPP",
    provider: "META_CLOUD_API",
    providerAccountId: "default",
    status: "PREPARED",
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

function makeCommand(overrides: Partial<WhatsAppDeliverCommandData> = {}): WhatsAppDeliverCommandData {
  return {
    tenantId: TENANT,
    intentId: INTENT_ID,
    attemptId: ATTEMPT_ID,
    itemId: ITEM_ID,
    expectedItemVersion: 3,
    templateId: "expiration-reminder",
    templateVersion: 1,
    locale: "pt-BR",
    deliverNotBefore: NOW,
    correlationId: "cor-1",
    ...overrides,
  };
}

describe("processWhatsAppDelivery", () => {
  let store: InMemoryNotificationStore;
  let deps: WhatsAppDeliveryWorkflowDeps;
  let sendCalls: unknown[];
  let sendImpl: WhatsAppProviderAdapter["send"];

  beforeEach(() => {
    store = new InMemoryNotificationStore();
    sendCalls = [];
    sendImpl = async (input) => {
      sendCalls.push(input);
      return { providerMessageId: "wamid.123" };
    };
    deps = {
      store,
      tableName: "MainTable",
      whatsAppProvider: { send: (input) => sendImpl(input) },
      resolveRecipientPhone: async () => "+15551234567",
      renderTemplate: () => ({ templateName: "expiration_reminder", templateLanguage: "pt_BR", templateParams: ["Passport", "2026-12-01"] }),
      now: () => NOW,
      newIntentId: () => "newintent-1",
    };
  });

  async function seed(input: {
    item?: ExpirationItem;
    intent?: NotificationIntent;
    attempt?: NotificationAttempt;
    lifecycleStatus?: "ACTIVE" | "DELETING";
  }) {
    const item = input.item ?? makeItem();
    const intent = input.intent ?? makeIntent();
    const attempt = input.attempt ?? makeAttempt();
    await store.putIfAbsent(item);
    await store.putIfAbsent(intent);
    await store.putIfAbsent(attempt);
    await store.putIfAbsent(buildNotificationAttemptLookup(attempt));
    await store.putIfAbsent({
      ...tenantLifecycleKey(TENANT),
      entityType: "TenantLifecycleRecord",
      tenantId: TENANT,
      status: input.lifecycleStatus ?? "ACTIVE",
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    });
  }

  it("happy path: sends the WhatsApp template message, attempt ends ACCEPTED with providerMessageId", async () => {
    await seed({});
    const outcome = await processWhatsAppDelivery(deps, makeCommand());
    expect(outcome).toEqual({ kind: "SENT", providerMessageId: "wamid.123" });
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]).toMatchObject({ to: "+15551234567", templateName: "expiration_reminder", templateLanguage: "pt_BR" });

    const attempt = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, INTENT_ID, 1, ATTEMPT_ID));
    expect(attempt?.status).toBe("ACCEPTED");
    expect(attempt?.providerMessageId).toBe("wamid.123");
  });

  it("deliverNotBefore not reached yet -> DEFERRED, no send, attempt untouched", async () => {
    await seed({});
    const outcome = await processWhatsAppDelivery(deps, makeCommand({ deliverNotBefore: "2026-09-10T13:00:00.000Z" }));
    expect(outcome).toEqual({ kind: "DEFERRED" });
    expect(sendCalls).toHaveLength(0);
  });

  it("lookup pointer missing -> SKIPPED_NO_ATTEMPT, never crashes the batch", async () => {
    await seed({});
    const outcome = await processWhatsAppDelivery(deps, makeCommand({ attemptId: "does-not-exist" }));
    expect(outcome).toEqual({ kind: "SKIPPED_NO_ATTEMPT" });
  });

  it("attempt already ACCEPTED (duplicate SQS delivery) -> SKIPPED_RESOLVED, never calls the Cloud API twice", async () => {
    await seed({ attempt: makeAttempt({ status: "ACCEPTED", providerMessageId: "already-sent" }) });
    const outcome = await processWhatsAppDelivery(deps, makeCommand());
    expect(outcome).toEqual({ kind: "SKIPPED_RESOLVED" });
    expect(sendCalls).toHaveLength(0);
  });

  it("attempt SUBMITTING with an active lease (concurrent duplicate in flight) -> SKIPPED_IN_PROGRESS, never calls the Cloud API twice", async () => {
    await seed({ attempt: makeAttempt({ status: "SUBMITTING", leaseExpiresAt: "2026-09-10T12:10:00.000Z" }) });
    const outcome = await processWhatsAppDelivery(deps, makeCommand());
    expect(outcome).toEqual({ kind: "SKIPPED_IN_PROGRESS" });
    expect(sendCalls).toHaveLength(0);
  });

  it("attempt SUBMITTING with an expired lease -> RECONCILED_UNKNOWN, never resends blindly", async () => {
    await seed({ attempt: makeAttempt({ status: "SUBMITTING", leaseExpiresAt: "2026-09-10T11:00:00.000Z" }) });
    const outcome = await processWhatsAppDelivery(deps, makeCommand());
    expect(outcome).toEqual({ kind: "RECONCILED_UNKNOWN" });
    expect(sendCalls).toHaveLength(0);
    const attempt = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, INTENT_ID, 1, ATTEMPT_ID));
    expect(attempt?.status).toBe("UNKNOWN");
  });

  it("item version changed since intent was routed -> NOT_SENT_STALE REPLACEMENT, no Cloud API call, creates a new intent", async () => {
    await seed({ item: makeItem({ version: 4 }) });
    const outcome = await processWhatsAppDelivery(deps, makeCommand());
    expect(outcome).toEqual({ kind: "NOT_SENT_STALE", correctiveKind: "REPLACEMENT" });
    expect(sendCalls).toHaveLength(0);

    const attempt = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, INTENT_ID, 1, ATTEMPT_ID));
    expect(attempt?.status).toBe("NOT_SENT_STALE");

    const all = store.allItems();
    const newIntent = all.find((i) => i["entityType"] === "NotificationIntent" && i["intentId"] === "newintent-1");
    expect(newIntent).toBeDefined();
  });

  it("Cloud API rejects conclusively (terminal) -> attempt FAILED_TERMINAL, not retried automatically", async () => {
    sendImpl = async () => {
      throw new WhatsAppSendError("invalid recipient", "CONCLUSIVE_TERMINAL");
    };
    await seed({});
    const outcome = await processWhatsAppDelivery(deps, makeCommand());
    expect(outcome).toEqual({ kind: "SEND_FAILED", nextStatus: "FAILED_TERMINAL" });
    const attempt = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, INTENT_ID, 1, ATTEMPT_ID));
    expect(attempt?.status).toBe("FAILED_TERMINAL");
  });

  it("Cloud API call fails ambiguously (network error, may have been accepted) -> attempt UNKNOWN, never FAILED_RETRYABLE", async () => {
    sendImpl = async () => {
      throw new Error("socket timeout");
    };
    await seed({});
    const outcome = await processWhatsAppDelivery(deps, makeCommand());
    expect(outcome).toEqual({ kind: "SEND_FAILED", nextStatus: "UNKNOWN" });
    const attempt = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, INTENT_ID, 1, ATTEMPT_ID));
    expect(attempt?.status).toBe("UNKNOWN");
  });

  it("recipient phone cannot be resolved (no opt-in, or phone changed since opt-in) -> conclusive terminal failure, no Cloud API call attempted", async () => {
    deps.resolveRecipientPhone = async () => undefined;
    await seed({});
    const outcome = await processWhatsAppDelivery(deps, makeCommand());
    expect(outcome).toEqual({ kind: "SEND_FAILED", nextStatus: "FAILED_TERMINAL" });
    expect(sendCalls).toHaveLength(0);
  });

  describe("W3-07 tenant deletion fence (D-067) - SUBMITTING claim admission, same discipline as email", () => {
    it("ACTIVE control case: SUBMITTING claim is admitted and the (mocked) Cloud API send completes normally", async () => {
      await seed({ lifecycleStatus: "ACTIVE" });
      const outcome = await processWhatsAppDelivery(deps, makeCommand());
      expect(outcome).toEqual({ kind: "SENT", providerMessageId: "wamid.123" });
      expect(sendCalls).toHaveLength(1);
    });

    it("DELETING: SUBMITTING claim is rejected atomically before any Cloud API send is attempted", async () => {
      await seed({ lifecycleStatus: "DELETING" });
      const outcome = await processWhatsAppDelivery(deps, makeCommand());
      expect(outcome).toEqual({ kind: "SKIPPED_TENANT_NOT_ACTIVE" });
      expect(sendCalls).toHaveLength(0);

      const attempt = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, INTENT_ID, 1, ATTEMPT_ID));
      expect(attempt?.status).toBe("PREPARED");
      expect(attempt?.version).toBe(1);
    });
  });
});
