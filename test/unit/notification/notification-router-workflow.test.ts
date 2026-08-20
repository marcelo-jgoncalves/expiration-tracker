import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryNotificationStore } from "./in-memory-store.js";
import { routeNotificationIntent, type NotificationRouterWorkflowDeps } from "../../../src/modules/notification/application/notification-router-workflow.js";
import type { NotificationRecipientResolver, ResolvedRecipient } from "../../../src/modules/notification/ports/recipient-resolver.js";
import { itemKey, type ExpirationItem } from "../../../src/modules/expiration/domain/expiration-item.js";
import { policyKey, type ReminderPolicy } from "../../../src/modules/reminder/domain/reminder-policy.js";
import { notificationEntitlementsKey, type NotificationEntitlements } from "../../../src/modules/notification/domain/notification-entitlements.js";
import { notificationPreferencesKey, type NotificationPreferences } from "../../../src/modules/notification/domain/notification-preferences.js";
import type { NotificationIntent } from "../../../src/modules/reminder/domain/notification-intent.js";
import type { NotificationAttempt } from "../../../src/modules/notification/domain/notification-attempt.js";

const TENANT = "t1";
const ITEM_ID = "item1";
const POLICY_ID = "policy1";
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

function makePolicy(overrides: Partial<ReminderPolicy> = {}): ReminderPolicy {
  return {
    ...policyKey(TENANT, POLICY_ID),
    entityType: "ReminderPolicy",
    policyId: POLICY_ID,
    tenantId: TENANT,
    scope: "ITEM",
    itemId: ITEM_ID,
    name: "default",
    triggers: [{ triggerId: "trig1", offsetIso: "-P7D", localTime: "09:00" }],
    timeZone: "America/Sao_Paulo",
    channels: ["EMAIL"],
    enabled: true,
    version: 2,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeIntent(overrides: Partial<NotificationIntent> = {}): NotificationIntent {
  return {
    PK: `TENANT#${TENANT}#INTENT#intent1`,
    SK: "META",
    entityType: "NotificationIntent",
    intentId: "intent1",
    tenantId: TENANT,
    kind: "EXPIRATION_REMINDER",
    itemId: ITEM_ID,
    occurrenceId: "occ1",
    itemVersion: 3,
    policyId: POLICY_ID,
    policyVersion: 2,
    scheduledAt: NOW,
    requestedChannels: ["EMAIL"],
    status: "PENDING",
    supersedesIntentId: null,
    correctionReason: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

class FakeRecipientResolver implements NotificationRecipientResolver {
  result: ResolvedRecipient | undefined = { userId: TENANT, tenantId: TENANT, active: true };
  async resolve(): Promise<ResolvedRecipient | undefined> {
    return this.result;
  }
}

describe("routeNotificationIntent", () => {
  let store: InMemoryNotificationStore;
  let resolver: FakeRecipientResolver;
  let deps: NotificationRouterWorkflowDeps;
  let idCounter: number;

  beforeEach(() => {
    store = new InMemoryNotificationStore();
    resolver = new FakeRecipientResolver();
    idCounter = 0;
    deps = {
      store,
      tableName: "MainTable",
      recipientResolver: resolver,
      now: () => NOW,
      newAttemptId: () => `attempt-${++idCounter}`,
      newIntentId: () => `newintent-${++idCounter}`,
    };
  });

  async function seed(input: { item?: ExpirationItem; policy?: ReminderPolicy; entitlements?: NotificationEntitlements; preferences?: NotificationPreferences }) {
    const item = input.item ?? makeItem();
    const policy = input.policy ?? makePolicy();
    await store.putIfAbsent(item);
    await store.putIfAbsent(policy);
    if (input.entitlements !== undefined) await store.putIfAbsent(input.entitlements);
    if (input.preferences !== undefined) await store.putIfAbsent(input.preferences);
  }

  function defaultEntitlements(): NotificationEntitlements {
    return {
      ...notificationEntitlementsKey(TENANT),
      entityType: "NotificationEntitlements",
      tenantId: TENANT,
      email: { enabled: true },
      whatsapp: { enabled: false },
      planVersion: 1,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    };
  }

  function defaultPreferences(userId: string): NotificationPreferences {
    return {
      ...notificationPreferencesKey(TENANT, userId),
      entityType: "NotificationPreferences",
      tenantId: TENANT,
      userId,
      emailEnabled: true,
      locale: "pt-BR",
      quietHours: null,
      consentSource: "ONBOARDING",
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
    };
  }

  it("happy path: routes EMAIL, creates attempt + lookup pointer + outbox event, marks intent DISPATCHED", async () => {
    await seed({ entitlements: defaultEntitlements(), preferences: defaultPreferences(TENANT) });
    const intent = makeIntent();
    await store.putIfAbsent(intent);

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "ROUTED", routedChannels: ["EMAIL"] });

    const updatedIntent = await store.get<NotificationIntent>({ PK: intent.PK, SK: intent.SK });
    expect(updatedIntent?.status).toBe("DISPATCHED");
    expect(updatedIntent?.routedChannels).toEqual(["EMAIL"]);

    const all = store.allItems();
    const attempt = all.find((i) => i["entityType"] === "NotificationAttempt") as unknown as NotificationAttempt;
    expect(attempt).toBeDefined();
    expect(attempt.status).toBe("PREPARED");

    const lookup = all.find((i) => i["entityType"] === "NotificationAttemptLookup");
    expect(lookup).toBeDefined();

    const outboxEvent = all.find((i) => i["entityType"] === "OutboxEvent");
    expect(outboxEvent).toBeDefined();
    expect(outboxEvent?.["destination"]).toBe("SQS_NOTIFICATION_EMAIL_V1");
  });

  it("intent no longer PENDING (duplicate Streams delivery) -> NOOP_NOT_PENDING, no writes", async () => {
    await seed({ entitlements: defaultEntitlements(), preferences: defaultPreferences(TENANT) });
    const intent = makeIntent({ status: "DISPATCHED" });
    await store.putIfAbsent(intent);

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "NOOP_NOT_PENDING" });
  });

  it("item inactive -> CANCELLED, cancelledChannels recorded with ITEM_INACTIVE", async () => {
    await seed({ item: makeItem({ status: "ARCHIVED" }), entitlements: defaultEntitlements(), preferences: defaultPreferences(TENANT) });
    const intent = makeIntent();
    await store.putIfAbsent(intent);

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "CANCELLED", reason: "ITEM_INACTIVE" });

    const updatedIntent = await store.get<NotificationIntent>({ PK: intent.PK, SK: intent.SK });
    expect(updatedIntent?.status).toBe("CANCELLED");
    expect(updatedIntent?.cancelledChannels).toEqual([{ channel: "EMAIL", reason: "ITEM_INACTIVE" }]);
  });

  it("item version stale, no prior attempt -> STALE_REPLACEMENT, creates a new REPLACEMENT intent, cancels the old one", async () => {
    await seed({ item: makeItem({ version: 4 }), entitlements: defaultEntitlements(), preferences: defaultPreferences(TENANT) });
    const intent = makeIntent(); // itemVersion: 3, item is now version 4
    await store.putIfAbsent(intent);

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "STALE_REPLACEMENT" });

    const oldIntent = await store.get<NotificationIntent>({ PK: intent.PK, SK: intent.SK });
    expect(oldIntent?.status).toBe("CANCELLED");

    const all = store.allItems();
    const newIntent = all.find((i) => i["entityType"] === "NotificationIntent" && i["intentId"] !== intent.intentId) as unknown as NotificationIntent;
    expect(newIntent).toBeDefined();
    expect(newIntent.kind).toBe("REPLACEMENT");
    expect(newIntent.supersedesIntentId).toBe(intent.intentId);
    expect(newIntent.itemVersion).toBe(4);
  });

  it("cross-tenant/invalid assigneeUserId (resolver returns undefined) -> CANCELLED RECIPIENT_NOT_FOUND, no attempt/outbox created", async () => {
    resolver.result = undefined;
    await seed({ item: makeItem({ assigneeUserId: "other-tenant-user" }), entitlements: defaultEntitlements(), preferences: defaultPreferences(TENANT) });
    const intent = makeIntent();
    await store.putIfAbsent(intent);

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "CANCELLED", reason: "RECIPIENT_NOT_FOUND" });

    const all = store.allItems();
    expect(all.some((i) => i["entityType"] === "NotificationAttempt")).toBe(false);
    expect(all.some((i) => i["entityType"] === "OutboxEvent")).toBe(false);
  });

  it("entitlement record missing (technical gap) -> RETRY, no write at all", async () => {
    await seed({ preferences: defaultPreferences(TENANT) }); // no entitlements record
    const intent = makeIntent();
    await store.putIfAbsent(intent);

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "RETRY", cause: "ENTITLEMENT_UNAVAILABLE" });

    const unchangedIntent = await store.get<NotificationIntent>({ PK: intent.PK, SK: intent.SK });
    expect(unchangedIntent?.status).toBe("PENDING");
  });

  it("opted out -> CANCELLED OPTED_OUT", async () => {
    await seed({ entitlements: defaultEntitlements(), preferences: defaultPreferences(TENANT) });
    await store.update({ ...defaultPreferences(TENANT), emailEnabled: false });
    const intent = makeIntent();
    await store.putIfAbsent(intent);

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "CANCELLED", reason: "OPTED_OUT" });
  });
});
