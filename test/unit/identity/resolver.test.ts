import { describe, expect, it } from "vitest";
import { InMemoryIdentityStore, makeIdGenerator } from "./in-memory-store.js";
import { IdentityMappingRepository } from "../../../src/modules/identity/persistence/identity-mapping-repository.js";
import { UserRepository } from "../../../src/modules/identity/persistence/user-repository.js";
import { RequestContextResolver, type ValidatedClaims } from "../../../src/modules/identity/application/resolve-request-context.js";
import { AuthenticationError } from "../../../src/shared/errors/app-error.js";

function makeResolver() {
  const store = new InMemoryIdentityStore();
  const mappings = new IdentityMappingRepository(store);
  const users = new UserRepository(store);
  const resolver = new RequestContextResolver(mappings, users, makeIdGenerator());
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
