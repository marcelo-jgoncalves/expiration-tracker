/**
 * D-149: HTTP-layer mapping for GET /activity - activity-service.test.ts already proves
 * ActivityService.listActivity() throws AuthorizationDeniedError for MEMBER/VIEWER; this
 * covers the HTTP boundary's own job, that withErrorMapping() turns that into a real 403
 * (not a 500 or an uncaught throw), same convention as item-handlers.test.ts.
 */
import { describe, expect, it } from "vitest";
import { handleListActivity, type ActivityHttpDeps } from "../../../src/modules/activity/http/activity-handlers.js";
import { ActivityService } from "../../../src/modules/activity/application/activity-service.js";
import type { AuditPartitionStore, AuditPartitionPageInput, AuditPartitionPage } from "../../../src/modules/activity/ports/audit-partition-store.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import type { EntityKey } from "../../../src/shared/dynamodb/occ.js";
import type { RequestContextResolver, ValidatedClaims } from "../../../src/modules/identity/application/resolve-request-context.js";
import type { TenantQuotaService } from "../../../src/modules/identity/application/quota.js";

class EmptyAuditPartitionStore implements AuditPartitionStore {
  async queryPage<T extends EntityKey = Record<string, unknown> & EntityKey>(_input: AuditPartitionPageInput): Promise<AuditPartitionPage<T>> {
    return { items: [] };
  }
}

function fakeResolver(context: RequestContext): RequestContextResolver {
  return { resolve: async () => context } as unknown as RequestContextResolver;
}

function fakeQuota(): TenantQuotaService {
  return { consume: async () => undefined } as unknown as TenantQuotaService;
}

function ctx(roles: string[]): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-a", cognitoSubject: "sub-a", sessionId: "s1" },
    tenant: { tenantId: "tenant-a", roles: roles as RequestContext["tenant"]["roles"] },
    auth: { issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T01:00:00.000Z", tokenId: "t1" },
  };
}

function claims(): ValidatedClaims {
  return { sub: "sub-a", tokenId: "jti", issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T01:00:00.000Z" };
}

describe("handleListActivity (D-149 HTTP boundary)", () => {
  it("denies MEMBER with a real 403, not a 500 or an uncaught throw", async () => {
    const deps: ActivityHttpDeps = {
      resolver: fakeResolver(ctx(["MEMBER"])),
      activity: new ActivityService({ store: new EmptyAuditPartitionStore() }),
      quota: fakeQuota(),
    };
    const res = await handleListActivity(deps, { requestId: "r1", correlationId: "c1", claims: claims(), queryStringParameters: {} });
    expect(res.statusCode).toBe(403);
  });

  it("allows ADMIN with a 200 and an empty feed", async () => {
    const deps: ActivityHttpDeps = {
      resolver: fakeResolver(ctx(["ADMIN"])),
      activity: new ActivityService({ store: new EmptyAuditPartitionStore() }),
      quota: fakeQuota(),
    };
    const res = await handleListActivity(deps, { requestId: "r1", correlationId: "c1", claims: claims(), queryStringParameters: {} });
    expect(res.statusCode).toBe(200);
    expect(res.body["entries"]).toEqual([]);
    expect(res.body["hasMore"]).toBe(false);
  });

  it("rejects a malformed limit before ever resolving the request context (fail-closed at the schema edge)", async () => {
    const deps: ActivityHttpDeps = {
      resolver: fakeResolver(ctx(["ADMIN"])),
      activity: new ActivityService({ store: new EmptyAuditPartitionStore() }),
      quota: fakeQuota(),
    };
    const res = await handleListActivity(deps, { requestId: "r1", correlationId: "c1", claims: claims(), queryStringParameters: { limit: "-1" } });
    expect(res.statusCode).toBe(400);
  });
});
