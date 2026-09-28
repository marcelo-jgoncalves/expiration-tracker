import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryNotificationStore } from "./in-memory-store.js";
import { processWhatsAppDigestDelivery, type WhatsAppDigestDeliverCommand, type WhatsAppDigestDeliveryDeps } from "../../../src/workers/whatsapp-digest-delivery/delivery.js";
import { itemKey, type ExpirationItem } from "../../../src/modules/expiration/domain/expiration-item.js";
import { notificationAttemptKey, notificationAttemptLookupKey, type NotificationAttempt, type NotificationAttemptLookup } from "../../../src/modules/notification/domain/notification-attempt.js";
import { digestEntryKey, digestEntryPurgeAfterTtl, digestFlushAtIso, type DigestEntry } from "../../../src/modules/notification/domain/digest-entry.js";
import type { WhatsAppProviderAdapter } from "../../../src/modules/notification/ports/whatsapp-provider.js";
import { WhatsAppSendError } from "../../../src/modules/notification/ports/whatsapp-provider.js";
import { authorizedTenantIdFromPersistedEntity } from "../../../src/modules/identity/domain/authorization.js";
import { tenantLifecycleKey } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";

const TENANT = "t1";
const AUTH_TENANT = authorizedTenantIdFromPersistedEntity({ tenantId: TENANT });
const RECIPIENT = "user1";
const WINDOW = "2026-09-09";
const NOW = "2026-09-10T00:30:00.000Z"; // past digestFlushAtIso(WINDOW)
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

function makeLookup(intentId: string, attemptId: string): NotificationAttemptLookup {
  return {
    ...notificationAttemptLookupKey(TENANT, attemptId),
    entityType: "NotificationAttemptLookup",
    tenantId: TENANT,
    intentId,
    attemptSk: notificationAttemptKey(TENANT, intentId, 1, attemptId).SK,
    provider: "META_CLOUD_API",
    providerAccountId: "default",
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

function makeEntry(command: WhatsAppDigestDeliverCommand, overrides: Partial<DigestEntry> = {}): DigestEntry {
  return {
    ...digestEntryKey(TENANT, RECIPIENT, "WHATSAPP", WINDOW),
    entityType: "DigestEntry",
    tenantId: TENANT,
    recipientUserId: RECIPIENT,
    channel: "WHATSAPP",
    windowDate: WINDOW,
    status: "FLUSHED",
    items: command.items,
    flushAt: digestFlushAtIso(WINDOW),
    version: 1,
    createdAt: "2026-09-09T09:00:00.000Z",
    updatedAt: "2026-09-09T09:00:00.000Z",
    purgeAfterTtl: digestEntryPurgeAfterTtl(WINDOW),
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

  async function seed(command: WhatsAppDigestDeliverCommand, items: ExpirationItem[], attempts: NotificationAttempt[], entryOverrides: Partial<DigestEntry> = {}, lifecycleStatus: "ACTIVE" | "DELETING" = "ACTIVE") {
    await store.putIfAbsent(makeEntry(command, entryOverrides));
    for (const item of items) await store.putIfAbsent(item);
    for (const attempt of attempts) await store.putIfAbsent(attempt);
    await store.putIfAbsent(makeLookup(attempts[0]!.intentId, attempts[0]!.attemptId));
    await store.putIfAbsent({
      ...tenantLifecycleKey(TENANT),
      entityType: "TenantLifecycleRecord",
      tenantId: TENANT,
      status: lifecycleStatus,
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    });
  }

  it("no DigestEntry found (shouldn't happen in practice) -> SKIPPED_NO_ENTRY, no side effects", async () => {
    const command = makeCommand();
    const outcome = await processWhatsAppDigestDelivery(deps, command);
    expect(outcome).toEqual({ kind: "SKIPPED_NO_ENTRY" });
    expect(provider.sendCalls).toHaveLength(0);
  });

  it("sends ONE consolidated message, transitions every DIGESTED attempt to ACCEPTED, and marks the entry SENT", async () => {
    const command = makeCommand();
    await seed(command, [makeItem("item-1"), makeItem("item-2")], [makeAttempt("intent-1", "attempt-1"), makeAttempt("intent-2", "attempt-2")]);

    const outcome = await processWhatsAppDigestDelivery(deps, command);
    expect(outcome).toEqual({ kind: "SENT", providerMessageId: "wamid.1", itemCount: 2 });
    expect(provider.sendCalls).toHaveLength(1);

    const attempt1 = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, "intent-1", 1, "attempt-1"));
    const attempt2 = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, "intent-2", 1, "attempt-2"));
    expect(attempt1?.status).toBe("ACCEPTED");
    expect(attempt2?.status).toBe("ACCEPTED");
    expect(attempt1?.providerMessageId).toBe("wamid.1");

    const entry = await store.get<DigestEntry>(digestEntryKey(TENANT, RECIPIENT, "WHATSAPP", WINDOW));
    expect(entry?.status).toBe("SENT");
  });

  it("records the OTHER eligible attempts as digest siblings on the primary attempt's lookup row, for webhook fan-out", async () => {
    const command = makeCommand();
    await seed(command, [makeItem("item-1"), makeItem("item-2")], [makeAttempt("intent-1", "attempt-1"), makeAttempt("intent-2", "attempt-2")]);

    await processWhatsAppDigestDelivery(deps, command);

    const lookup = await store.get<NotificationAttemptLookup>(notificationAttemptLookupKey(TENANT, "attempt-1"));
    expect(lookup?.digestSiblingAttempts).toEqual([{ intentId: "intent-2", attemptSk: notificationAttemptKey(TENANT, "intent-2", 1, "attempt-2").SK }]);
  });

  it("a redelivered SQS message never sends twice - the second call finds the entry already SENT and is a safe no-op", async () => {
    const command = makeCommand();
    await seed(command, [makeItem("item-1"), makeItem("item-2")], [makeAttempt("intent-1", "attempt-1"), makeAttempt("intent-2", "attempt-2")]);

    const first = await processWhatsAppDigestDelivery(deps, command);
    expect(first.kind).toBe("SENT");
    const second = await processWhatsAppDigestDelivery(deps, command);
    expect(second).toEqual({ kind: "SKIPPED_RESOLVED" });
    // Real bug found in Round 1 Codex review: the FIRST version of this worker had no admission
    // at all and sent again here - this assertion is the regression guard for that exact bug.
    expect(provider.sendCalls).toHaveLength(1);
  });

  it("a retryable failure followed by a successful retry ends with the attempt ACCEPTED, never stuck at FAILED_RETRYABLE", async () => {
    const command = makeCommand();
    provider.error = new WhatsAppSendError("rate limited", "CONCLUSIVE_RETRYABLE");
    await seed(command, [makeItem("item-1"), makeItem("item-2")], [makeAttempt("intent-1", "attempt-1"), makeAttempt("intent-2", "attempt-2")]);

    const first = await processWhatsAppDigestDelivery(deps, command);
    expect(first).toEqual({ kind: "SEND_FAILED", retryable: true });
    const afterFirst = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, "intent-1", 1, "attempt-1"));
    expect(afterFirst?.status).toBe("FAILED_RETRYABLE");

    // Real bug found in Round 2 Codex review: the guard used to only accept DIGESTED, so this
    // second, now-successful call could never un-stick an attempt this worker itself had just
    // marked FAILED_RETRYABLE.
    provider.error = undefined;
    const second = await processWhatsAppDigestDelivery(deps, command);
    expect(second.kind).toBe("SENT");
    const afterSecond = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, "intent-1", 1, "attempt-1"));
    expect(afterSecond?.status).toBe("ACCEPTED");
  });

  it("a crash between resolving the entry SENT and marking its attempts is resumable - a later call replays the recorded resolution, never resending", async () => {
    const command = makeCommand();
    await seed(command, [makeItem("item-1"), makeItem("item-2")], [makeAttempt("intent-1", "attempt-1"), makeAttempt("intent-2", "attempt-2")], {
      status: "SENT",
      resolution: { eligibleRefs: command.items, eligibleAttemptStatus: "ACCEPTED", excludedRefs: [], excludedAttemptStatus: "FAILED_TERMINAL", providerMessageId: "wamid.crash" },
    });

    const outcome = await processWhatsAppDigestDelivery(deps, command);
    expect(outcome).toEqual({ kind: "SKIPPED_RESOLVED" });
    expect(provider.sendCalls).toHaveLength(0); // never re-sent - the entry was already SENT

    const attempt1 = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, "intent-1", 1, "attempt-1"));
    const attempt2 = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, "intent-2", 1, "attempt-2"));
    expect(attempt1?.status).toBe("ACCEPTED");
    expect(attempt1?.providerMessageId).toBe("wamid.crash");
    expect(attempt2?.status).toBe("ACCEPTED");
  });

  it("a concurrent invocation finds the entry already SENDING (lease not expired) and backs off without sending", async () => {
    const command = makeCommand();
    await seed(command, [makeItem("item-1"), makeItem("item-2")], [makeAttempt("intent-1", "attempt-1"), makeAttempt("intent-2", "attempt-2")], {
      status: "SENDING",
      leaseExpiresAt: "2026-09-10T00:35:00.000Z", // after NOW
    });

    const outcome = await processWhatsAppDigestDelivery(deps, command);
    expect(outcome).toEqual({ kind: "SKIPPED_IN_PROGRESS" });
    expect(provider.sendCalls).toHaveLength(0);
  });

  it("an expired SENDING lease (crashed invocation) is reconciled to UNKNOWN, never resent blindly", async () => {
    const command = makeCommand();
    await seed(command, [makeItem("item-1"), makeItem("item-2")], [makeAttempt("intent-1", "attempt-1"), makeAttempt("intent-2", "attempt-2")], {
      status: "SENDING",
      leaseExpiresAt: "2026-09-10T00:25:00.000Z", // before NOW
    });

    const outcome = await processWhatsAppDigestDelivery(deps, command);
    expect(outcome).toEqual({ kind: "RECONCILED_UNKNOWN" });
    expect(provider.sendCalls).toHaveLength(0);
    const entry = await store.get<DigestEntry>(digestEntryKey(TENANT, RECIPIENT, "WHATSAPP", WINDOW));
    expect(entry?.status).toBe("UNKNOWN");
    const attempt1 = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, "intent-1", 1, "attempt-1"));
    expect(attempt1?.status).toBe("UNKNOWN");
  });

  it("a tenant in DELETING can never admit a new SENDING lease - the SAME fence the immediate WhatsApp send already uses", async () => {
    const command = makeCommand();
    await seed(command, [makeItem("item-1"), makeItem("item-2")], [makeAttempt("intent-1", "attempt-1"), makeAttempt("intent-2", "attempt-2")], {}, "DELETING");

    const outcome = await processWhatsAppDigestDelivery(deps, command);
    expect(outcome).toEqual({ kind: "SKIPPED_TENANT_NOT_ACTIVE" });
    expect(provider.sendCalls).toHaveLength(0);
  });

  it("leaves out an item that is no longer ACTIVE from the rendered template and marks its attempt FAILED_TERMINAL, but still sends for the remaining ones", async () => {
    const command = makeCommand();
    let renderedItems: ExpirationItem[] = [];
    deps.renderDigestTemplate = (input) => {
      renderedItems = input.items;
      return { templateName: "digest", templateLanguage: "pt_BR", templateParams: [String(input.items.length)] };
    };
    await seed(command, [makeItem("item-1"), makeItem("item-2", { status: "ARCHIVED" })], [makeAttempt("intent-1", "attempt-1"), makeAttempt("intent-2", "attempt-2")]);

    const outcome = await processWhatsAppDigestDelivery(deps, command);
    expect(outcome).toEqual({ kind: "SENT", providerMessageId: "wamid.1", itemCount: 1 });
    expect(renderedItems.map((i) => i.itemId)).toEqual(["item-1"]);

    // Real bug found in Round 1 Codex review: the excluded item's attempt must never share the
    // sent item's ACCEPTED status/providerMessageId - it never appeared in the message.
    const attempt1 = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, "intent-1", 1, "attempt-1"));
    const attempt2 = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, "intent-2", 1, "attempt-2"));
    expect(attempt1?.status).toBe("ACCEPTED");
    expect(attempt2?.status).toBe("FAILED_TERMINAL");
    expect(attempt2?.providerMessageId).toBeUndefined();
  });

  it("no eligible items left (all archived) -> SKIPPED_NO_ELIGIBLE_ITEMS, entry and attempts FAILED_TERMINAL, no send attempted", async () => {
    const command = makeCommand();
    await seed(command, [makeItem("item-1", { status: "ARCHIVED" }), makeItem("item-2", { status: "ARCHIVED" })], [makeAttempt("intent-1", "attempt-1"), makeAttempt("intent-2", "attempt-2")]);

    const outcome = await processWhatsAppDigestDelivery(deps, command);
    expect(outcome).toEqual({ kind: "SKIPPED_NO_ELIGIBLE_ITEMS" });
    expect(provider.sendCalls).toHaveLength(0);
    const attempt1 = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, "intent-1", 1, "attempt-1"));
    expect(attempt1?.status).toBe("FAILED_TERMINAL");
    const entry = await store.get<DigestEntry>(digestEntryKey(TENANT, RECIPIENT, "WHATSAPP", WINDOW));
    expect(entry?.status).toBe("FAILED");
  });

  it("no resolvable phone -> SKIPPED_NO_PHONE, entry and attempts FAILED_TERMINAL, no send attempted", async () => {
    const command = makeCommand();
    deps.resolveRecipientPhone = async () => undefined;
    await seed(command, [makeItem("item-1"), makeItem("item-2")], [makeAttempt("intent-1", "attempt-1"), makeAttempt("intent-2", "attempt-2")]);

    const outcome = await processWhatsAppDigestDelivery(deps, command);
    expect(outcome).toEqual({ kind: "SKIPPED_NO_PHONE" });
    const attempt1 = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, "intent-1", 1, "attempt-1"));
    expect(attempt1?.status).toBe("FAILED_TERMINAL");
    const entry = await store.get<DigestEntry>(digestEntryKey(TENANT, RECIPIENT, "WHATSAPP", WINDOW));
    expect(entry?.status).toBe("FAILED");
  });

  it("portfolio quota tier reached -> SKIPPED_PORTFOLIO_QUOTA, entry returns to FLUSHED (retryable) with lease dropped, attempts FAILED_RETRYABLE", async () => {
    const command = makeCommand();
    deps.portfolioQuotaTierLimit = 0; // any distinct phone immediately exceeds a tier of 0.
    await seed(command, [makeItem("item-1"), makeItem("item-2")], [makeAttempt("intent-1", "attempt-1"), makeAttempt("intent-2", "attempt-2")]);

    const outcome = await processWhatsAppDigestDelivery(deps, command);
    expect(outcome).toEqual({ kind: "SKIPPED_PORTFOLIO_QUOTA" });
    expect(provider.sendCalls).toHaveLength(0);
    const attempt1 = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, "intent-1", 1, "attempt-1"));
    expect(attempt1?.status).toBe("FAILED_RETRYABLE");
    const entry = await store.get<DigestEntry>(digestEntryKey(TENANT, RECIPIENT, "WHATSAPP", WINDOW));
    expect(entry?.status).toBe("FLUSHED");
    expect(entry?.leaseExpiresAt).toBeUndefined();
  });

  it("send failure (CONCLUSIVE_RETRYABLE) returns the entry to FLUSHED so a later delivery attempt can retry, marks attempts FAILED_RETRYABLE", async () => {
    const command = makeCommand();
    provider.error = new WhatsAppSendError("rate limited", "CONCLUSIVE_RETRYABLE");
    await seed(command, [makeItem("item-1"), makeItem("item-2")], [makeAttempt("intent-1", "attempt-1"), makeAttempt("intent-2", "attempt-2")]);

    const outcome = await processWhatsAppDigestDelivery(deps, command);
    expect(outcome).toEqual({ kind: "SEND_FAILED", retryable: true });
    const attempt1 = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, "intent-1", 1, "attempt-1"));
    const attempt2 = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, "intent-2", 1, "attempt-2"));
    expect(attempt1?.status).toBe("FAILED_RETRYABLE");
    expect(attempt2?.status).toBe("FAILED_RETRYABLE");
    const entry = await store.get<DigestEntry>(digestEntryKey(TENANT, RECIPIENT, "WHATSAPP", WINDOW));
    expect(entry?.status).toBe("FLUSHED");
  });

  it("send failure (CONCLUSIVE_TERMINAL) resolves the entry as FAILED, never retried", async () => {
    const command = makeCommand();
    provider.error = new WhatsAppSendError("invalid template", "CONCLUSIVE_TERMINAL");
    await seed(command, [makeItem("item-1"), makeItem("item-2")], [makeAttempt("intent-1", "attempt-1"), makeAttempt("intent-2", "attempt-2")]);

    const outcome = await processWhatsAppDigestDelivery(deps, command);
    expect(outcome).toEqual({ kind: "SEND_FAILED", retryable: false });
    const entry = await store.get<DigestEntry>(digestEntryKey(TENANT, RECIPIENT, "WHATSAPP", WINDOW));
    expect(entry?.status).toBe("FAILED");
    const attempt1 = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, "intent-1", 1, "attempt-1"));
    expect(attempt1?.status).toBe("FAILED_TERMINAL");
  });

  it("send failure (AMBIGUOUS) resolves the entry as UNKNOWN, never retried blindly", async () => {
    const command = makeCommand();
    provider.error = new Error("timeout");
    await seed(command, [makeItem("item-1"), makeItem("item-2")], [makeAttempt("intent-1", "attempt-1"), makeAttempt("intent-2", "attempt-2")]);

    const outcome = await processWhatsAppDigestDelivery(deps, command);
    expect(outcome).toEqual({ kind: "SEND_FAILED", retryable: false });
    const entry = await store.get<DigestEntry>(digestEntryKey(TENANT, RECIPIENT, "WHATSAPP", WINDOW));
    expect(entry?.status).toBe("UNKNOWN");
    const attempt1 = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, "intent-1", 1, "attempt-1"));
    expect(attempt1?.status).toBe("UNKNOWN");
  });
});
