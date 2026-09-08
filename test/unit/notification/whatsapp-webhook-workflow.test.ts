import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryNotificationStore } from "./in-memory-store.js";
import { processWhatsAppWebhook, type WhatsAppWebhookWorkflowDeps } from "../../../src/modules/notification/application/whatsapp-webhook-workflow.js";
import type { WhatsAppStatusEvent } from "../../../src/modules/notification/application/whatsapp-webhook-processor.js";
import { notificationAttemptKey, buildNotificationAttemptLookup, type NotificationAttempt } from "../../../src/modules/notification/domain/notification-attempt.js";

const TENANT = "t1";
const INTENT_ID = "intent1";
const ATTEMPT_ID = "attempt1";
const WABA_ID = "waba-1";
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
    channel: "WHATSAPP",
    provider: "META_CLOUD_API",
    providerAccountId: WABA_ID,
    status: "ACCEPTED",
    expectedItemVersion: 3,
    commandMessageId: ATTEMPT_ID,
    destinationHash: "",
    templateId: "expiration_reminder",
    templateVersion: 1,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<WhatsAppStatusEvent> = {}): WhatsAppStatusEvent {
  return {
    wabaId: WABA_ID,
    wamid: "wamid-1",
    statusType: "DELIVERED",
    occurredAt: NOW,
    tags: { attemptId: ATTEMPT_ID, intentId: INTENT_ID, tenantId: TENANT },
    ...overrides,
  };
}

describe("processWhatsAppWebhook (D-197 fatia 3/5, D-7 - account-scoped WebhookInbox)", () => {
  let store: InMemoryNotificationStore;
  let deps: WhatsAppWebhookWorkflowDeps;

  beforeEach(() => {
    store = new InMemoryNotificationStore();
    deps = { store, tableName: "MainTable", now: () => NOW };
  });

  async function seed(attempt = makeAttempt()) {
    await store.putIfAbsent(attempt);
    await store.putIfAbsent(buildNotificationAttemptLookup(attempt));
  }

  it("DELIVERED applies: attempt transitions ACCEPTED -> DELIVERED", async () => {
    await seed(makeAttempt({ status: "ACCEPTED" }));
    const outcome = await processWhatsAppWebhook(deps, makeEvent());
    expect(outcome).toEqual({ kind: "APPLIED", nextStatus: "DELIVERED" });
    const attempt = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, INTENT_ID, 1, ATTEMPT_ID));
    expect(attempt?.status).toBe("DELIVERED");
  });

  it("the WebhookInbox row is account-scoped (PK=WEBHOOK#WHATSAPP#<wabaId>), purgeScope=ACCOUNT, GSI8 pointer keyed by accountId - never TENANT#", async () => {
    await seed(makeAttempt({ status: "ACCEPTED" }));
    await processWhatsAppWebhook(deps, makeEvent());
    const inbox = await store.get<Record<string, unknown> & { PK: string; SK: string }>({ PK: `WEBHOOK#WHATSAPP#${WABA_ID}`, SK: "EVENT#wamid-1#DELIVERED" });
    expect(inbox).toBeDefined();
    expect(inbox?.["purgeScope"]).toBe("ACCOUNT");
    expect(inbox?.["accountId"]).toBe(WABA_ID);
    expect(inbox?.["tenantId"]).toBeUndefined();
    expect(inbox?.["GSI8PK"]).toBe("WORK#TRANSIENT");
    expect(inbox?.["GSI8SK"]).toBe(`2026-09-17T12:05:00.000Z#ACCOUNT#${WABA_ID}#WebhookInbox#EVENT#wamid-1#DELIVERED`);
  });

  it("duplicate wamid+statusType -> DUPLICATE_INBOX, no double-apply", async () => {
    await seed(makeAttempt({ status: "ACCEPTED" }));
    const event = makeEvent();
    const first = await processWhatsAppWebhook(deps, event);
    expect(first.kind).toBe("APPLIED");
    const second = await processWhatsAppWebhook(deps, event);
    expect(second).toEqual({ kind: "DUPLICATE_INBOX" });
  });

  it("a DIFFERENT statusType for the SAME wamid is a SEPARATE inbox row, not a duplicate (SK includes statusType)", async () => {
    await seed(makeAttempt({ status: "ACCEPTED" }));
    const sent = await processWhatsAppWebhook(deps, makeEvent({ statusType: "SENT" }));
    const delivered = await processWhatsAppWebhook(deps, makeEvent({ statusType: "DELIVERED" }));
    expect(sent.kind).not.toBe("DUPLICATE_INBOX");
    expect(delivered.kind).not.toBe("DUPLICATE_INBOX");
  });

  it("missing biz_opaque_callback_data tags -> UNMATCHED, the row still purges via purgeScope=ACCOUNT (no tenant needed)", async () => {
    await seed();
    const outcome = await processWhatsAppWebhook(deps, makeEvent({ tags: {} }));
    expect(outcome).toEqual({ kind: "UNMATCHED" });
    const inbox = await store.get<Record<string, unknown> & { PK: string; SK: string }>({ PK: `WEBHOOK#WHATSAPP#${WABA_ID}`, SK: "EVENT#wamid-1#DELIVERED" });
    expect(inbox?.["processingStatus"]).toBe("UNMATCHED");
    expect(inbox?.["purgeScope"]).toBe("ACCOUNT"); // never tenant-fenced, even though correlation failed
  });

  it("tags reference an attempt with no matching lookup pointer (orphaned/replayed wamid) -> UNMATCHED", async () => {
    await seed();
    const outcome = await processWhatsAppWebhook(deps, makeEvent({ tags: { attemptId: "ghost", intentId: INTENT_ID, tenantId: TENANT } }));
    expect(outcome).toEqual({ kind: "UNMATCHED" });
  });

  it("out-of-order callback (lower precedence than current status) -> NO_OP_PRECEDENCE, attempt untouched", async () => {
    await seed(makeAttempt({ status: "DELIVERED" }));
    const outcome = await processWhatsAppWebhook(deps, makeEvent({ statusType: "SENT" }));
    expect(outcome).toEqual({ kind: "NO_OP_PRECEDENCE" });
    const attempt = await store.get<NotificationAttempt>(notificationAttemptKey(TENANT, INTENT_ID, 1, ATTEMPT_ID));
    expect(attempt?.status).toBe("DELIVERED");
  });

  it("FAILED applies as a terminal outcome", async () => {
    await seed(makeAttempt({ status: "ACCEPTED" }));
    const outcome = await processWhatsAppWebhook(deps, makeEvent({ statusType: "FAILED" }));
    expect(outcome).toEqual({ kind: "APPLIED", nextStatus: "FAILED_TERMINAL" });
  });

  it("successful correlation annotates the inbox row with tenantId/attemptId/intentId as metadata only - never changes purgeScope/accountId", async () => {
    await seed(makeAttempt({ status: "ACCEPTED" }));
    await processWhatsAppWebhook(deps, makeEvent());
    const inbox = await store.get<Record<string, unknown> & { PK: string; SK: string }>({ PK: `WEBHOOK#WHATSAPP#${WABA_ID}`, SK: "EVENT#wamid-1#DELIVERED" });
    expect(inbox?.["correlatedTenantId"]).toBe(TENANT);
    expect(inbox?.["purgeScope"]).toBe("ACCOUNT");
    expect(inbox?.["accountId"]).toBe(WABA_ID);
    expect(inbox?.["processingStatus"]).toBe("PROCESSED");
  });
});
