import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryNotificationStore } from "./in-memory-store.js";
import { routeNotificationIntent, type NotificationRouterWorkflowDeps } from "../../../src/modules/notification/application/notification-router-workflow.js";
import type { NotificationRecipientResolver, ResolvedRecipient } from "../../../src/modules/notification/ports/recipient-resolver.js";
import { itemKey, type ExpirationItem } from "../../../src/modules/expiration/domain/expiration-item.js";
import { itemWatchKey } from "../../../src/modules/expiration/domain/item-watch.js";
import { policyKey, type ReminderPolicy } from "../../../src/modules/reminder/domain/reminder-policy.js";
import { notificationEntitlementsKey, type NotificationEntitlements } from "../../../src/modules/notification/domain/notification-entitlements.js";
import { notificationPreferencesKey, type NotificationPreferences } from "../../../src/modules/notification/domain/notification-preferences.js";
import type { NotificationIntent } from "../../../src/modules/reminder/domain/notification-intent.js";
import type { NotificationAttempt } from "../../../src/modules/notification/domain/notification-attempt.js";
import { authorizedTenantIdFromPersistedEntity } from "../../../src/modules/identity/domain/authorization.js";
import { epochSecondsFromIso, OUTBOX_TRANSIENT_RETENTION_SECONDS } from "../../../src/shared/outbox/outbox.js";

const TENANT = "t1";
const AUTH_TENANT = authorizedTenantIdFromPersistedEntity({ tenantId: TENANT });
const ITEM_ID = "item1";
const POLICY_ID = "policy1";
const NOW = "2026-09-10T12:00:00.000Z";

const ASSIGNEE = "assignee-1";

function makeItem(overrides: Partial<ExpirationItem> = {}): ExpirationItem {
  return {
    ...itemKey(AUTH_TENANT, ITEM_ID),
    entityType: "ExpirationItem",
    itemId: ITEM_ID,
    tenantId: TENANT,
    name: "Passport",
    category: "document",
    categoryNormalized: "document",
    dueDate: "2026-12-01",
    // Wave B2B-11: a real default assignee - resolveCandidateUserId no longer falls back to
    // tenantId (never a real userId post-B2B), so a test seeding an item with NO assigneeUserId
    // now hits an immediate RECIPIENT_NOT_FOUND cancellation before the resolver is ever called
    // (see the dedicated test for exactly that below) - every OTHER test in this file that wants
    // the resolver actually reached needs a real candidate here.
    assigneeUserId: ASSIGNEE,
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
  result: ResolvedRecipient | undefined = { userId: ASSIGNEE, tenantId: TENANT, active: true };
  async resolve(): Promise<ResolvedRecipient | undefined> {
    return this.result;
  }
}

/** D-201 (MANAGER escalation) test fake - mutable Set mirrors FakeTenantManagerLookup in
 * test/unit/reminder/dispatch.test.ts (same shape, separate file - no shared module for a
 * 2-file test double). */
class FakeTenantManagerLookup {
  activeManagers = new Set<string>();
  async listActiveManagers(_tenantId: string): Promise<{ userId: string }[]> {
    return [...this.activeManagers].map((userId) => ({ userId }));
  }
  async isActiveManager(_tenantId: string, userId: string): Promise<boolean> {
    return this.activeManagers.has(userId);
  }
}

describe("routeNotificationIntent", () => {
  let store: InMemoryNotificationStore;
  let resolver: FakeRecipientResolver;
  let managerLookup: FakeTenantManagerLookup;
  let deps: NotificationRouterWorkflowDeps;
  let idCounter: number;

  beforeEach(() => {
    store = new InMemoryNotificationStore();
    resolver = new FakeRecipientResolver();
    managerLookup = new FakeTenantManagerLookup();
    idCounter = 0;
    deps = {
      store,
      tableName: "MainTable",
      recipientResolver: resolver,
      managerLookup,
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
    await seed({ entitlements: defaultEntitlements(), preferences: defaultPreferences(ASSIGNEE) });
    const intent = makeIntent();
    await store.putIfAbsent(intent);

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "ROUTED", routedChannels: ["EMAIL"] });

    const updatedIntent = await store.get<NotificationIntent>({ PK: intent.PK, SK: intent.SK });
    expect(updatedIntent?.status).toBe("DISPATCHED");
    expect(updatedIntent?.routedChannels).toEqual(["EMAIL"]);
    // Real bug found and fixed 2026-09-05: recipientUserId was computed by the resolver but
    // never persisted onto the intent - email-delivery-workflow.ts reads it back from THIS
    // field (never from an in-memory value) to resolve the send-to address, so every real
    // routed email unconditionally failed with "no resolved address" before ever calling
    // SES. Mutation this test now catches: comment out `recipientUserId:` in
    // applyRoutedDecision's `set` and this assertion fails (undefined, not ASSIGNEE).
    expect(updatedIntent?.recipientUserId).toBe(ASSIGNEE);

    const all = store.allItems();
    const attempt = all.find((i) => i["entityType"] === "NotificationAttempt") as unknown as NotificationAttempt;
    expect(attempt).toBeDefined();
    expect(attempt.status).toBe("PREPARED");

    const lookup = all.find((i) => i["entityType"] === "NotificationAttemptLookup");
    expect(lookup).toBeDefined();

    const outboxEvent = all.find((i) => i["entityType"] === "OutboxEvent");
    expect(outboxEvent).toBeDefined();
    expect(outboxEvent?.["destination"]).toBe("SQS_NOTIFICATION_EMAIL_V1");
    // Real finding, 2026-09-19: this outbox record never had purgeAfterTtl set - catches a
    // regression back to that (every routed email leaving a permanent row behind).
    expect(outboxEvent?.["purgeAfterTtl"]).toBe(epochSecondsFromIso(NOW) + OUTBOX_TRANSIENT_RETENTION_SECONDS);
  });

  // D-197 fatia 5/5: router wiring - a WHATSAPP-requesting intent, with the kill switch on
  // (deps.whatsappChannelEnabled) and the tenant entitled (NotificationEntitlements.whatsapp.
  // enabled), now reaches the WhatsApp outbox destination for the first time (previously this
  // outcome was mechanically impossible - SUPPORTED_CHANNELS was EMAIL-only).
  //
  // D-347 §3.5: the item here (makeItem's default dueDate 2026-12-01, far past NOW's VENCENDO
  // window) is NOT overdue and the intent has no MANAGER targetKind - by decideDigestRouting's
  // own rule this is now digestible, so this happy path folds into a DigestEntry instead of an
  // immediate outbox record. The immediate-send behavior this test used to assert is covered by
  // the dedicated bypass tests below (overdue item, MANAGER escalation).
  it("happy path: routes WHATSAPP when kill switch on + entitled + not overdue -> digested, attempt DIGESTED, DigestEntry created, no outbox event", async () => {
    deps.whatsappChannelEnabled = true;
    await seed({
      entitlements: { ...defaultEntitlements(), whatsapp: { enabled: true } },
      preferences: defaultPreferences(ASSIGNEE),
    });
    const intent = makeIntent({ requestedChannels: ["WHATSAPP"] });
    await store.putIfAbsent(intent);

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "ROUTED", routedChannels: ["WHATSAPP"] });

    const all = store.allItems();
    const attempt = all.find((i) => i["entityType"] === "NotificationAttempt") as unknown as NotificationAttempt;
    expect(attempt).toBeDefined();
    expect(attempt.channel).toBe("WHATSAPP");
    expect(attempt.provider).toBe("META_CLOUD_API");
    expect(attempt.status).toBe("DIGESTED");

    expect(all.some((i) => i["entityType"] === "OutboxEvent")).toBe(false);

    const digestEntry = all.find((i) => i["entityType"] === "DigestEntry");
    expect(digestEntry).toBeDefined();
    expect(digestEntry?.["tenantId"]).toBe(TENANT);
    expect(digestEntry?.["recipientUserId"]).toBe(ASSIGNEE);
    expect(digestEntry?.["status"]).toBe("OPEN");
    expect(digestEntry?.["items"]).toEqual([{ intentId: intent.intentId, attemptId: attempt.attemptId, itemId: ITEM_ID, itemVersion: intent.itemVersion, addedAt: NOW }]);
  });

  it("WHATSAPP intent for an already-overdue item bypasses the digest - immediate outbox event, attempt PREPARED", async () => {
    deps.whatsappChannelEnabled = true;
    await seed({
      item: makeItem({ dueDate: "2026-01-01" }),
      entitlements: { ...defaultEntitlements(), whatsapp: { enabled: true } },
      preferences: defaultPreferences(ASSIGNEE),
    });
    const intent = makeIntent({ requestedChannels: ["WHATSAPP"] });
    await store.putIfAbsent(intent);

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "ROUTED", routedChannels: ["WHATSAPP"] });

    const all = store.allItems();
    const attempt = all.find((i) => i["entityType"] === "NotificationAttempt") as unknown as NotificationAttempt;
    expect(attempt.status).toBe("PREPARED");
    const outboxEvent = all.find((i) => i["entityType"] === "OutboxEvent");
    expect(outboxEvent?.["destination"]).toBe("SQS_NOTIFICATION_WHATSAPP_V1");
    expect(all.some((i) => i["entityType"] === "DigestEntry")).toBe(false);
  });

  it("WHATSAPP MANAGER-escalation intent bypasses the digest even when the item is not overdue", async () => {
    deps.whatsappChannelEnabled = true;
    managerLookup.activeManagers.add(ASSIGNEE);
    await seed({
      entitlements: { ...defaultEntitlements(), whatsapp: { enabled: true } },
      preferences: defaultPreferences(ASSIGNEE),
    });
    const intent = makeIntent({ requestedChannels: ["WHATSAPP"], targetKind: "MANAGER", targetUserId: ASSIGNEE });
    await store.putIfAbsent(intent);

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "ROUTED", routedChannels: ["WHATSAPP"] });

    const all = store.allItems();
    const attempt = all.find((i) => i["entityType"] === "NotificationAttempt") as unknown as NotificationAttempt;
    expect(attempt.status).toBe("PREPARED");
    expect(all.some((i) => i["entityType"] === "OutboxEvent")).toBe(true);
    expect(all.some((i) => i["entityType"] === "DigestEntry")).toBe(false);
  });

  it("a second digestible WHATSAPP intent the same day for the same recipient appends to the SAME DigestEntry window", async () => {
    deps.whatsappChannelEnabled = true;
    await seed({
      entitlements: { ...defaultEntitlements(), whatsapp: { enabled: true } },
      preferences: defaultPreferences(ASSIGNEE),
    });
    const firstIntent = makeIntent({ intentId: "intent-a", PK: `TENANT#${TENANT}#INTENT#intent-a`, requestedChannels: ["WHATSAPP"] });
    await store.putIfAbsent(firstIntent);
    await routeNotificationIntent(deps, firstIntent);

    const secondIntent = makeIntent({ intentId: "intent-b", PK: `TENANT#${TENANT}#INTENT#intent-b`, requestedChannels: ["WHATSAPP"] });
    await store.putIfAbsent(secondIntent);
    await routeNotificationIntent(deps, secondIntent);

    const all = store.allItems();
    const digestEntries = all.filter((i) => i["entityType"] === "DigestEntry");
    expect(digestEntries).toHaveLength(1);
    expect((digestEntries[0]?.["items"] as unknown[]).map((i) => (i as { intentId: string }).intentId)).toEqual(["intent-a", "intent-b"]);
    expect(digestEntries[0]?.["version"]).toBe(2);
  });

  it("WHATSAPP requested but kill switch off (deps.whatsappChannelEnabled left false/default) -> CANCELLED CHANNEL_UNAVAILABLE, no attempt/outbox created", async () => {
    await seed({
      entitlements: { ...defaultEntitlements(), whatsapp: { enabled: true } }, // entitled, but kill switch is the gate under test
      preferences: defaultPreferences(ASSIGNEE),
    });
    const intent = makeIntent({ requestedChannels: ["WHATSAPP"] });
    await store.putIfAbsent(intent);

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "CANCELLED", reason: "CHANNEL_UNAVAILABLE" });

    const all = store.allItems();
    expect(all.some((i) => i["entityType"] === "NotificationAttempt")).toBe(false);
    expect(all.some((i) => i["entityType"] === "OutboxEvent")).toBe(false);
  });

  it("intent no longer PENDING (duplicate Streams delivery) -> NOOP_NOT_PENDING, no writes", async () => {
    await seed({ entitlements: defaultEntitlements(), preferences: defaultPreferences(ASSIGNEE) });
    const intent = makeIntent({ status: "DISPATCHED" });
    await store.putIfAbsent(intent);

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "NOOP_NOT_PENDING" });
  });

  it("item inactive -> CANCELLED, cancelledChannels recorded with ITEM_INACTIVE", async () => {
    await seed({ item: makeItem({ status: "ARCHIVED" }), entitlements: defaultEntitlements(), preferences: defaultPreferences(ASSIGNEE) });
    const intent = makeIntent();
    await store.putIfAbsent(intent);

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "CANCELLED", reason: "ITEM_INACTIVE" });

    const updatedIntent = await store.get<NotificationIntent>({ PK: intent.PK, SK: intent.SK });
    expect(updatedIntent?.status).toBe("CANCELLED");
    expect(updatedIntent?.cancelledChannels).toEqual([{ channel: "EMAIL", reason: "ITEM_INACTIVE" }]);
  });

  it("item version stale, no prior attempt -> STALE_REPLACEMENT, creates a new REPLACEMENT intent, cancels the old one", async () => {
    await seed({ item: makeItem({ version: 4 }), entitlements: defaultEntitlements(), preferences: defaultPreferences(ASSIGNEE) });
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

  // Wave B2B-11: mutação: fazer resolveCandidateUserId retornar QUALQUER string não-vazia como
  // fallback (o antigo `?? tenantId`, ou qualquer outro placeholder) faria este teste falhar - o
  // candidato deixaria de ser vazio, o resolver seria chamado e retornaria o resultado canned em
  // vez de cancelar. Prova que "sem assignee" nunca chega a chamar recipientResolver.resolve() -
  // a checagem `candidateWasEmpty` intercepta antes (verificado manualmente revertendo o fix).
  it("no assigneeUserId at all -> CANCELLED RECIPIENT_NOT_FOUND without ever calling the recipient resolver", async () => {
    let resolveCalled = false;
    resolver.resolve = async () => {
      resolveCalled = true;
      return resolver.result;
    };
    await seed({ item: makeItem({ assigneeUserId: undefined }), entitlements: defaultEntitlements(), preferences: defaultPreferences(ASSIGNEE) });
    const intent = makeIntent();
    await store.putIfAbsent(intent);

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "CANCELLED", reason: "RECIPIENT_NOT_FOUND" });
    expect(resolveCalled).toBe(false);
  });

  it("entitlement record missing (technical gap) -> RETRY, no write at all", async () => {
    await seed({ preferences: defaultPreferences(ASSIGNEE) }); // no entitlements record
    const intent = makeIntent();
    await store.putIfAbsent(intent);

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "RETRY", cause: "ENTITLEMENT_UNAVAILABLE" });

    const unchangedIntent = await store.get<NotificationIntent>({ PK: intent.PK, SK: intent.SK });
    expect(unchangedIntent?.status).toBe("PENDING");
  });

  it("opted out -> CANCELLED OPTED_OUT", async () => {
    await seed({ entitlements: defaultEntitlements(), preferences: defaultPreferences(ASSIGNEE) });
    await store.update({ ...defaultPreferences(ASSIGNEE), emailEnabled: false });
    const intent = makeIntent();
    await store.putIfAbsent(intent);

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "CANCELLED", reason: "OPTED_OUT" });
  });

  // D-200 (watcher notification fan-out).
  const WATCHER = "watcher-1";

  it("targetKind WATCHER + ItemWatch ACTIVE -> routes to the watcher, recipientUserId set to the watcher (not the assignee)", async () => {
    await seed({ entitlements: defaultEntitlements(), preferences: defaultPreferences(WATCHER) });
    await store.putIfAbsent({ ...itemWatchKey(AUTH_TENANT, ITEM_ID, WATCHER), entityType: "ItemWatch", itemId: ITEM_ID, tenantId: TENANT, userId: WATCHER, status: "ACTIVE", createdAt: NOW, updatedAt: NOW, version: 1 });
    resolver.result = { userId: WATCHER, tenantId: TENANT, active: true };
    const intent = makeIntent({ targetKind: "WATCHER", targetUserId: WATCHER });
    await store.putIfAbsent(intent);

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "ROUTED", routedChannels: ["EMAIL"] });

    const updatedIntent = await store.get<NotificationIntent>({ PK: intent.PK, SK: intent.SK });
    expect(updatedIntent?.recipientUserId).toBe(WATCHER);
  });

  it("targetKind WATCHER but the ItemWatch was removed since dispatch -> CANCELLED RECIPIENT_NOT_FOUND, never trusts the creation-time value", async () => {
    let resolveCalled = false;
    resolver.resolve = async () => {
      resolveCalled = true;
      return resolver.result;
    };
    await seed({ entitlements: defaultEntitlements(), preferences: defaultPreferences(WATCHER) });
    await store.putIfAbsent({ ...itemWatchKey(AUTH_TENANT, ITEM_ID, WATCHER), entityType: "ItemWatch", itemId: ITEM_ID, tenantId: TENANT, userId: WATCHER, status: "REMOVED", createdAt: NOW, updatedAt: NOW, version: 2 });
    const intent = makeIntent({ targetKind: "WATCHER", targetUserId: WATCHER });
    await store.putIfAbsent(intent);

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "CANCELLED", reason: "RECIPIENT_NOT_FOUND" });
    expect(resolveCalled).toBe(false);
  });

  it("STALE WATCHER intent -> the REPLACEMENT intent preserves targetKind/targetUserId, never degrades to ASSIGNEE (Rodada 1 Codex finding)", async () => {
    await seed({ item: makeItem({ version: 4 }), entitlements: defaultEntitlements(), preferences: defaultPreferences(WATCHER) });
    const intent = makeIntent({ targetKind: "WATCHER", targetUserId: WATCHER }); // itemVersion: 3, item is now version 4
    await store.putIfAbsent(intent);

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "STALE_REPLACEMENT" });

    const all = store.allItems();
    const newIntent = all.find((i) => i["entityType"] === "NotificationIntent" && i["intentId"] !== intent.intentId) as unknown as NotificationIntent;
    expect(newIntent).toBeDefined();
    expect(newIntent.targetKind).toBe("WATCHER");
    expect(newIntent.targetUserId).toBe(WATCHER);
  });

  // D-201 (MANAGER escalation).
  const MANAGER = "manager-1";

  it("targetKind MANAGER + isActiveManager true -> routes to the manager, recipientUserId set to the manager", async () => {
    await seed({ entitlements: defaultEntitlements(), preferences: defaultPreferences(MANAGER) });
    managerLookup.activeManagers.add(MANAGER);
    resolver.result = { userId: MANAGER, tenantId: TENANT, active: true };
    const intent = makeIntent({ targetKind: "MANAGER", targetUserId: MANAGER });
    await store.putIfAbsent(intent);

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "ROUTED", routedChannels: ["EMAIL"] });

    const updatedIntent = await store.get<NotificationIntent>({ PK: intent.PK, SK: intent.SK });
    expect(updatedIntent?.recipientUserId).toBe(MANAGER);
  });

  it("targetKind MANAGER but demoted/removed since dispatch -> CANCELLED RECIPIENT_NOT_FOUND, never trusts the creation-time value", async () => {
    let resolveCalled = false;
    resolver.resolve = async () => {
      resolveCalled = true;
      return resolver.result;
    };
    await seed({ entitlements: defaultEntitlements(), preferences: defaultPreferences(MANAGER) });
    // managerLookup.activeManagers deliberately left empty - simulates demotion/removal.
    const intent = makeIntent({ targetKind: "MANAGER", targetUserId: MANAGER });
    await store.putIfAbsent(intent);

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "CANCELLED", reason: "RECIPIENT_NOT_FOUND" });
    expect(resolveCalled).toBe(false);
  });

  it("targetKind MANAGER with empty targetUserId (defensive dispatch-time sentinel, no eligible manager existed) -> CANCELLED RECIPIENT_NOT_FOUND, never falls back to the assignee", async () => {
    await seed({ item: makeItem({ assigneeUserId: ASSIGNEE }), entitlements: defaultEntitlements(), preferences: defaultPreferences(ASSIGNEE) });
    const intent = makeIntent({ targetKind: "MANAGER", targetUserId: "" });
    await store.putIfAbsent(intent);

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "CANCELLED", reason: "RECIPIENT_NOT_FOUND" });
  });

  it("STALE MANAGER intent -> the REPLACEMENT intent preserves targetKind/targetUserId, never degrades to ASSIGNEE", async () => {
    await seed({ item: makeItem({ version: 4 }), entitlements: defaultEntitlements(), preferences: defaultPreferences(MANAGER) });
    const intent = makeIntent({ targetKind: "MANAGER", targetUserId: MANAGER }); // itemVersion: 3, item is now version 4
    await store.putIfAbsent(intent);

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "STALE_REPLACEMENT" });

    const all = store.allItems();
    const newIntent = all.find((i) => i["entityType"] === "NotificationIntent" && i["intentId"] !== intent.intentId) as unknown as NotificationIntent;
    expect(newIntent).toBeDefined();
    expect(newIntent.targetKind).toBe("MANAGER");
    expect(newIntent.targetUserId).toBe(MANAGER);
  });
});
