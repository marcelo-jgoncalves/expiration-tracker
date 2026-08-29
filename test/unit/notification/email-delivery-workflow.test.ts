import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryNotificationStore } from "./in-memory-store.js";
import { processEmailDelivery, type EmailDeliverCommandData, type EmailDeliveryWorkflowDeps } from "../../../src/modules/notification/application/email-delivery-workflow.js";
import { itemKey, type ExpirationItem } from "../../../src/modules/expiration/domain/expiration-item.js";
import type { NotificationIntent } from "../../../src/modules/reminder/domain/notification-intent.js";
import { notificationAttemptKey, buildNotificationAttemptLookup, type NotificationAttempt } from "../../../src/modules/notification/domain/notification-attempt.js";
import type { EmailProviderAdapter } from "../../../src/modules/notification/ports/email-provider.js";
import { EmailSendError } from "../../../src/modules/notification/ports/email-provider.js";
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

function makeCommand(overrides: Partial<EmailDeliverCommandData> = {}): EmailDeliverCommandData {
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

describe("processEmailDelivery", () => {
  let store: InMemoryNotificationStore;
  let deps: EmailDeliveryWorkflowDeps;
  let sendCalls: unknown[];
  let sendImpl: EmailProviderAdapter["send"];

  beforeEach(() => {
    store = new InMemoryNotificationStore();
    sendCalls = [];
    sendImpl = async (input) => {
      sendCalls.push(input);
      return { providerMessageId: "ses-msg-1" };
    };
    deps = {
      store,
      tableName: "MainTable",
      emailProvider: { send: (input) => sendImpl(input) },
      resolveRecipientEmail: async () => "user1@example.com",
      renderTemplate: () => ({ itemDisplayName: "Passport" }),
      now: () => NOW,
      newIntentId: () => "newintent-1",
    };
  });

  /** W3-07 (D-067): the SUBMITTING claim now fences through TenantBusinessMutation, which
   * requires a TenantLifecycleRecord to exist for the tenant - same convention
   * quota.test.ts/item-watch-service.test.ts already established. Defaults every existing test
   * below to ACTIVE so pre-existing send-path behavior is unchanged; `seed({ lifecycleStatus })`
   * lets the new adversarial tests seed DELETING instead. */
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

  it("happy path: sends the e-mail, attempt ends ACCEPTED with providerMessageId", async () => {
    await seed({});
    const outcome = await processEmailDelivery(deps, makeCommand());
    expect(outcome).toEqual({ kind: "SENT", providerMessageId: "ses-msg-1" });
    expect(sendCalls).toHaveLength(1);

    const attempt = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, INTENT_ID, 1, ATTEMPT_ID));
    expect(attempt?.status).toBe("ACCEPTED");
    expect(attempt?.providerMessageId).toBe("ses-msg-1");
  });

  it("deliverNotBefore not reached yet -> DEFERRED, no send, attempt untouched", async () => {
    await seed({});
    const outcome = await processEmailDelivery(deps, makeCommand({ deliverNotBefore: "2026-09-10T13:00:00.000Z" }));
    expect(outcome).toEqual({ kind: "DEFERRED" });
    expect(sendCalls).toHaveLength(0);
  });

  it("lookup pointer missing -> SKIPPED_NO_ATTEMPT, never crashes the batch", async () => {
    await seed({});
    const outcome = await processEmailDelivery(deps, makeCommand({ attemptId: "does-not-exist" }));
    expect(outcome).toEqual({ kind: "SKIPPED_NO_ATTEMPT" });
  });

  it("attempt already ACCEPTED (duplicate SQS delivery) -> SKIPPED_RESOLVED, never calls SES twice", async () => {
    await seed({ attempt: makeAttempt({ status: "ACCEPTED", providerMessageId: "already-sent" }) });
    const outcome = await processEmailDelivery(deps, makeCommand());
    expect(outcome).toEqual({ kind: "SKIPPED_RESOLVED" });
    expect(sendCalls).toHaveLength(0);
  });

  it("attempt SUBMITTING with an active lease (concurrent duplicate in flight) -> SKIPPED_IN_PROGRESS, never calls SES twice", async () => {
    await seed({ attempt: makeAttempt({ status: "SUBMITTING", leaseExpiresAt: "2026-09-10T12:10:00.000Z" }) });
    const outcome = await processEmailDelivery(deps, makeCommand());
    expect(outcome).toEqual({ kind: "SKIPPED_IN_PROGRESS" });
    expect(sendCalls).toHaveLength(0);
  });

  it("attempt SUBMITTING with an expired lease -> RECONCILED_UNKNOWN, never resends blindly", async () => {
    await seed({ attempt: makeAttempt({ status: "SUBMITTING", leaseExpiresAt: "2026-09-10T11:00:00.000Z" }) });
    const outcome = await processEmailDelivery(deps, makeCommand());
    expect(outcome).toEqual({ kind: "RECONCILED_UNKNOWN" });
    expect(sendCalls).toHaveLength(0);
    const attempt = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, INTENT_ID, 1, ATTEMPT_ID));
    expect(attempt?.status).toBe("UNKNOWN");
  });

  it("item version changed since intent was routed -> NOT_SENT_STALE REPLACEMENT, no SES call, creates a new intent", async () => {
    await seed({ item: makeItem({ version: 4 }) }); // command still says expectedItemVersion: 3
    const outcome = await processEmailDelivery(deps, makeCommand());
    expect(outcome).toEqual({ kind: "NOT_SENT_STALE", correctiveKind: "REPLACEMENT" });
    expect(sendCalls).toHaveLength(0);

    const attempt = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, INTENT_ID, 1, ATTEMPT_ID));
    expect(attempt?.status).toBe("NOT_SENT_STALE");

    const all = store.allItems();
    const newIntent = all.find((i) => i["entityType"] === "NotificationIntent" && i["intentId"] === "newintent-1");
    expect(newIntent).toBeDefined();
    expect((newIntent as unknown as NotificationIntent).kind).toBe("REPLACEMENT");
    expect((newIntent as unknown as NotificationIntent).itemVersion).toBe(4);
  });

  it("SES rejects conclusively (terminal) -> attempt FAILED_TERMINAL, not retried automatically", async () => {
    sendImpl = async () => {
      throw new EmailSendError("invalid recipient", "CONCLUSIVE_TERMINAL");
    };
    await seed({});
    const outcome = await processEmailDelivery(deps, makeCommand());
    expect(outcome).toEqual({ kind: "SEND_FAILED", nextStatus: "FAILED_TERMINAL" });
    const attempt = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, INTENT_ID, 1, ATTEMPT_ID));
    expect(attempt?.status).toBe("FAILED_TERMINAL");
  });

  it("SES call times out ambiguously (may have been accepted) -> attempt UNKNOWN, never FAILED_RETRYABLE", async () => {
    sendImpl = async () => {
      throw new Error("socket timeout");
    };
    await seed({});
    const outcome = await processEmailDelivery(deps, makeCommand());
    expect(outcome).toEqual({ kind: "SEND_FAILED", nextStatus: "UNKNOWN" });
    const attempt = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, INTENT_ID, 1, ATTEMPT_ID));
    expect(attempt?.status).toBe("UNKNOWN");
  });

  it("recipient e-mail cannot be resolved -> conclusive terminal failure, no SES call attempted", async () => {
    deps.resolveRecipientEmail = async () => undefined;
    await seed({});
    const outcome = await processEmailDelivery(deps, makeCommand());
    expect(outcome).toEqual({ kind: "SEND_FAILED", nextStatus: "FAILED_TERMINAL" });
    expect(sendCalls).toHaveLength(0);
  });

  describe("W3-07 tenant deletion fence (D-067) - SUBMITTING claim admission", () => {
    it("ACTIVE control case: SUBMITTING claim is admitted and the (mocked) SES send completes normally", async () => {
      await seed({ lifecycleStatus: "ACTIVE" });
      const outcome = await processEmailDelivery(deps, makeCommand());
      expect(outcome).toEqual({ kind: "SENT", providerMessageId: "ses-msg-1" });
      expect(sendCalls).toHaveLength(1);
      const attempt = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, INTENT_ID, 1, ATTEMPT_ID));
      expect(attempt?.status).toBe("ACCEPTED");
    });

    it("DELETING: SUBMITTING claim is rejected atomically before any SES send is attempted", async () => {
      await seed({ lifecycleStatus: "DELETING" });
      const outcome = await processEmailDelivery(deps, makeCommand());
      expect(outcome).toEqual({ kind: "SKIPPED_TENANT_NOT_ACTIVE" });
      expect(sendCalls).toHaveLength(0);

      // No partial write - the attempt is untouched (still PREPARED at its original version),
      // proving the fence rejected the whole TransactWriteItems atomically, not just skipped
      // the send after a successful claim.
      const attempt = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, INTENT_ID, 1, ATTEMPT_ID));
      expect(attempt?.status).toBe("PREPARED");
      expect(attempt?.version).toBe(1);
    });

    it("admission while ACTIVE lets the send complete even though the tenant is DELETING by the time SES is called", async () => {
      // Simulates D-067's "already-admitted sends may complete" contract: the claim's own
      // TransactWriteItems observes ACTIVE and commits, but the tenant transitions to DELETING
      // in the (mocked) gap between the claim committing and the SES call actually firing -
      // the send must still be attempted and allowed to resolve normally, no retroactive cancel.
      await seed({ lifecycleStatus: "ACTIVE" });
      const lifecycle = await store.get<{ PK: string; SK: string; version: number }>(tenantLifecycleKey(TENANT));
      sendImpl = async (input) => {
        // Flip the tenant to DELETING right before the "external" SES call resolves - this must
        // NOT retroactively block or unwind the already-claimed SUBMITTING admission.
        await store.update({
          ...tenantLifecycleKey(TENANT),
          entityType: "TenantLifecycleRecord",
          tenantId: TENANT,
          status: "DELETING",
          createdAt: NOW,
          updatedAt: NOW,
          version: (lifecycle?.version ?? 1) + 1,
        });
        sendCalls.push(input);
        return { providerMessageId: "ses-msg-1" };
      };
      const outcome = await processEmailDelivery(deps, makeCommand());
      expect(outcome).toEqual({ kind: "SENT", providerMessageId: "ses-msg-1" });
      expect(sendCalls).toHaveLength(1);
      const attempt = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, INTENT_ID, 1, ATTEMPT_ID));
      expect(attempt?.status).toBe("ACCEPTED");
    });
  });
});
