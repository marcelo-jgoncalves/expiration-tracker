import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryNotificationStore } from "./in-memory-store.js";
import { processWhatsAppDigestDelivery, type WhatsAppDigestDeliverCommand, type WhatsAppDigestDeliveryDeps } from "../../../src/workers/whatsapp-digest-delivery/delivery.js";
import { itemKey, type ExpirationItem } from "../../../src/modules/expiration/domain/expiration-item.js";
import { notificationAttemptKey, type NotificationAttempt } from "../../../src/modules/notification/domain/notification-attempt.js";
import type { WhatsAppProviderAdapter } from "../../../src/modules/notification/ports/whatsapp-provider.js";
import { WhatsAppSendError } from "../../../src/modules/notification/ports/whatsapp-provider.js";
import { authorizedTenantIdFromPersistedEntity } from "../../../src/modules/identity/domain/authorization.js";

const TENANT = "t1";
const AUTH_TENANT = authorizedTenantIdFromPersistedEntity({ tenantId: TENANT });
const RECIPIENT = "user1";
const WINDOW = "2026-09-09";
const NOW = "2026-09-10T00:30:00.000Z";
const PHONE = "+5511999999999";

function makeItem(id: string, overrides: Partial<ExpirationItem> = {}): ExpirationItem {
  return {
    ...itemKey(AUTH_TENANT, id),
    entityType: "ExpirationItem",
    itemId: id,
    tenantId: TENANT,
    name: `Item ${id}`,
    category: "document",
    categoryNormalized: "document",
    dueDate: "2026-12-01",
    tags: [],
    status: "ACTIVE",
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    GSI1PK: `TENANT#${TENANT}#DASHBOARD`,
    GSI1SK: "2026-12-01",
    ...overrides,
  };
}

function makeAttempt(intentId: string, attemptId: string, overrides: Partial<NotificationAttempt> = {}): NotificationAttempt {
  return {
    ...notificationAttemptKey(TENANT, intentId, 1, attemptId),
    entityType: "NotificationAttempt",
    tenantId: TENANT,
    intentId,
    attemptId,
    attemptNumber: 1,
    redriveGeneration: 0,
    channel: "WHATSAPP",
    provider: "META_CLOUD_API",
    providerAccountId: "default",
    status: "DIGESTED",
    expectedItemVersion: 1,
    commandMessageId: attemptId,
    destinationHash: "",
    templateId: "expiration-reminder",
    templateVersion: 1,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeCommand(overrides: Partial<WhatsAppDigestDeliverCommand> = {}): WhatsAppDigestDeliverCommand {
  return {
    tenantId: TENANT,
    recipientUserId: RECIPIENT,
    windowDate: WINDOW,
    items: [
      { intentId: "intent-1", attemptId: "attempt-1", itemId: "item-1", itemVersion: 1, addedAt: "2026-09-09T09:00:00.000Z" },
      { intentId: "intent-2", attemptId: "attempt-2", itemId: "item-2", itemVersion: 1, addedAt: "2026-09-09T10:00:00.000Z" },
    ],
    ...overrides,
  };
}

class FakeWhatsAppProvider implements WhatsAppProviderAdapter {
  sendCalls: unknown[] = [];
  result: { providerMessageId: string } | undefined = { providerMessageId: "wamid.1" };
  error: WhatsAppSendError | Error | undefined;
  async send(input: unknown) {
    this.sendCalls.push(input);
    if (this.error) throw this.error;
    return this.result!;
  }
}

describe("processWhatsAppDigestDelivery (D-347 §3.5)", () => {
  let store: InMemoryNotificationStore;
  let provider: FakeWhatsAppProvider;
  let deps: WhatsAppDigestDeliveryDeps;

  beforeEach(() => {
    store = new InMemoryNotificationStore();
    provider = new FakeWhatsAppProvider();
    deps = {
      store,
      tableName: "MainTable",
      whatsAppProvider: provider,
      resolveRecipientPhone: async () => PHONE,
      renderDigestTemplate: ({ items }) => ({ templateName: "digest", templateLanguage: "pt_BR", templateParams: [String(items.length)] }),
      now: () => NOW,
      portfolioQuotaTierLimit: 250,
    };
  });

  async function seed(items: ExpirationItem[], attempts: NotificationAttempt[]) {
    for (const item of items) await store.putIfAbsent(item);
    for (const attempt of attempts) await store.putIfAbsent(attempt);
  }

  it("sends ONE consolidated message and transitions every DIGESTED attempt to ACCEPTED", async () => {
    const command = makeCommand();
    await seed(
      [makeItem("item-1"), makeItem("item-2")],
      [makeAttempt("intent-1", "attempt-1"), makeAttempt("intent-2", "attempt-2")],
    );

    const outcome = await processWhatsAppDigestDelivery(deps, command);
    expect(outcome).toEqual({ kind: "SENT", providerMessageId: "wamid.1", itemCount: 2 });
    expect(provider.sendCalls).toHaveLength(1);

    const attempt1 = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, "intent-1", 1, "attempt-1"));
    const attempt2 = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, "intent-2", 1, "attempt-2"));
    expect(attempt1?.status).toBe("ACCEPTED");
    expect(attempt2?.status).toBe("ACCEPTED");
    expect(attempt1?.providerMessageId).toBe("wamid.1");
  });

  it("leaves out an item that is no longer ACTIVE from the rendered template, but still sends for the remaining ones", async () => {
    const command = makeCommand();
    let renderedItems: ExpirationItem[] = [];
    deps.renderDigestTemplate = (input) => {
      renderedItems = input.items;
      return { templateName: "digest", templateLanguage: "pt_BR", templateParams: [String(input.items.length)] };
    };
    await seed(
      [makeItem("item-1"), makeItem("item-2", { status: "ARCHIVED" })],
      [makeAttempt("intent-1", "attempt-1"), makeAttempt("intent-2", "attempt-2")],
    );

    const outcome = await processWhatsAppDigestDelivery(deps, command);
    expect(outcome).toEqual({ kind: "SENT", providerMessageId: "wamid.1", itemCount: 1 });
    expect(renderedItems.map((i) => i.itemId)).toEqual(["item-1"]);
  });

  it("no eligible items left (all archived) -> SKIPPED_NO_ELIGIBLE_ITEMS, attempts marked FAILED_TERMINAL, no send attempted", async () => {
    const command = makeCommand();
    await seed(
      [makeItem("item-1", { status: "ARCHIVED" }), makeItem("item-2", { status: "ARCHIVED" })],
      [makeAttempt("intent-1", "attempt-1"), makeAttempt("intent-2", "attempt-2")],
    );

    const outcome = await processWhatsAppDigestDelivery(deps, command);
    expect(outcome).toEqual({ kind: "SKIPPED_NO_ELIGIBLE_ITEMS" });
    expect(provider.sendCalls).toHaveLength(0);
    const attempt1 = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, "intent-1", 1, "attempt-1"));
    expect(attempt1?.status).toBe("FAILED_TERMINAL");
  });

  it("no resolvable phone -> SKIPPED_NO_PHONE, attempts marked FAILED_TERMINAL, no send attempted", async () => {
    const command = makeCommand();
    deps.resolveRecipientPhone = async () => undefined;
    await seed(
      [makeItem("item-1"), makeItem("item-2")],
      [makeAttempt("intent-1", "attempt-1"), makeAttempt("intent-2", "attempt-2")],
    );

    const outcome = await processWhatsAppDigestDelivery(deps, command);
    expect(outcome).toEqual({ kind: "SKIPPED_NO_PHONE" });
    const attempt1 = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, "intent-1", 1, "attempt-1"));
    expect(attempt1?.status).toBe("FAILED_TERMINAL");
  });

  it("send failure (CONCLUSIVE_RETRYABLE) marks every attempt FAILED_RETRYABLE", async () => {
    const command = makeCommand();
    provider.error = new WhatsAppSendError("rate limited", "CONCLUSIVE_RETRYABLE");
    await seed(
      [makeItem("item-1"), makeItem("item-2")],
      [makeAttempt("intent-1", "attempt-1"), makeAttempt("intent-2", "attempt-2")],
    );

    const outcome = await processWhatsAppDigestDelivery(deps, command);
    expect(outcome).toEqual({ kind: "SEND_FAILED" });
    const attempt1 = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, "intent-1", 1, "attempt-1"));
    const attempt2 = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, "intent-2", 1, "attempt-2"));
    expect(attempt1?.status).toBe("FAILED_RETRYABLE");
    expect(attempt2?.status).toBe("FAILED_RETRYABLE");
  });

  it("portfolio quota tier reached -> SKIPPED_PORTFOLIO_QUOTA, attempts marked FAILED_RETRYABLE, no send attempted", async () => {
    const command = makeCommand();
    deps.portfolioQuotaTierLimit = 0; // any distinct phone immediately exceeds a tier of 0.
    await seed(
      [makeItem("item-1"), makeItem("item-2")],
      [makeAttempt("intent-1", "attempt-1"), makeAttempt("intent-2", "attempt-2")],
    );

    const outcome = await processWhatsAppDigestDelivery(deps, command);
    expect(outcome).toEqual({ kind: "SKIPPED_PORTFOLIO_QUOTA" });
    expect(provider.sendCalls).toHaveLength(0);
    const attempt1 = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, "intent-1", 1, "attempt-1"));
    expect(attempt1?.status).toBe("FAILED_RETRYABLE");
  });

  it("redelivered message (at-least-once) that finds attempts already resolved is a safe no-op per attempt", async () => {
    const command = makeCommand();
    await seed(
      [makeItem("item-1"), makeItem("item-2")],
      [makeAttempt("intent-1", "attempt-1", { status: "ACCEPTED" }), makeAttempt("intent-2", "attempt-2", { status: "ACCEPTED" })],
    );

    const outcome = await processWhatsAppDigestDelivery(deps, command);
    // The worker still sends again (idempotency of the EXTERNAL send is out of scope here - same
    // "at-most-once delivery is a provider/webhook concern" posture whatsapp-delivery-workflow.ts
    // documents) - what this test guards is that marking already-resolved attempts never throws
    // or corrupts their state.
    expect(outcome.kind).toBe("SENT");
    const attempt1 = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, "intent-1", 1, "attempt-1"));
    expect(attempt1?.status).toBe("ACCEPTED"); // untouched - was never DIGESTED when re-read
  });
});
