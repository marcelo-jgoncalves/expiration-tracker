import { describe, expect, it } from "vitest";
import { InMemoryIdentityStore, makeIdGenerator, bootstrapWithOrganization } from "./in-memory-store.js";
import { InMemoryOrganizationStore } from "../organization/in-memory-store.js";
import { UserRepository } from "../../../src/modules/identity/persistence/user-repository.js";
import { GlobalUserRepository, deviceSessionKey } from "../../../src/modules/identity/persistence/global-user-repository.js";
import { RequestContextResolver, type ValidatedClaims } from "../../../src/modules/identity/application/resolve-request-context.js";
import { IdentityBootstrapService } from "../../../src/modules/identity/application/bootstrap-identity.js";
import { AuthenticationError, OnboardingRequiredError, UnsupportedMembershipRoleError } from "../../../src/shared/errors/app-error.js";
import { tenantLifecycleKey, TENANT_ACTIVE_STATUS, type TenantLifecycleRecord } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { membershipKey } from "../../../src/modules/organization/domain/membership.js";

function makeResolver() {
  const store = new InMemoryIdentityStore();
  const organizations = new InMemoryOrganizationStore();
  const globalUsers = new GlobalUserRepository(store);
  const users = new UserRepository(store);
  const resolver = new RequestContextResolver(users, globalUsers, organizations, makeIdGenerator(), store, "MainTable");
  return { store, organizations, users, globalUsers, resolver };
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

// Wave B2B-5 (D-095): bootstrapUser() literal final state - 2-item TransactWriteItems
// (GlobalUser + IdentityMapping), no tenant/Organization/UserProfile created at login anymore.
describe("IdentityBootstrapService - 2-item atomic bootstrap", () => {
  // Mutação: reintroduzir os 2 itens legados (Put TenantLifecycleRecord/Put UserProfile) na
  // TransactWriteItems de createAll() faria esta asserção de "nenhuma chave TENANT#/LIFECYCLE"
  // falhar - é exatamente o comportamento que este teste existe para proteger.
  it("creates GlobalUser + IdentityMapping atomically, no tenant/Organization/UserProfile", async () => {
    const store = new InMemoryIdentityStore();
    const bootstrap = new IdentityBootstrapService(store, "MainTable", () => "2026-08-30T00:00:00.000Z");
    const { mapping, user } = await bootstrap.bootstrapUser("sub-1", "user-1", "a@b.com");

    expect(mapping.userId).toBe("user-1");
    expect(mapping.cognitoSub).toBe("sub-1");
    expect(user.userId).toBe("user-1");
    expect(user.identityStatus).toBe("ACTIVE");
    expect(user.emailNormalized).toBe("a@b.com");
    expect(user.version).toBe(1);
    expect(store.allKeys().some((k) => k.startsWith("TENANT#") || k.includes("LIFECYCLE"))).toBe(false);
  });

  // Mutação: reverter bootstrapUser()'s corrida perdedora (o catch de createAll) para não
  // re-ler e simplesmente tentar criar de novo produziria 2 IdentityMapping/GlobalUser
  // distintos para o mesmo cognitoSub em vez de convergir no vencedor.
  it("two concurrent first logins for the same sub converge on one userId", async () => {
    const store = new InMemoryIdentityStore();
    const bootstrap = new IdentityBootstrapService(store, "MainTable");
    const [a, b] = await Promise.all([bootstrap.bootstrapUser("sub-x", "user-a"), bootstrap.bootstrapUser("sub-x", "user-b")]);

    expect(a.mapping.userId).toBe(b.mapping.userId);
    expect(a.user.userId).toBe(b.user.userId);
    const mappingKeys = store.allKeys().filter((k) => k.startsWith("IDENTITY#cognitoSub#"));
    expect(mappingKeys).toHaveLength(1);
  });

  // Mutação: remover o `if (existingMapping) return {mapping: existingMapping, user}`
  // early-return de bootstrapUser() faria todo repeat-login cair em createAll() de novo,
  // tentando recriar (e falhando, ou pior, duplicando se a condição não pegasse).
  it("repeat login of an already-bootstrapped identity is idempotent - no duplicate rows", async () => {
    const store = new InMemoryIdentityStore();
    const bootstrap = new IdentityBootstrapService(store, "MainTable");
    await bootstrap.bootstrapUser("sub-1", "user-1");
    await bootstrap.bootstrapUser("sub-1", "user-should-be-ignored");
    await bootstrap.bootstrapUser("sub-1", "user-should-be-ignored-2");

    const mappingKeys = store.allKeys().filter((k) => k.startsWith("IDENTITY#cognitoSub#"));
    const userKeys = store.allKeys().filter((k) => k.startsWith("USER#") && k.endsWith("#PROFILE"));
    expect(mappingKeys).toHaveLength(1);
    expect(userKeys).toHaveLength(1);
  });
});

describe("RequestContextResolver - onboarding gate (no working Membership yet)", () => {
  // Mutação: fazer resolve() ignorar o resultado de OnboardingStateResolver (ex. prosseguir
  // direto para resolveActiveMembership) faria isto lançar um erro diferente (ou tentar
  // hidratar uma lista vazia) em vez do OnboardingRequiredError nomeado que o achado 2.3
  // (D-095) existe para produzir.
  it("throws OnboardingRequiredError(NO_TENANT_NO_MEMBERSHIP) for a brand-new user with no Organization", async () => {
    const { resolver } = makeResolver();
    const rejection = await resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1" }).catch((err: unknown) => err);

    expect(rejection).toBeInstanceOf(OnboardingRequiredError);
    expect((rejection as OnboardingRequiredError).onboardingState).toBe("NO_TENANT_NO_MEMBERSHIP");
  });
});

describe("RequestContextResolver - working context once an Organization exists", () => {
  // Mutação: usar `membership.userId` ou o `organizationId` bruto no lugar de
  // `membership.membershipId` no tenant.membershipId faria esta asserção específica falhar -
  // physical model §11 exige membershipId sempre populado, não qualquer string.
  it("resolves tenantId=organizationId, membershipId populated, roles=[OWNER]", async () => {
    const { store, organizations, resolver } = makeResolver();
    const { userId, organizationId, membershipId } = await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1");
    const ctx = await resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1" });

    expect(ctx.principal.userId).toBe(userId);
    expect(ctx.tenant.tenantId).toBe(organizationId);
    expect(ctx.tenant.membershipId).toBe(membershipId);
    expect(ctx.tenant.roles).toEqual(["OWNER"]);
  });

  // Mutação: remover a chamada a `users.createProfileIfAbsent(...)` no resolver faria
  // `users.getProfile()` retornar undefined aqui - exatamente o invariante que
  // ProfileService.readOwnProfile() já documenta depender ("cannot actually happen").
  it("lazily provisions a per-Organization UserProfile the first time it resolves", async () => {
    const { store, organizations, resolver, users } = makeResolver();
    const { organizationId } = await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1");
    const ctx = await resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1" });

    const profile = await users.getProfile(organizationId, ctx.principal.userId);
    expect(profile).toBeDefined();
    expect(profile?.status).toBe("ACTIVE");
  });

  it("returns the same userId/tenantId on repeat login (idempotent)", async () => {
    const { store, organizations, resolver } = makeResolver();
    await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1");
    const ctx1 = await resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1" });
    const ctx2 = await resolver.resolve({ claims: claims({ tokenId: "jti-2" }), requestId: "r2", correlationId: "c2" });

    expect(ctx2.principal.userId).toBe(ctx1.principal.userId);
    expect(ctx2.tenant.tenantId).toBe(ctx1.tenant.tenantId);
  });

  // Mutação: trocar o assert de `active.length > 1` por "pega a primeira" (active[0]) faria
  // este teste passar mesmo com 2 Memberships ACTIVE simultâneas para o mesmo usuário -
  // fixture sintético, hoje inalcançável por nenhum writer real (só possível via B2B-8).
  it("fails closed, loud, if a user somehow has more than one ACTIVE Membership (synthetic - unreachable via any real writer today)", async () => {
    const { store, organizations, resolver } = makeResolver();
    const { userId } = await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1");
    const { organizationId: secondOrgId } = await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1-second-org-fixture");
    // Synthetic: graft a second ACTIVE Membership for the SAME userId onto the second org,
    // bypassing CreateOrganizationService's real creator-is-caller invariant - only possible
    // this way because no real writer (Invitations, Wave B2B-8) exists yet.
    organizations.forceUpdate({
      ...membershipKey(secondOrgId, userId),
      entityType: "Membership",
      membershipId: "membership-forced",
      organizationId: secondOrgId,
      userId,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: "2026-08-30T00:00:00.000Z",
      createdBy: userId,
      version: 1,
      GSI4PK: `USER#${userId}`,
      GSI4SK: `ORG#${secondOrgId}#MEMBERSHIP#membership-forced`,
    });

    await expect(resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1" })).rejects.toThrow(/more than one ACTIVE Membership/);
  });
});

describe("RequestContextResolver - revocation (user-global, not per-Organization, physical model §10)", () => {
  it("rejects a token issued before globalLogoutAfter", async () => {
    const { store, organizations, resolver, globalUsers } = makeResolver();
    await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1");
    const staleIssuedAt = new Date(Date.now() - 60_000).toISOString();
    const ctx = await resolver.resolve({ claims: claims({ issuedAt: staleIssuedAt }), requestId: "r1", correlationId: "c1" });
    await globalUsers.logoutAll(ctx.principal.userId);

    await expect(
      resolver.resolve({ claims: claims({ tokenId: "jti-old", issuedAt: staleIssuedAt }), requestId: "r2", correlationId: "c2" }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects a token issued before deviceLogoutAfter for a revoked device", async () => {
    const { store, organizations, resolver, globalUsers } = makeResolver();
    await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1");
    const staleIssuedAt = new Date(Date.now() - 60_000).toISOString();
    const ctx = await resolver.resolve({ claims: claims({ deviceId: "device-1", issuedAt: staleIssuedAt }), requestId: "r1", correlationId: "c1" });
    await globalUsers.upsertDeviceSession({
      ...deviceSessionKey(ctx.principal.userId, "device-1"),
      entityType: "DeviceSession",
      userId: ctx.principal.userId,
      deviceId: "device-1",
      sessionId: ctx.principal.sessionId,
      refreshFamilyId: "fam-1",
      createdAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      status: "ACTIVE",
    });
    await globalUsers.logoutDevice(ctx.principal.userId, "device-1");

    await expect(
      resolver.resolve({ claims: claims({ deviceId: "device-1", tokenId: "jti-old", issuedAt: staleIssuedAt }), requestId: "r2", correlationId: "c2" }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  // Mutação: checar `user.identityStatus` só na criação (não a cada resolve()) deixaria este
  // teste passar mesmo com a suspensão aplicada depois do primeiro login bem-sucedido.
  it("suspended identity (GlobalUser.identityStatus) is rejected even with a valid token", async () => {
    const { store, organizations, resolver, globalUsers } = makeResolver();
    await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1");
    const ctx = await resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1" });
    const user = await globalUsers.get(ctx.principal.userId);
    await store.update({ ...user!, identityStatus: "SUSPENDED" });

    await expect(
      resolver.resolve({ claims: claims({ tokenId: "jti-2" }), requestId: "r2", correlationId: "c2" }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});

describe("RequestContextResolver - Organization lifecycle gate (physical model §11's chain ends 'TenantLifecycleRecord ACTIVE')", () => {
  // Mutação: remover a leitura de tenantLifecycleKey(membership.organizationId)/o check de
  // status ACTIVE do resolver faria este teste (única evidência de que o gate existe de
  // verdade, não só na documentação do arquivo) passar mesmo com o tenant DELETING.
  it("rejects when the Organization's own TenantLifecycleRecord is not ACTIVE, even with a real ACTIVE Membership", async () => {
    const { store, organizations, resolver } = makeResolver();
    const { organizationId } = await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1");
    const lifecycle = await organizations.get<TenantLifecycleRecord>(tenantLifecycleKey(organizationId));
    organizations.forceUpdate({ ...lifecycle!, status: "DELETING" });

    await expect(resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1" })).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("resolves normally when the Organization's TenantLifecycleRecord is ACTIVE (sanity, not just the negative case)", async () => {
    const { store, organizations, resolver } = makeResolver();
    const { organizationId } = await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1");
    const lifecycle = await organizations.get<TenantLifecycleRecord>(tenantLifecycleKey(organizationId));
    expect(lifecycle?.status).toBe(TENANT_ACTIVE_STATUS);

    const ctx = await resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1" });
    expect(ctx.tenant.tenantId).toBe(organizationId);
  });
});

describe("RequestContextResolver - unsupported Membership role (Codex Rodada 1 achado 2.2, D-095)", () => {
  // Mutação: remover o assert de resolveRoles() (deixar o cast unsafe de authorization.ts
  // decidir sozinho) faria este teste não lançar UnsupportedMembershipRoleError - o achado
  // central que motivou a mudança F da Rodada 2 do debate de escopo.
  it("throws UnsupportedMembershipRoleError for a Membership.role the authorization matrix doesn't know yet (ADMIN, unreachable via any real writer today)", async () => {
    const { store, organizations, resolver } = makeResolver();
    const { userId, organizationId } = await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1");
    const membership = await organizations.get(membershipKey(organizationId, userId));
    organizations.forceUpdate({ ...(membership as Record<string, unknown> & { PK: string; SK: string }), role: "ADMIN" });

    const rejection = await resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1" }).catch((err: unknown) => err);
    expect(rejection).toBeInstanceOf(UnsupportedMembershipRoleError);
  });
});
