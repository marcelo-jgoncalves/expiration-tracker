import { describe, expect, it, vi } from "vitest";
import * as securityAudit from "../../../src/shared/observability/security-audit.js";
import { InMemoryIdentityStore, makeIdGenerator } from "./in-memory-store.js";
import { IdentityMappingRepository } from "../../../src/modules/identity/persistence/identity-mapping-repository.js";
import { UserRepository } from "../../../src/modules/identity/persistence/user-repository.js";
import { RequestContextResolver } from "../../../src/modules/identity/application/resolve-request-context.js";
import { TenantQuotaService } from "../../../src/modules/identity/application/quota.js";
import { handleTestRoute } from "../../../src/modules/identity/http/test-route-handler.js";

function makeDeps() {
  const store = new InMemoryIdentityStore();
  const resolver = new RequestContextResolver(
    new IdentityMappingRepository(store),
    new UserRepository(store),
    makeIdGenerator(),
    store,
    "MainTable",
  );
  const quota = new TenantQuotaService(store);
  return { resolver, quota };
}

describe("handleTestRoute", () => {
  it("returns 200 with tenantId/userId for a valid authenticated request", async () => {
    const deps = makeDeps();
    const res = await handleTestRoute(deps, {
      requestId: "r1",
      correlationId: "c1",
      claims: { sub: "sub-1", tokenId: "t1", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.tenantId).toBe("string");
  });

  it("returns 429 once the API_REQUEST quota is exhausted", async () => {
    const deps = makeDeps();
    const claims = { sub: "sub-2", tokenId: "t1", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() };
    for (let i = 0; i < 100; i++) {
      const res = await handleTestRoute(deps, { requestId: `r${i}`, correlationId: "c", claims });
      expect(res.statusCode).toBe(200);
    }
    const final = await handleTestRoute(deps, { requestId: "r-final", correlationId: "c", claims });
    expect(final.statusCode).toBe(429);
  });

  it("returns 401 for a token issued before global logout", async () => {
    const store = new InMemoryIdentityStore();
    const users = new UserRepository(store);
    const resolver = new RequestContextResolver(new IdentityMappingRepository(store), users, makeIdGenerator(), store, "MainTable");
    const quota = new TenantQuotaService(store);
    const claims = {
      sub: "sub-3",
      tokenId: "t1",
      issuedAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };

    const ok = await handleTestRoute({ resolver, quota }, { requestId: "r1", correlationId: "c", claims });
    expect(ok.statusCode).toBe(200);

    await users.logoutAll(ok.body.tenantId as string, ok.body.userId as string);

    const denied = await handleTestRoute(
      { resolver, quota },
      { requestId: "r2", correlationId: "c", claims: { ...claims, tokenId: "t2" } },
    );
    expect(denied.statusCode).toBe(401);
  });

  it("emits exactly one security.authorization_denied event on a real authorize() denial, without changing the 403 response", async () => {
    const auditSpy = vi.spyOn(securityAudit, "auditAuthorizationDenied");
    const quota = makeDeps().quota;
    // A resolver whose context has no role at all - the real authorize() function throws
    // AuthorizationDeniedError("NO_MEMBERSHIP", ...) for this, exercising the real domain
    // path (not a mocked exception) through the handler's actual catch block.
    const noRoleResolver = {
      resolve: async () => ({
        tenant: { tenantId: "tenant-x", roles: [] },
        principal: { userId: "user-x" },
        requestId: "r1",
      }),
    } as unknown as Parameters<typeof handleTestRoute>[0]["resolver"];

    const res = await handleTestRoute(
      { resolver: noRoleResolver, quota },
      { requestId: "r1", correlationId: "c1", claims: { sub: "sub-x", tokenId: "t1", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() } },
    );

    expect(res.statusCode).toBe(403);
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy).toHaveBeenCalledWith({ reason: "NO_MEMBERSHIP", action: "system:ping" });
    auditSpy.mockRestore();
  });
});
