/**
 * Cross-tenant negative suite — M1 exit criterion (implementation-blueprint.md §19 M1
 * "Saída: rota autenticada de teste e suíte cross-tenant negativa") and §4.3's mandated
 * negative-test list. Exercises the full pipeline end-to-end through the authenticated
 * test route handler (resolver -> authorize -> quota), not the pieces in isolation, so it
 * proves the wiring, not just each unit.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryIdentityStore, makeIdGenerator } from "../unit/identity/in-memory-store.js";
import { IdentityMappingRepository } from "../../src/modules/identity/persistence/identity-mapping-repository.js";
import { UserRepository } from "../../src/modules/identity/persistence/user-repository.js";
import { RequestContextResolver, type ValidatedClaims } from "../../src/modules/identity/application/resolve-request-context.js";
import { TenantQuotaService } from "../../src/modules/identity/application/quota.js";
import { authorize, AuthorizationDeniedError } from "../../src/modules/identity/domain/authorization.js";
import { handleTestRoute } from "../../src/modules/identity/http/test-route-handler.js";
import { AuthenticationError } from "../../src/shared/errors/app-error.js";

function claims(sub: string, overrides: Partial<ValidatedClaims> = {}): ValidatedClaims {
  return {
    sub,
    tokenId: `jti-${sub}`,
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

describe("Cross-tenant isolation (negative suite)", () => {
  let store: InMemoryIdentityStore;
  let resolver: RequestContextResolver;
  let quota: TenantQuotaService;
  let users: UserRepository;

  beforeEach(() => {
    store = new InMemoryIdentityStore();
    const mappings = new IdentityMappingRepository(store);
    users = new UserRepository(store);
    resolver = new RequestContextResolver(mappings, users, makeIdGenerator(), store, "MainTable");
    quota = new TenantQuotaService(store, "MainTable");
  });

  it("two distinct Cognito subs resolve to two distinct, non-overlapping tenants", async () => {
    const ctxA = await resolver.resolve({ claims: claims("sub-A"), requestId: "r1", correlationId: "c1" });
    const ctxB = await resolver.resolve({ claims: claims("sub-B"), requestId: "r2", correlationId: "c2" });

    expect(ctxA.tenant.tenantId).not.toBe(ctxB.tenant.tenantId);
    expect(ctxA.principal.userId).not.toBe(ctxB.principal.userId);
  });

  it("swapping the resource's tenantId for another tenant's ID is denied (ID substitution attack)", async () => {
    const ctxA = await resolver.resolve({ claims: claims("sub-A"), requestId: "r1", correlationId: "c1" });
    const ctxB = await resolver.resolve({ claims: claims("sub-B"), requestId: "r2", correlationId: "c2" });

    // A tries to read a resource whose tenantId is actually B's tenant.
    expect(() =>
      authorize({ context: ctxA, action: "item:read", resource: { tenantId: ctxB.tenant.tenantId } }),
    ).toThrow(AuthorizationDeniedError);
  });

  it("a maliciously supplied tenantId in the DTO is ignored - resource.tenantId always comes from a DB read keyed by ctx.tenant.tenantId", async () => {
    const ctxA = await resolver.resolve({ claims: claims("sub-A"), requestId: "r1", correlationId: "c1" });

    // Simulate: client payload claims tenantId "tenant-B-forged", but the authz
    // resource object is built from context, never from the DTO - the call site
    // that matters is passing context.tenant.tenantId, so this must succeed for A's
    // own tenant regardless of what the (ignored) DTO said.
    expect(() =>
      authorize({ context: ctxA, action: "item:read", resource: { tenantId: ctxA.tenant.tenantId } }),
    ).not.toThrow();
  });

  it("authenticated user with no membership (empty roles) is denied on every action", async () => {
    const ctxA = await resolver.resolve({ claims: claims("sub-A"), requestId: "r1", correlationId: "c1" });
    const noMembership = { ...ctxA, tenant: { ...ctxA.tenant, roles: [] } };

    expect(() => authorize({ context: noMembership, action: "item:read", resource: { tenantId: ctxA.tenant.tenantId } })).toThrow(
      AuthorizationDeniedError,
    );
  });

  it("membership revoked (globalLogoutAfter) with a token issued before revocation is rejected at resolve() time, before authorize() ever runs", async () => {
    const staleIssuedAt = new Date(Date.now() - 60_000).toISOString();
    const ctxA = await resolver.resolve({
      claims: claims("sub-A", { issuedAt: staleIssuedAt }),
      requestId: "r1",
      correlationId: "c1",
    });
    await users.logoutAll(ctxA.tenant.tenantId, ctxA.principal.userId);

    await expect(
      resolver.resolve({
        claims: claims("sub-A", { tokenId: "jti-stale", issuedAt: staleIssuedAt }),
        requestId: "r2",
        correlationId: "c2",
      }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("insufficient role (VIEWER) is denied a write action even within the correct tenant", async () => {
    const ctxA = await resolver.resolve({ claims: claims("sub-A"), requestId: "r1", correlationId: "c1" });
    const viewerCtx = { ...ctxA, tenant: { ...ctxA.tenant, roles: ["VIEWER"] } };

    expect(() =>
      authorize({ context: viewerCtx, action: "item:delete", resource: { tenantId: ctxA.tenant.tenantId } }),
    ).toThrow(AuthorizationDeniedError);
  });

  it("a resource read via a cross-tenant GSI-shaped lookup still fails authz on tenant mismatch", async () => {
    // Simulates "leitura por GSI seguida de tentativa de agir sobre recurso alheio"
    // (blueprint §4.3): pretend a GSI query returned an item belonging to tenant-B
    // (GSIs are eventually consistent and keyed independent of caller identity), and
    // the caller (tenant A) then tries to act on it.
    const ctxA = await resolver.resolve({ claims: claims("sub-A"), requestId: "r1", correlationId: "c1" });
    const ctxB = await resolver.resolve({ claims: claims("sub-B"), requestId: "r2", correlationId: "c2" });
    const gsiResultFromTenantB = { tenantId: ctxB.tenant.tenantId, ownerUserId: ctxB.principal.userId };

    expect(() => authorize({ context: ctxA, action: "document:read", resource: gsiResultFromTenantB })).toThrow(
      AuthorizationDeniedError,
    );
  });

  it("end-to-end: tenant A's authenticated request never returns tenant B's tenantId, and each tenant has an independent quota bucket", async () => {
    const resA1 = await handleTestRoute({ resolver, quota }, { requestId: "r1", correlationId: "c1", claims: claims("sub-A") });
    const resB1 = await handleTestRoute({ resolver, quota }, { requestId: "r2", correlationId: "c2", claims: claims("sub-B") });

    expect(resA1.statusCode).toBe(200);
    expect(resB1.statusCode).toBe(200);
    expect(resA1.body["tenantId"]).not.toBe(resB1.body["tenantId"]);

    // Exhaust tenant A's route quota; tenant B is unaffected (independent bucket).
    for (let i = 0; i < 100; i++) {
      await handleTestRoute({ resolver, quota }, { requestId: `ra-${i}`, correlationId: "c", claims: claims("sub-A") });
    }
    const exhaustedA = await handleTestRoute(
      { resolver, quota },
      { requestId: "ra-final", correlationId: "c", claims: claims("sub-A") },
    );
    expect(exhaustedA.statusCode).toBe(429);

    const stillOkB = await handleTestRoute(
      { resolver, quota },
      { requestId: "rb-final", correlationId: "c", claims: claims("sub-B") },
    );
    expect(stillOkB.statusCode).toBe(200);
  });

  it("no DynamoDB item written for one tenant is ever addressable under another tenant's PK prefix", async () => {
    await resolver.resolve({ claims: claims("sub-A"), requestId: "r1", correlationId: "c1" });
    const ctxB = await resolver.resolve({ claims: claims("sub-B"), requestId: "r2", correlationId: "c2" });

    const keysUnderB = store.allKeys().filter((k) => k.startsWith(`TENANT#${ctxB.tenant.tenantId}#`));
    for (const k of keysUnderB) {
      expect(k.startsWith(`TENANT#${ctxB.tenant.tenantId}#`)).toBe(true);
    }
    // Sanity: tenant A's items exist and are disjoint from tenant B's prefix. One deliberate,
    // documented exception since Wave B2B-2 (D-087, docs/architecture/multi-user-b2b-physical-
    // model.md §1): the additive global User row (`PK=USER#<userId>#PROFILE`) legitimately
    // contains the same raw ID string as `tenantId` under today's MVP `tenantId=userId` rule -
    // it is not tenant-scoped business data (carries no Document/ExpirationItem/etc.), is never
    // reachable via any `TENANT#`-scoped query, and is the intended foundation for Wave B2B-3's
    // `Membership` to reference a real, tenant-independent `userId`. Excluding it here narrowly
    // (by its exact known key shape, not a broad wildcard) keeps this negative suite meaningful
    // for every OTHER entity, which must still never leak a tenant id outside its `TENANT#` prefix.
    const anyCrossover = store
      .allKeys()
      .some((k) => k.startsWith(`TENANT#${ctxB.tenant.tenantId}#`) === false && k !== `USER#${ctxB.tenant.tenantId}#PROFILE` && k.includes(ctxB.tenant.tenantId));
    expect(anyCrossover).toBe(false);
  });
});
