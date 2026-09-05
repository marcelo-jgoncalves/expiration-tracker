/**
 * D-206/D-207: HTTP-layer mapping for POST /items/bulk-reassign and POST /items/bulk-archive.
 * expiration-service.test.ts already proves the fan-out/reconciliation/RBAC mechanism itself
 * (bulkReassignItems/bulkArchiveItems) exhaustively - this covers the HTTP boundary's own job:
 * schema validation rejects malformed bodies with a real 400 before the service is ever
 * called, and a successful call's per-item outcomes are shaped into the JSON response,
 * same convention as activity-handlers.test.ts/item-handlers.ts.
 */
import { describe, expect, it } from "vitest";
import { InMemoryExpirationStore, activeLifecycleRecord, makeExpirationIdGenerator, allowAllMemberEligibilityChecker } from "./in-memory-store.js";
import { ExpirationService } from "../../../src/modules/expiration/application/expiration-service.js";
import { handleBulkArchiveItems, handleBulkReassignItems } from "../../../src/modules/expiration/http/bulk-action-handlers.js";
import type { ExpirationHttpDeps, HttpRequest } from "../../../src/modules/expiration/http/item-handlers.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import type { RequestContextResolver, ValidatedClaims } from "../../../src/modules/identity/application/resolve-request-context.js";
import type { TenantQuotaService } from "../../../src/modules/identity/application/quota.js";

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
    tenant: { tenantId: "tenant-1", roles: roles as RequestContext["tenant"]["roles"] },
    auth: { issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T01:00:00.000Z", tokenId: "t1" },
  };
}

function claims(): ValidatedClaims {
  return { sub: "sub-a", tokenId: "jti", issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T01:00:00.000Z" };
}

function baseReq<T>(body?: T): HttpRequest<T> {
  return { requestId: "r1", correlationId: "c1", claims: claims(), body };
}

describe("bulk-action-handlers (D-206/D-207 HTTP boundary)", () => {
  function buildDeps(): { deps: ExpirationHttpDeps; expiration: ExpirationService } {
    const store = new InMemoryExpirationStore([activeLifecycleRecord("tenant-1")]);
    const expiration = new ExpirationService({ store, tableName: "MainTable", ids: makeExpirationIdGenerator(), members: allowAllMemberEligibilityChecker(), now: () => "2026-09-05T12:00:00.000Z" });
    return { deps: { resolver: fakeResolver(ctx()), expiration, quota: fakeQuota() }, expiration };
  }

  describe("handleBulkReassignItems", () => {
    it("rejects a missing body with a real 400, never an uncaught throw", async () => {
      const { deps } = buildDeps();
      const response = await handleBulkReassignItems(deps, baseReq<never>(undefined));
      expect(response.statusCode).toBe(400);
    });

    it("rejects a body that fails schema validation (empty items array) with a real 400 before touching the service", async () => {
      const { deps } = buildDeps();
      const response = await handleBulkReassignItems(deps, baseReq({ items: [] } as never));
      expect(response.statusCode).toBe(400);
    });

    it("rejects a body with an unknown extra property (additionalProperties:false) with a real 400", async () => {
      const { deps } = buildDeps();
      const response = await handleBulkReassignItems(
        deps,
        baseReq({ items: [{ itemId: "i1", expectedVersion: 1, assigneeUserId: "u1", extra: "nope" }] }),
      );
      expect(response.statusCode).toBe(400);
    });

    it("rejects a body missing assigneeUserId on an item (required field) with a real 400", async () => {
      const { deps } = buildDeps();
      const response = await handleBulkReassignItems(deps, baseReq({ items: [{ itemId: "i1", expectedVersion: 1 }] } as never));
      expect(response.statusCode).toBe(400);
    });

    it("accepts a valid body and shapes the service's per-item outcomes into the response", async () => {
      const { deps, expiration } = buildDeps();
      const item = await expiration.createItem(ctx(), { name: "A", category: "Cat", dueDate: "2026-09-10T00:00:00.000Z" });

      const response = await handleBulkReassignItems(deps, baseReq({ items: [{ itemId: item.itemId, expectedVersion: item.version, assigneeUserId: "user-2" }] }));

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ outcomes: [{ itemId: item.itemId, outcome: "SUCCEEDED" }] });
    });
  });

  describe("handleBulkArchiveItems", () => {
    it("rejects a body missing confirm (required field) with a real 400", async () => {
      const { deps } = buildDeps();
      const response = await handleBulkArchiveItems(deps, baseReq({ items: [{ itemId: "i1", expectedVersion: 1 }] } as never));
      expect(response.statusCode).toBe(400);
    });

    it("rejects confirm:false (schema requires const true) with a real 400 before touching the service", async () => {
      const { deps } = buildDeps();
      const response = await handleBulkArchiveItems(deps, baseReq({ items: [{ itemId: "i1", expectedVersion: 1 }], confirm: false }));
      expect(response.statusCode).toBe(400);
    });

    it("accepts a valid confirmed body and shapes the service's per-item outcomes into the response", async () => {
      const { deps, expiration } = buildDeps();
      const item = await expiration.createItem(ctx(), { name: "A", category: "Cat", dueDate: "2026-09-10T00:00:00.000Z" });

      const response = await handleBulkArchiveItems(deps, baseReq({ items: [{ itemId: item.itemId, expectedVersion: item.version }], confirm: true }));

      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ outcomes: [{ itemId: item.itemId, outcome: "SUCCEEDED" }] });
    });
  });
});
