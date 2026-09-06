/**
 * D-213: HTTP-layer mapping for the ReportSubscription CRUD routes (POST/GET /reports/
 * subscriptions, GET/POST .../{subscriptionId}[/delete]). report-subscription-service.test.ts
 * already proves the service mechanism itself exhaustively - this covers the HTTP boundary's own
 * job: schema validation rejects malformed bodies with a real 400 before the service is ever
 * called, missing path params are rejected, and a successful call's result is shaped into the
 * JSON response, same convention as bulk-action-handlers.test.ts.
 */
import { describe, expect, it } from "vitest";
import { InMemoryReportSubscriptionStore } from "./in-memory-store.js";
import { ReportSubscriptionService } from "../../../src/modules/reports/application/report-subscription-service.js";
import type { ReportSubscriptionIdGenerator } from "../../../src/modules/reports/application/id-generator.js";
import {
  handleCreateReportSubscription,
  handleDeleteReportSubscription,
  handleDownloadReportSubscriptionRun,
  handleGetReportSubscription,
  handleListReportSubscriptions,
  type HttpRequest,
  type ReportsHttpDeps,
} from "../../../src/modules/reports/http/reports-handler.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import type { RequestContextResolver, ValidatedClaims } from "../../../src/modules/identity/application/resolve-request-context.js";
import type { TenantQuotaService } from "../../../src/modules/identity/application/quota.js";
import { tenantLifecycleKey } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";
import { reportSubscriptionRunKey, type ReportSubscriptionRun } from "../../../src/modules/reports/domain/report-subscription-run.js";
import { reportDeliveryAttemptKey, type ReportDeliveryAttempt } from "../../../src/modules/reports/domain/report-delivery-attempt.js";
import type { ReportExportStore } from "../../../src/modules/reports/ports/report-export-store.js";

const TENANT = "tenant-1";
const NOW = "2026-09-09T10:00:00.000Z";

function fakeResolver(context: RequestContext): RequestContextResolver {
  return { resolve: async () => context } as unknown as RequestContextResolver;
}

function fakeQuota(): TenantQuotaService {
  return { consume: async () => undefined } as unknown as TenantQuotaService;
}

function ctx(roles: string[] = ["OWNER"]): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-a", cognitoSubject: "sub-a", sessionId: "s1" },
    tenant: { tenantId: TENANT, roles: roles as RequestContext["tenant"]["roles"] },
    auth: { issuedAt: NOW, expiresAt: "2026-09-09T11:00:00.000Z", tokenId: "t1" },
  };
}

function claims(): ValidatedClaims {
  return { sub: "sub-a", tokenId: "jti", issuedAt: NOW, expiresAt: "2026-09-09T11:00:00.000Z" };
}

function baseReq<T>(body?: T, pathParameters?: Record<string, string>): HttpRequest<T> {
  return { requestId: "r1", correlationId: "c1", claims: claims(), body, pathParameters };
}

function activeLifecycleRecord(): Record<string, unknown> & EntityKey {
  return { ...(tenantLifecycleKey(TENANT) as unknown as EntityKey), entityType: "TenantLifecycleRecord", tenantId: TENANT, status: "ACTIVE", createdAt: NOW, updatedAt: NOW, version: 1 };
}

function makeIds(): ReportSubscriptionIdGenerator {
  let n = 0;
  return { newReportSubscriptionId: () => `reportsub-${++n}` };
}

function buildDeps(): ReportsHttpDeps {
  const store = new InMemoryReportSubscriptionStore([activeLifecycleRecord()]);
  const subscriptions = new ReportSubscriptionService({ store, tableName: "test-table", ids: makeIds(), now: () => NOW });
  return { resolver: fakeResolver(ctx()), reports: undefined as never, subscriptions, quota: fakeQuota() };
}

const VALID_BODY = { reportTypes: ["EXPIRED_ITEMS"] as const, dayOfWeek: 3, localTime: "09:00", timeZone: "UTC", recipientUserIds: ["user-a"] };

describe("handleCreateReportSubscription (D-213 HTTP boundary)", () => {
  it("rejects a missing body with a real 400", async () => {
    const response = await handleCreateReportSubscription(buildDeps(), baseReq<never>(undefined));
    expect(response.statusCode).toBe(400);
  });

  it("rejects a body missing recipientUserIds (required field) with a real 400 before touching the service", async () => {
    const response = await handleCreateReportSubscription(buildDeps(), baseReq({ reportTypes: ["EXPIRED_ITEMS"], dayOfWeek: 3, localTime: "09:00", timeZone: "UTC" } as never));
    expect(response.statusCode).toBe(400);
  });

  it("rejects a body with an unknown extra property (additionalProperties:false)", async () => {
    const response = await handleCreateReportSubscription(buildDeps(), baseReq({ ...VALID_BODY, extra: "nope" }));
    expect(response.statusCode).toBe(400);
  });

  it("accepts a valid body and returns 201 with the created subscription", async () => {
    const response = await handleCreateReportSubscription(buildDeps(), baseReq(VALID_BODY));
    expect(response.statusCode).toBe(201);
    expect((response.body["subscription"] as { subscriptionId: string }).subscriptionId).toBeTruthy();
  });
});

describe("handleGetReportSubscription / handleListReportSubscriptions (D-213 HTTP boundary)", () => {
  it("returns 400 when subscriptionId path parameter is missing", async () => {
    const response = await handleGetReportSubscription(buildDeps(), baseReq());
    expect(response.statusCode).toBe(400);
  });

  it("returns 404 for a subscription that doesn't exist", async () => {
    const response = await handleGetReportSubscription(buildDeps(), baseReq(undefined, { subscriptionId: "nope" }));
    expect(response.statusCode).toBe(404);
  });

  it("gets a created subscription and lists it", async () => {
    const deps = buildDeps();
    const created = await handleCreateReportSubscription(deps, baseReq(VALID_BODY));
    const subscriptionId = (created.body["subscription"] as { subscriptionId: string }).subscriptionId;

    const got = await handleGetReportSubscription(deps, baseReq(undefined, { subscriptionId }));
    expect(got.statusCode).toBe(200);
    expect((got.body["subscription"] as { subscriptionId: string }).subscriptionId).toBe(subscriptionId);

    const listed = await handleListReportSubscriptions(deps, baseReq());
    expect(listed.statusCode).toBe(200);
    expect((listed.body["subscriptions"] as { subscriptionId: string }[]).map((s) => s.subscriptionId)).toEqual([subscriptionId]);
  });
});

describe("handleDeleteReportSubscription (D-213 HTTP boundary)", () => {
  it("rejects a missing body with a real 400", async () => {
    const response = await handleDeleteReportSubscription(buildDeps(), baseReq<never>(undefined, { subscriptionId: "sub-1" }));
    expect(response.statusCode).toBe(400);
  });

  it("deletes an existing subscription, returning 204", async () => {
    const deps = buildDeps();
    const created = await handleCreateReportSubscription(deps, baseReq(VALID_BODY));
    const subscription = created.body["subscription"] as { subscriptionId: string; version: number };

    const response = await handleDeleteReportSubscription(deps, baseReq({ expectedVersion: subscription.version }, { subscriptionId: subscription.subscriptionId }));
    expect(response.statusCode).toBe(204);

    const getAfterDelete = await handleGetReportSubscription(deps, baseReq(undefined, { subscriptionId: subscription.subscriptionId }));
    expect(getAfterDelete.statusCode).toBe(404);
  });

  it("returns 409 for a stale expectedVersion", async () => {
    const deps = buildDeps();
    const created = await handleCreateReportSubscription(deps, baseReq(VALID_BODY));
    const subscription = created.body["subscription"] as { subscriptionId: string; version: number };

    const response = await handleDeleteReportSubscription(deps, baseReq({ expectedVersion: subscription.version + 1 }, { subscriptionId: subscription.subscriptionId }));
    expect(response.statusCode).toBe(409);
  });
});

describe("handleDownloadReportSubscriptionRun (D-204 decisions 6-7, fatia 3)", () => {
  const RUN_ID = "run-1";
  const SUBSCRIPTION_ID = "sub-1";

  function fakeExportStore(): ReportExportStore & { presignCalls: number } {
    return {
      presignCalls: 0,
      async putCsv(input) {
        return { key: `k-${input.runId}` };
      },
      async presignDownload() {
        this.presignCalls += 1;
        return "https://example.com/presigned";
      },
    };
  }

  async function buildDepsWithRun(input: { principalUserId?: string; roles?: string[]; recipientUserId?: string } = {}) {
    const store = new InMemoryReportSubscriptionStore([activeLifecycleRecord()]);
    const run: ReportSubscriptionRun = {
      ...reportSubscriptionRunKey(TENANT, SUBSCRIPTION_ID, RUN_ID),
      entityType: "ReportSubscriptionRun",
      runId: RUN_ID,
      subscriptionId: SUBSCRIPTION_ID,
      tenantId: TENANT,
      scheduledFor: NOW,
      reportTypes: ["EXPIRED_ITEMS"],
      recipientUserIds: [input.recipientUserId ?? "user-b"],
      createdAt: NOW,
    };
    const attempt: ReportDeliveryAttempt = {
      ...reportDeliveryAttemptKey(TENANT, SUBSCRIPTION_ID, RUN_ID, input.recipientUserId ?? "user-b"),
      entityType: "ReportDeliveryAttempt",
      tenantId: TENANT,
      subscriptionId: SUBSCRIPTION_ID,
      runId: RUN_ID,
      recipientUserId: input.recipientUserId ?? "user-b",
      status: "ACCEPTED",
      providerMessageId: "ses-1",
      version: 2,
      createdAt: NOW,
      updatedAt: NOW,
    };
    await store.transactWrite([{ Put: { TableName: "test-table", Item: run as unknown as Record<string, unknown> & EntityKey, ConditionExpression: "attribute_not_exists(PK)" } }]);
    await store.transactWrite([{ Put: { TableName: "test-table", Item: attempt as unknown as Record<string, unknown> & EntityKey, ConditionExpression: "attribute_not_exists(PK)" } }]);
    const exportStore = fakeExportStore();
    const principalCtx = ctx(input.roles ?? ["OWNER"]);
    const contextWithUser: RequestContext = { ...principalCtx, principal: { ...principalCtx.principal, userId: input.principalUserId ?? principalCtx.principal.userId } };
    const deps: ReportsHttpDeps = { resolver: fakeResolver(contextWithUser), reports: undefined as never, subscriptions: undefined as never, quota: fakeQuota(), subscriptionStore: store, exportStore };
    return { deps, exportStore };
  }

  it("surfaces a loud 500 (never a silent success) when subscriptionStore/exportStore are not wired - a composition bug, not a client error", async () => {
    const deps: ReportsHttpDeps = { resolver: fakeResolver(ctx()), reports: undefined as never, subscriptions: undefined as never, quota: fakeQuota() };
    const response = await handleDownloadReportSubscriptionRun(deps, baseReq(undefined, { subscriptionId: SUBSCRIPTION_ID, runId: RUN_ID }));
    expect(response.statusCode).toBe(500);
  });

  it("returns 404 when the run doesn't exist", async () => {
    const { deps } = await buildDepsWithRun();
    const response = await handleDownloadReportSubscriptionRun(deps, baseReq(undefined, { subscriptionId: SUBSCRIPTION_ID, runId: "nope" }));
    expect(response.statusCode).toBe(404);
  });

  it("ADMIN_ROLES principal can download even when NOT a recipient of the run", async () => {
    const { deps, exportStore } = await buildDepsWithRun({ principalUserId: "admin-user", roles: ["OWNER"], recipientUserId: "user-b" });
    const response = await handleDownloadReportSubscriptionRun(deps, baseReq(undefined, { subscriptionId: SUBSCRIPTION_ID, runId: RUN_ID }));
    expect(response.statusCode).toBe(200);
    expect(response.body["downloadUrl"]).toBe("https://example.com/presigned");
    expect(exportStore.presignCalls).toBe(1);
  });

  it("a MEMBER who IS a real recipient of this run (per ReportDeliveryAttempt) can download", async () => {
    const { deps } = await buildDepsWithRun({ principalUserId: "user-b", roles: ["MEMBER"], recipientUserId: "user-b" });
    const response = await handleDownloadReportSubscriptionRun(deps, baseReq(undefined, { subscriptionId: SUBSCRIPTION_ID, runId: RUN_ID }));
    expect(response.statusCode).toBe(200);
  });

  it("a MEMBER who is NOT a recipient of this run is denied with 403 (never falls back to admin just because a run exists)", async () => {
    const { deps } = await buildDepsWithRun({ principalUserId: "some-other-member", roles: ["MEMBER"], recipientUserId: "user-b" });
    const response = await handleDownloadReportSubscriptionRun(deps, baseReq(undefined, { subscriptionId: SUBSCRIPTION_ID, runId: RUN_ID }));
    expect(response.statusCode).toBe(403);
  });
});
