import { describe, expect, it } from "vitest";
import { InMemoryIdentityStore, makeIdGenerator } from "./in-memory-store.js";
import { IdentityMappingRepository } from "../../../src/modules/identity/persistence/identity-mapping-repository.js";
import { UserRepository } from "../../../src/modules/identity/persistence/user-repository.js";
import { RequestContextResolver, type ValidatedClaims } from "../../../src/modules/identity/application/resolve-request-context.js";
import { TenantBootstrapService } from "../../../src/modules/identity/application/bootstrap-identity.js";
import { AuthenticationError } from "../../../src/shared/errors/app-error.js";
import { tenantLifecycleKey, type TenantLifecycleRecord } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";

function makeResolver() {
  const store = new InMemoryIdentityStore();
  const mappings = new IdentityMappingRepository(store);
  const users = new UserRepository(store);
  const resolver = new RequestContextResolver(mappings, users, makeIdGenerator(), store, "MainTable");
  return { store, mappings, users, resolver };
}

function claims(overrides: Partial<ValidatedClaims> = {}): ValidatedClaims {
  return {
    sub: "cognito-sub-1",
    tokenId: "jti-1",
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

describe("RequestContextResolver", () => {
  it("creates IdentityMapping + User profile atomically on first login", async () => {
    const { resolver, store } = makeResolver();
    const ctx = await resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1" });

    expect(ctx.principal.cognitoSubject).toBe("cognito-sub-1");
    expect(ctx.tenant.tenantId).toBe(ctx.principal.userId); // MVP: tenantId=userId
    expect(ctx.tenant.roles).toEqual(["OWNER"]);
    expect(store.allKeys().some((k) => k.startsWith("IDENTITY#cognitoSub#cognito-sub-1"))).toBe(true);
  });

  it("returns the same userId/tenantId on repeat login (idempotent mapping)", async () => {
    const { resolver } = makeResolver();
    const ctx1 = await resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1" });
    const ctx2 = await resolver.resolve({ claims: claims({ tokenId: "jti-2" }), requestId: "r2", correlationId: "c2" });

    expect(ctx2.principal.userId).toBe(ctx1.principal.userId);
    expect(ctx2.tenant.tenantId).toBe(ctx1.tenant.tenantId);
  });

  it("two concurrent first-logins for the same sub converge on one userId", async () => {
    const { resolver } = makeResolver();
    const [a, b] = await Promise.all([
      resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1" }),
      resolver.resolve({ claims: claims({ tokenId: "jti-2" }), requestId: "r2", correlationId: "c2" }),
    ]);
    expect(a.principal.userId).toBe(b.principal.userId);
  });

  it("rejects a token issued before globalLogoutAfter", async () => {
    const { resolver, users } = makeResolver();
    const staleIssuedAt = new Date(Date.now() - 60_000).toISOString();
    const ctx = await resolver.resolve({
      claims: claims({ issuedAt: staleIssuedAt }),
      requestId: "r1",
      correlationId: "c1",
    });
    await users.logoutAll(ctx.tenant.tenantId, ctx.principal.userId);

    await expect(
      resolver.resolve({
        claims: claims({ tokenId: "jti-old", issuedAt: staleIssuedAt }),
        requestId: "r2",
        correlationId: "c2",
      }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects a token issued before deviceLogoutAfter for a revoked device", async () => {
    const { resolver, users } = makeResolver();
    const staleIssuedAt = new Date(Date.now() - 60_000).toISOString();
    const ctx = await resolver.resolve({
      claims: claims({ deviceId: "device-1", issuedAt: staleIssuedAt }),
      requestId: "r1",
      correlationId: "c1",
    });
    await users.upsertDeviceSession({
      PK: `TENANT#${ctx.tenant.tenantId}#USER#${ctx.principal.userId}`,
      SK: "SESSION#device-1",
      entityType: "DeviceSession",
      tenantId: ctx.tenant.tenantId,
      userId: ctx.principal.userId,
      deviceId: "device-1",
      sessionId: ctx.principal.sessionId,
      refreshFamilyId: "fam-1",
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      status: "ACTIVE",
    });
    await users.logoutDevice(ctx.tenant.tenantId, ctx.principal.userId, "device-1");

    await expect(
      resolver.resolve({
        claims: claims({ deviceId: "device-1", tokenId: "jti-old", issuedAt: staleIssuedAt }),
        requestId: "r2",
        correlationId: "c2",
      }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("suspended user is rejected even with a valid token", async () => {
    const { resolver, users, store } = makeResolver();
    const ctx = await resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1" });
    const profile = await users.getProfile(ctx.tenant.tenantId, ctx.principal.userId);
    await store.update({ ...profile!, status: "SUSPENDED" });

    await expect(
      resolver.resolve({ claims: claims({ tokenId: "jti-2" }), requestId: "r2", correlationId: "c2" }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});

describe("RequestContextResolver — W3-07 atomic bootstrap (D-067)", () => {
  it("creates IdentityMapping + TenantLifecycleRecord(ACTIVE) + User atomically on first login", async () => {
    const { resolver, store } = makeResolver();
    const ctx = await resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1" });

    const lifecycle = await store.get<TenantLifecycleRecord>(tenantLifecycleKey(ctx.tenant.tenantId));
    expect(lifecycle).toBeDefined();
    expect(lifecycle?.status).toBe("ACTIVE");
    expect(lifecycle?.tenantId).toBe(ctx.tenant.tenantId);

    const mappingKeys = store.allKeys().filter((k) => k.startsWith("IDENTITY#cognitoSub#cognito-sub-1"));
    const profileKeys = store.allKeys().filter((k) => k.startsWith(`TENANT#${ctx.tenant.tenantId}#USER#${ctx.principal.userId}#PROFILE`));
    expect(mappingKeys).toHaveLength(1);
    expect(profileKeys).toHaveLength(1);
  });

  it("does NOT reprovision a User when IdentityMapping already exists and TenantLifecycleRecord is DELETING - the D-063 resurrection bug this session fixes", async () => {
    const { resolver, store } = makeResolver();
    const ctx = await resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1" });

    // Simulate the deletion cascade having moved the tenant to DELETING (no cascade/purge
    // worker exists yet in this codebase - that is a later chunk; this test only proves the
    // resolver respects the lifecycle status once it is DELETING, whatever set it there).
    const lifecycleKey = tenantLifecycleKey(ctx.tenant.tenantId);
    const lifecycle = await store.get<TenantLifecycleRecord>(lifecycleKey);
    await store.update({ ...lifecycle!, status: "DELETING" });

    await expect(
      resolver.resolve({ claims: claims({ tokenId: "jti-2" }), requestId: "r2", correlationId: "c2" }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("does NOT reprovision a User when TenantLifecycleRecord is DELETED (fully purged tenant, terminal state)", async () => {
    const { resolver, store } = makeResolver();
    const ctx = await resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1" });

    const lifecycleKey = tenantLifecycleKey(ctx.tenant.tenantId);
    const lifecycle = await store.get<TenantLifecycleRecord>(lifecycleKey);
    await store.update({ ...lifecycle!, status: "DELETED" });

    await expect(
      resolver.resolve({ claims: claims({ tokenId: "jti-3" }), requestId: "r3", correlationId: "c3" }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("two concurrent first logins for the same sub converge on one tenant, with exactly one TenantLifecycleRecord and one User", async () => {
    const { resolver, store } = makeResolver();
    const [a, b] = await Promise.all([
      resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1" }),
      resolver.resolve({ claims: claims({ tokenId: "jti-2" }), requestId: "r2", correlationId: "c2" }),
    ]);

    expect(a.tenant.tenantId).toBe(b.tenant.tenantId);
    const lifecycleKeys = store.allKeys().filter((k) => k.includes("#LIFECYCLE"));
    expect(lifecycleKeys).toHaveLength(1);
    const profileKeys = store.allKeys().filter((k) => k.endsWith("#PROFILE"));
    expect(profileKeys).toHaveLength(1);
  });

  it("repeat login of an already-bootstrapped identity is idempotent - no duplicate rows, no error", async () => {
    const { resolver, store } = makeResolver();
    await resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1" });
    await resolver.resolve({ claims: claims({ tokenId: "jti-2" }), requestId: "r2", correlationId: "c2" });
    await resolver.resolve({ claims: claims({ tokenId: "jti-3" }), requestId: "r3", correlationId: "c3" });

    const lifecycleKeys = store.allKeys().filter((k) => k.includes("#LIFECYCLE"));
    const profileKeys = store.allKeys().filter((k) => k.endsWith("#PROFILE"));
    const mappingKeys = store.allKeys().filter((k) => k.startsWith("IDENTITY#cognitoSub#"));
    expect(lifecycleKeys).toHaveLength(1);
    expect(profileKeys).toHaveLength(1);
    expect(mappingKeys).toHaveLength(1);
  });

  it("TenantBootstrapService.bootstrap() directly: retries and resolves against the winner after losing a create race", async () => {
    const store = new InMemoryIdentityStore();
    const bootstrap = new TenantBootstrapService(store, "MainTable", () => "2026-08-28T00:00:00.000Z");

    const [a, b] = await Promise.all([bootstrap.bootstrap("sub-x", "user-a"), bootstrap.bootstrap("sub-x", "user-b")]);

    expect(a.mapping.tenantId).toBe(b.mapping.tenantId);
    expect(a.profile?.userId).toBe(b.profile?.userId);
    expect(a.lifecycle.status).toBe("ACTIVE");
  });

  it("TenantBootstrapService backfills a legacy pre-migration mapping (no TenantLifecycleRecord yet) as ACTIVE rather than erroring", async () => {
    const store = new InMemoryIdentityStore();
    // Simulate a mapping created before TenantLifecycleRecord existed in code (D-067's
    // migration note): mapping present, no lifecycle row, no profile.
    await store.putIfAbsent({ PK: "IDENTITY#cognitoSub#legacy-sub", SK: "MAP", entityType: "IdentityMapping", cognitoSub: "legacy-sub", userId: "legacy-user", tenantId: "legacy-user", createdAt: "2026-01-01T00:00:00.000Z" });

    const bootstrap = new TenantBootstrapService(store, "MainTable", () => "2026-08-28T00:00:00.000Z");
    const result = await bootstrap.bootstrap("legacy-sub", "ignored-new-user-id");

    expect(result.lifecycle.status).toBe("ACTIVE");
    expect(result.profile).toBeDefined();
    expect(result.profile?.userId).toBe("legacy-user");
  });
});
