import { describe, expect, it } from "vitest";
import { ReportSubscriptionService } from "../../../src/modules/reports/application/report-subscription-service.js";
import type { ReportSubscriptionIdGenerator } from "../../../src/modules/reports/application/id-generator.js";
import { InMemoryReportSubscriptionStore } from "./in-memory-store.js";
import { ConflictError, NotFoundError } from "../../../src/shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import { tenantLifecycleKey } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { reportSubscriptionKey, type ReportSubscription } from "../../../src/modules/reports/domain/report-subscription.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";

const TENANT = "tenant-1";
const NOW = "2026-09-09T10:00:00.000Z"; // Wednesday.

function makeIds(): ReportSubscriptionIdGenerator {
  let n = 0;
  return { newReportSubscriptionId: () => `reportsub-${++n}` };
}

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-1", cognitoSubject: "sub-1", sessionId: "session-1" },
    tenant: { tenantId: TENANT, roles: ["ADMIN"] },
    auth: { issuedAt: NOW, expiresAt: new Date(Date.parse(NOW) + 60_000).toISOString(), tokenId: "jti-1" },
    ...overrides,
  };
}

function ctxAs(roles: string[]): RequestContext {
  return ctx({ tenant: { tenantId: TENANT, roles } });
}

function activeLifecycleRecord(): Record<string, unknown> & EntityKey {
  return {
    ...(tenantLifecycleKey(TENANT) as unknown as EntityKey),
    entityType: "TenantLifecycleRecord",
    tenantId: TENANT,
    status: "ACTIVE",
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
  };
}

function makeService(seed: (Record<string, unknown> & EntityKey)[] = []) {
  const store = new InMemoryReportSubscriptionStore([activeLifecycleRecord(), ...seed]);
  const service = new ReportSubscriptionService({ store, tableName: "test-table", ids: makeIds(), now: () => NOW });
  return { service, store };
}

const VALID_INPUT = {
  reportTypes: ["EXPIRED_ITEMS"] as const,
  dayOfWeek: 3,
  localTime: "09:00",
  timeZone: "UTC",
  recipientUserIds: ["user-a"],
};

describe("ReportSubscriptionService.createSubscription (D-213)", () => {
  it("creates a subscription with nextRunAt computed as the next occurrence strictly after now", async () => {
    const { service, store } = makeService();
    const subscription = await service.createSubscription(ctx(), VALID_INPUT);
    expect(subscription.nextRunAt).toBe("2026-09-16T09:00:00.000Z"); // next Wednesday 09:00 UTC after NOW.
    expect(subscription.version).toBe(1);
    expect(subscription.createdBy).toBe("user-1");

    const stored = await store.get<ReportSubscription>(reportSubscriptionKey(TENANT, subscription.subscriptionId));
    expect(stored).toEqual(subscription);
  });

  it("rejects a non-ADMIN/OWNER caller", async () => {
    const { service } = makeService();
    await expect(service.createSubscription(ctxAs(["MEMBER"]), VALID_INPUT)).rejects.toThrow(AuthorizationDeniedError);
  });

  it("rejects invalid domain input (empty reportTypes) via validateReportSubscriptionInput", async () => {
    const { service } = makeService();
    await expect(service.createSubscription(ctx(), { ...VALID_INPUT, reportTypes: [] })).rejects.toThrow(/reportTypes/);
  });

  it("rejects an out-of-range dayOfWeek", async () => {
    const { service } = makeService();
    await expect(service.createSubscription(ctx(), { ...VALID_INPUT, dayOfWeek: 8 })).rejects.toThrow(/dayOfWeek/);
  });

  it("rejects a malformed localTime", async () => {
    const { service } = makeService();
    await expect(service.createSubscription(ctx(), { ...VALID_INPUT, localTime: "9:00" })).rejects.toThrow(/localTime/);
  });

  it("rejects an unrecognized IANA timeZone", async () => {
    const { service } = makeService();
    await expect(service.createSubscription(ctx(), { ...VALID_INPUT, timeZone: "Not/AZone" })).rejects.toThrow(/timeZone/);
  });
});

describe("ReportSubscriptionService.getSubscription / listSubscriptions (D-213)", () => {
  it("gets a subscription by id", async () => {
    const { service } = makeService();
    const created = await service.createSubscription(ctx(), VALID_INPUT);
    const fetched = await service.getSubscription(ctx(), created.subscriptionId);
    expect(fetched).toEqual(created);
  });

  it("throws NotFoundError for a missing subscription", async () => {
    const { service } = makeService();
    await expect(service.getSubscription(ctx(), "does-not-exist")).rejects.toThrow(NotFoundError);
  });

  it("lists every subscription for the tenant via GSI1, ordered by createdAt", async () => {
    const { service } = makeService();
    const first = await service.createSubscription(ctx(), VALID_INPUT);
    const second = await service.createSubscription(ctx(), { ...VALID_INPUT, dayOfWeek: 5 });
    const { items } = await service.listSubscriptions(ctx());
    expect(items.map((s) => s.subscriptionId)).toEqual([first.subscriptionId, second.subscriptionId]);
  });
});

describe("ReportSubscriptionService.deleteSubscription (D-213)", () => {
  it("deletes an existing subscription", async () => {
    const { service, store } = makeService();
    const created = await service.createSubscription(ctx(), VALID_INPUT);
    await service.deleteSubscription(ctx(), created.subscriptionId, created.version);
    expect(await store.get(reportSubscriptionKey(TENANT, created.subscriptionId))).toBeUndefined();
  });

  it("throws NotFoundError deleting a subscription that never existed", async () => {
    const { service } = makeService();
    await expect(service.deleteSubscription(ctx(), "does-not-exist", 1)).rejects.toThrow(NotFoundError);
  });

  it("throws ConflictError when expectedVersion is stale", async () => {
    const { service } = makeService();
    const created = await service.createSubscription(ctx(), VALID_INPUT);
    await expect(service.deleteSubscription(ctx(), created.subscriptionId, created.version + 1)).rejects.toThrow(ConflictError);
  });
});

describe("ReportSubscriptionService.listSubscriptionRuns (D-293, A16 execution-history gap)", () => {
  function runRow(subscriptionId: string, runId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> & EntityKey {
    const pk = reportSubscriptionKey(TENANT, subscriptionId).PK;
    return {
      PK: pk,
      SK: `RUN#${runId}`,
      entityType: "ReportSubscriptionRun",
      runId,
      subscriptionId,
      tenantId: TENANT,
      scheduledFor: "2026-09-09T09:00:00.000Z",
      reportTypes: ["EXPIRED_ITEMS"],
      recipientUserIds: ["user-a"],
      createdAt: NOW,
      purgeAfterTtl: 9999999999,
      ...overrides,
    };
  }

  function attemptRow(subscriptionId: string, runId: string, recipientUserId: string, status: string): Record<string, unknown> & EntityKey {
    const pk = `${reportSubscriptionKey(TENANT, subscriptionId).PK}#RUN#${runId}`;
    return {
      PK: pk,
      SK: `ATTEMPT#${recipientUserId}`,
      entityType: "ReportDeliveryAttempt",
      tenantId: TENANT,
      subscriptionId,
      runId,
      recipientUserId,
      status,
      version: 1,
      createdAt: NOW,
      updatedAt: NOW,
      purgeAfterTtl: 9999999999,
    };
  }

  it("merges ReportSubscriptionRun rows with their ReportDeliveryAttempt outcome counts, most recent run first", async () => {
    const subscriptionId = "reportsub-1";
    const { service } = makeService([
      { ...reportSubscriptionKey(TENANT, subscriptionId), entityType: "ReportSubscription", subscriptionId, tenantId: TENANT, reportTypes: ["EXPIRED_ITEMS"], cadence: "WEEKLY", dayOfWeek: 3, localTime: "09:00", timeZone: "UTC", recipientUserIds: ["user-a", "user-b"], createdBy: "user-1", nextRunAt: "2026-09-16T09:00:00.000Z", version: 1, createdAt: NOW, updatedAt: NOW },
      runRow(subscriptionId, "01ARZ3NDEKTSV4RRFFQ69G5FAV", { recipientUserIds: ["user-a", "user-b"] }),
      runRow(subscriptionId, "01ARZ3NDEKTSV4RRFFQ69G5FBW", { scheduledFor: "2026-09-16T09:00:00.000Z" }),
      attemptRow(subscriptionId, "01ARZ3NDEKTSV4RRFFQ69G5FAV", "user-a", "ACCEPTED"),
      attemptRow(subscriptionId, "01ARZ3NDEKTSV4RRFFQ69G5FAV", "user-b", "FAILED_TERMINAL"),
    ]);

    const runs = await service.listSubscriptionRuns(ctx(), subscriptionId);
    expect(runs.map((r) => r.runId)).toEqual(["01ARZ3NDEKTSV4RRFFQ69G5FBW", "01ARZ3NDEKTSV4RRFFQ69G5FAV"]); // most recent (higher ULID) first.
    const firstRun = runs.find((r) => r.runId === "01ARZ3NDEKTSV4RRFFQ69G5FAV")!;
    expect(firstRun.attemptCounts).toEqual({ PREPARED: 0, SUBMITTING: 0, ACCEPTED: 1, FAILED_RETRYABLE: 0, FAILED_TERMINAL: 1, UNKNOWN: 0 });
    expect(firstRun.recipientCount).toBe(2);
    const secondRun = runs.find((r) => r.runId === "01ARZ3NDEKTSV4RRFFQ69G5FBW")!;
    expect(secondRun.attemptCounts).toEqual({ PREPARED: 0, SUBMITTING: 0, ACCEPTED: 0, FAILED_RETRYABLE: 0, FAILED_TERMINAL: 0, UNKNOWN: 0 }); // no attempts written yet for this run.
  });

  it("returns an empty array for a real subscription that has never run yet, never an error", async () => {
    const { service } = makeService();
    const created = await service.createSubscription(ctx(), VALID_INPUT);
    const runs = await service.listSubscriptionRuns(ctx(), created.subscriptionId);
    expect(runs).toEqual([]);
  });

  it("throws NotFoundError for a subscription that doesn't exist", async () => {
    const { service } = makeService();
    await expect(service.listSubscriptionRuns(ctx(), "does-not-exist")).rejects.toThrow(NotFoundError);
  });

  it("VIEWER/MEMBER roles are denied (ADMIN-only, same tier as the CRUD - a run's history can include other members' delivery status)", async () => {
    const { service } = makeService();
    const created = await service.createSubscription(ctx(), VALID_INPUT);
    await expect(service.listSubscriptionRuns(ctxAs(["VIEWER"]), created.subscriptionId)).rejects.toThrow(AuthorizationDeniedError);
    await expect(service.listSubscriptionRuns(ctxAs(["MEMBER"]), created.subscriptionId)).rejects.toThrow(AuthorizationDeniedError);
  });
});
