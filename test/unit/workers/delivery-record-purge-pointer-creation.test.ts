/**
 * D-179 slice 8: proves the GSI8 pointer is written EXACTLY ONCE, at creation, at each of the 3
 * real write sites for `NotificationIntent`/`NotificationAttempt`:
 *   - `reminder-dispatch/dispatch.ts` (the M3 EXPIRATION_REMINDER intent)
 *   - `notification-router-workflow.ts`'s `applyStaleDecision` (REPLACEMENT intent, exercised via
 *     `routeNotificationIntent`'s stale-item-version branch)
 *   - `notification-router-workflow.ts`'s `applyRoutedDecision` (the NotificationAttempt)
 * Mirrors D-179/D-187's own "pointer written at the right write path" test. Reuses the same
 * fixture graphs `dispatch.test.ts`/`notification-router-workflow.test.ts` already build (real
 * in-memory stores, not synthetic Puts), so the pointer is proven on the SAME transaction those
 * suites already exercise end-to-end.
 */
import { describe, expect, it } from "vitest";
import { InMemoryReminderStore, makeReminderIdGenerator } from "../reminder/in-memory-store.js";
import { ReminderPolicyService } from "../../../src/modules/reminder/application/reminder-policy-service.js";
import { ReminderMaterializer } from "../../../src/modules/reminder/application/reminder-materializer.js";
import { defaultShardConfig } from "../../../src/modules/reminder/domain/shard-config.js";
import { dispatchOccurrence, type DispatchDeps } from "../../../src/workers/reminder-dispatch/dispatch.js";
import type { DispatchCommand } from "../../../src/workers/reminder-producer/producer.js";
import { itemKey } from "../../../src/modules/expiration/domain/expiration-item.js";
import { buildVersionedUpdate } from "../../../src/shared/dynamodb/occ.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import { InMemoryNotificationStore } from "../notification/in-memory-store.js";
import { routeNotificationIntent, type NotificationRouterWorkflowDeps } from "../../../src/modules/notification/application/notification-router-workflow.js";
import { notificationEntitlementsKey, type NotificationEntitlements } from "../../../src/modules/notification/domain/notification-entitlements.js";
import { notificationPreferencesKey, type NotificationPreferences } from "../../../src/modules/notification/domain/notification-preferences.js";
import type { NotificationIntent } from "../../../src/modules/reminder/domain/notification-intent.js";
import { policyKey, type ReminderPolicy } from "../../../src/modules/reminder/domain/reminder-policy.js";
import type { ExpirationItem } from "../../../src/modules/expiration/domain/expiration-item.js";
import { deriveDeliveryRecordMaintenanceDue } from "../../../src/shared/delivery-record-gsi8.js";

const TENANT = "t1";
const ITEM_ID = "item1";
const TABLE = "MainTable";
const NOW = "2026-08-01T00:00:00.000Z";

function contextFor(tenantId: string): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-user-1", sessionId: "session-1" },
    tenant: { tenantId, roles: ["OWNER"] },
    auth: { issuedAt: NOW, expiresAt: NOW, tokenId: "jti-1" },
  };
}

describe("GSI8 pointer written at creation for NotificationIntent/NotificationAttempt (D-179 slice 8)", () => {
  it("reminder-dispatch stamps GSI8PK=WORK#DELIVERY_RECORD on the NotificationIntent it creates", async () => {
    const store = new InMemoryReminderStore();
    await store.putIfAbsent({
      ...itemKey(TENANT, ITEM_ID),
      entityType: "ExpirationItem",
      itemId: ITEM_ID,
      tenantId: TENANT,
      status: "ACTIVE",
      dueDate: "2026-09-10T00:00:00.000Z",
      version: 1,
    });

    const policies = new ReminderPolicyService({ store, tableName: TABLE, ids: makeReminderIdGenerator(), now: () => NOW });
    const policy = await policies.createPolicy(contextFor(TENANT), {
      scope: "ITEM",
      itemId: ITEM_ID,
      rule: {
        name: "7 days before",
        triggers: [{ triggerId: "trig1", offsetIso: "-P7D", localTime: "09:00" }],
        timeZone: "America/Sao_Paulo",
        channels: ["EMAIL"],
      },
    });

    const materializer = new ReminderMaterializer(store, TABLE, () => NOW);
    const materialized = await materializer.materialize({
      tenantId: TENANT,
      itemId: ITEM_ID,
      itemVersion: 1,
      itemDueDate: "2026-09-10T00:00:00.000Z",
      policy,
      shardConfig: defaultShardConfig(),
    });
    const occurrence = materialized.created[0]!;

    await store.transactWrite([
      {
        Update: buildVersionedUpdate({
          tableName: TABLE,
          key: { PK: occurrence.PK, SK: occurrence.SK },
          tenantId: TENANT,
          expectedVersion: occurrence.version,
          set: { status: "CLAIMED" },
        }),
      },
    ]);

    const command: DispatchCommand = {
      messageVersion: 1,
      messageId: "msg-1",
      createdAt: NOW,
      correlationId: "corr-1",
      commandType: "reminder.dispatch.v1",
      tenantId: TENANT,
      deduplicationKey: occurrence.occurrenceId,
      data: {
        itemId: ITEM_ID,
        occurrenceId: occurrence.occurrenceId,
        occurrenceVersion: occurrence.version + 1,
        scheduledAt: occurrence.scheduledAt,
        itemVersion: 1,
        policyVersion: policy.version,
      },
    };

    const dispatchDeps: DispatchDeps = {
      store,
      tableName: TABLE,
      now: () => occurrence.scheduledAt,
      newIntentId: () => "intent-1",
      newEventId: () => "evt-1",
      correlationId: () => "corr-dispatch",
    };

    const outcome = await dispatchOccurrence(dispatchDeps, command);
    expect(outcome.kind).toBe("TRIGGERED");

    const intent = (await store.get({ PK: `TENANT#${TENANT}#INTENT#intent-1`, SK: "META" })) as unknown as Record<string, unknown>;
    expect(intent).toBeDefined();
    const expectedDue = deriveDeliveryRecordMaintenanceDue({ createdAt: intent["createdAt"] as string }).dueAtIso;
    expect(intent["GSI8PK"]).toBe("WORK#DELIVERY_RECORD");
    expect(intent["GSI8SK"]).toBe(`${expectedDue}#TENANT#${TENANT}#NotificationIntent#META`);
  });

  it("routeNotificationIntent stamps the pointer on both the NotificationAttempt it creates and a REPLACEMENT NotificationIntent", async () => {
    const store = new InMemoryNotificationStore();
    const now = "2026-08-15T00:00:00.000Z";
    const item: ExpirationItem = {
      PK: `TENANT#${TENANT}#ITEM#${ITEM_ID}`,
      SK: "META",
      entityType: "ExpirationItem",
      itemId: ITEM_ID,
      tenantId: TENANT,
      title: "doc",
      status: "ACTIVE",
      dueDate: "2026-09-10",
      assigneeUserId: "user-1",
      version: 4, // bumped past the intent's own itemVersion below - forces STALE_REPLACEMENT
      createdAt: now,
      updatedAt: now,
    } as unknown as ExpirationItem;
    const policy: ReminderPolicy = {
      ...policyKey(TENANT, "policy-1"),
      entityType: "ReminderPolicy",
      policyId: "policy-1",
      tenantId: TENANT,
      scope: "ITEM",
      itemId: ITEM_ID,
      enabled: true,
      channels: ["EMAIL"],
      optOutChannels: [],
      rule: { triggers: [{ triggerId: "trig1", offsetIso: "-P7D", localTime: "09:00" }], timeZone: "America/Sao_Paulo" },
      version: 1,
      createdAt: now,
      updatedAt: now,
    } as unknown as ReminderPolicy;
    const entitlements: NotificationEntitlements = {
      ...notificationEntitlementsKey(TENANT),
      entityType: "NotificationEntitlements",
      tenantId: TENANT,
      email: { enabled: true },
      whatsapp: { enabled: false },
      planVersion: 1,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    const preferences: NotificationPreferences = {
      ...notificationPreferencesKey(TENANT, "user-1"),
      entityType: "NotificationPreferences",
      tenantId: TENANT,
      userId: "user-1",
      emailEnabled: true,
      locale: "pt-BR",
      quietHours: null,
      consentSource: "ONBOARDING",
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await store.putIfAbsent(item);
    await store.putIfAbsent(policy);
    await store.putIfAbsent(entitlements);
    await store.putIfAbsent(preferences);

    const intent: NotificationIntent = {
      PK: `TENANT#${TENANT}#INTENT#intent-orig`,
      SK: "META",
      entityType: "NotificationIntent",
      intentId: "intent-orig",
      tenantId: TENANT,
      kind: "EXPIRATION_REMINDER",
      itemId: ITEM_ID,
      occurrenceId: "occ-1",
      itemVersion: 3, // stale vs. item's real version 4 above
      policyId: "policy-1",
      policyVersion: 1,
      scheduledAt: now,
      requestedChannels: ["EMAIL"],
      status: "PENDING",
      supersedesIntentId: null,
      correctionReason: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await store.putIfAbsent(intent);

    let idCounter = 0;
    const deps: NotificationRouterWorkflowDeps = {
      store,
      tableName: TABLE,
      recipientResolver: { resolve: () => Promise.resolve({ userId: "user-1", tenantId: TENANT, active: true }) },
      now: () => now,
      newAttemptId: () => `attempt-${++idCounter}`,
      newIntentId: () => `newintent-${++idCounter}`,
    } as unknown as NotificationRouterWorkflowDeps;

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "STALE_REPLACEMENT" });

    const all = store.allItems();
    const newIntent = all.find((i) => i["entityType"] === "NotificationIntent" && i["intentId"] !== intent.intentId) as Record<string, unknown>;
    expect(newIntent).toBeDefined();
    const expectedIntentDue = deriveDeliveryRecordMaintenanceDue({ createdAt: newIntent["createdAt"] as string }).dueAtIso;
    expect(newIntent["GSI8PK"]).toBe("WORK#DELIVERY_RECORD");
    expect(newIntent["GSI8SK"]).toBe(`${expectedIntentDue}#TENANT#${TENANT}#NotificationIntent#META`);
  });

  it("routeNotificationIntent stamps the pointer on the NotificationAttempt it creates on the routed happy path", async () => {
    const store = new InMemoryNotificationStore();
    const now = "2026-08-15T00:00:00.000Z";
    const item: ExpirationItem = {
      PK: `TENANT#${TENANT}#ITEM#${ITEM_ID}`,
      SK: "META",
      entityType: "ExpirationItem",
      itemId: ITEM_ID,
      tenantId: TENANT,
      title: "doc",
      status: "ACTIVE",
      dueDate: "2026-09-10",
      assigneeUserId: "user-1",
      version: 3,
      createdAt: now,
      updatedAt: now,
    } as unknown as ExpirationItem;
    const policy: ReminderPolicy = {
      ...policyKey(TENANT, "policy-1"),
      entityType: "ReminderPolicy",
      policyId: "policy-1",
      tenantId: TENANT,
      scope: "ITEM",
      itemId: ITEM_ID,
      enabled: true,
      channels: ["EMAIL"],
      optOutChannels: [],
      rule: { triggers: [{ triggerId: "trig1", offsetIso: "-P7D", localTime: "09:00" }], timeZone: "America/Sao_Paulo" },
      version: 1,
      createdAt: now,
      updatedAt: now,
    } as unknown as ReminderPolicy;
    const entitlements: NotificationEntitlements = {
      ...notificationEntitlementsKey(TENANT),
      entityType: "NotificationEntitlements",
      tenantId: TENANT,
      email: { enabled: true },
      whatsapp: { enabled: false },
      planVersion: 1,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    const preferences: NotificationPreferences = {
      ...notificationPreferencesKey(TENANT, "user-1"),
      entityType: "NotificationPreferences",
      tenantId: TENANT,
      userId: "user-1",
      emailEnabled: true,
      locale: "pt-BR",
      quietHours: null,
      consentSource: "ONBOARDING",
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await store.putIfAbsent(item);
    await store.putIfAbsent(policy);
    await store.putIfAbsent(entitlements);
    await store.putIfAbsent(preferences);

    const intent: NotificationIntent = {
      PK: `TENANT#${TENANT}#INTENT#intent-1`,
      SK: "META",
      entityType: "NotificationIntent",
      intentId: "intent-1",
      tenantId: TENANT,
      kind: "EXPIRATION_REMINDER",
      itemId: ITEM_ID,
      occurrenceId: "occ-1",
      itemVersion: 3,
      policyId: "policy-1",
      policyVersion: 1,
      scheduledAt: now,
      requestedChannels: ["EMAIL"],
      status: "PENDING",
      supersedesIntentId: null,
      correctionReason: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await store.putIfAbsent(intent);

    let idCounter = 0;
    const deps: NotificationRouterWorkflowDeps = {
      store,
      tableName: TABLE,
      recipientResolver: { resolve: () => Promise.resolve({ userId: "user-1", tenantId: TENANT, active: true }) },
      now: () => now,
      newAttemptId: () => `attempt-${++idCounter}`,
      newIntentId: () => `newintent-${++idCounter}`,
    } as unknown as NotificationRouterWorkflowDeps;

    const outcome = await routeNotificationIntent(deps, intent);
    expect(outcome).toEqual({ kind: "ROUTED", routedChannels: ["EMAIL"] });

    const all = store.allItems();
    const attempt = all.find((i) => i["entityType"] === "NotificationAttempt") as Record<string, unknown>;
    expect(attempt).toBeDefined();
    const expectedAttemptDue = deriveDeliveryRecordMaintenanceDue({ createdAt: attempt["createdAt"] as string }).dueAtIso;
    expect(attempt["GSI8PK"]).toBe("WORK#DELIVERY_RECORD");
    expect(attempt["GSI8SK"]).toBe(`${expectedAttemptDue}#TENANT#${TENANT}#NotificationAttempt#${attempt["SK"]}`);
  });
});
