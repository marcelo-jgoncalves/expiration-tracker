import { describe, expect, it } from "vitest";
import { InMemoryIdentityStore, makeIdGenerator, bootstrapWithOrganization } from "./in-memory-store.js";
import { InMemoryOrganizationStore } from "../organization/in-memory-store.js";
import { UserRepository } from "../../../src/modules/identity/persistence/user-repository.js";
import { GlobalUserRepository, deviceSessionKey } from "../../../src/modules/identity/persistence/global-user-repository.js";
import { RequestContextResolver, type ValidatedClaims } from "../../../src/modules/identity/application/resolve-request-context.js";
import { IdentityBootstrapService } from "../../../src/modules/identity/application/bootstrap-identity.js";
import { AuthenticationError, OnboardingRequiredError, OrganizationSelectionRequiredError, OrganizationUnavailableError, UnsupportedMembershipRoleError } from "../../../src/shared/errors/app-error.js";
import { tenantLifecycleKey, TENANT_ACTIVE_STATUS, type TenantLifecycleRecord } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { membershipKey, membershipGsi4Keys } from "../../../src/modules/organization/domain/membership.js";
import { RemoveMembershipService } from "../../../src/modules/organization/application/remove-membership.js";

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
    const rejection = await resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1", organizationIdHint: undefined }).catch((err: unknown) => err);

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
    const ctx = await resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1", organizationIdHint: undefined });

    expect(ctx.principal.userId).toBe(userId);
    expect(ctx.tenant.tenantId).toBe(organizationId);
    expect(ctx.tenant.membershipId).toBe(membershipId);
    expect(ctx.tenant.roles).toEqual(["OWNER"]);
  });

  // Mutação: remover a chamada a `users.createProfileIfAbsent(...)` no resolver faria
  // `users.getProfile()` retornar undefined aqui.
  it("lazily provisions a per-Organization UserProfile the first time it resolves", async () => {
    const { store, organizations, resolver, users } = makeResolver();
    const { organizationId } = await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1");
    const ctx = await resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1", organizationIdHint: undefined });

    const profile = await users.getProfile(organizationId, ctx.principal.userId);
    expect(profile).toBeDefined();
    expect(profile?.status).toBe("ACTIVE");
  });

  it("returns the same userId/tenantId on repeat login (idempotent)", async () => {
    const { store, organizations, resolver } = makeResolver();
    await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1");
    const ctx1 = await resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1", organizationIdHint: undefined });
    const ctx2 = await resolver.resolve({ claims: claims({ tokenId: "jti-2" }), requestId: "r2", correlationId: "c2", organizationIdHint: undefined });

    expect(ctx2.principal.userId).toBe(ctx1.principal.userId);
    expect(ctx2.tenant.tenantId).toBe(ctx1.tenant.tenantId);
  });

  // Mutação: trocar o throw de `OrganizationSelectionRequiredError` por "pega a primeira"
  // (active[0]) faria este teste passar mesmo com 2 Memberships ACTIVE simultâneas para o
  // mesmo usuário - Wave B2B-6 (D-101) fecha o InternalError 500 que este caso costumava
  // produzir (achado real: B2B-8 tornou isso alcançável de verdade via convite).
  it("throws OrganizationSelectionRequiredError (not a crash) when a user has more than one ACTIVE Membership and no X-Organization-Id hint", async () => {
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

    await expect(resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1", organizationIdHint: undefined })).rejects.toBeInstanceOf(OrganizationSelectionRequiredError);
  });

  // Mutação: usar o valor do hint sem revalidar via resolveWorkingOrganization() (confiar nele
  // "como está") faria isto resolver a organização errada em vez de lançar
  // OrganizationSelectionRequiredError - o hint só desambigua quando aponta para uma Membership
  // real e ACTIVE do próprio usuário.
  it("resolves the hinted organization directly when X-Organization-Id matches one of the user's ACTIVE Memberships, even with >1 active", async () => {
    const { store, organizations, resolver } = makeResolver();
    const { userId, organizationId: firstOrgId } = await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1");
    const { organizationId: secondOrgId } = await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1-second-org-fixture");
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

    const ctx = await resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1", organizationIdHint: secondOrgId });
    expect(ctx.tenant.tenantId).toBe(secondOrgId);
    expect(ctx.tenant.tenantId).not.toBe(firstOrgId);
  });

  // Mutação: cair de volta para a derivação via GSI4 quando o hint não bate com nenhuma
  // Membership real faria isto silenciosamente resolver OUTRA organização do usuário em vez de
  // falhar fechado - um hint explícito que não bate é sempre tratado como seleção inválida.
  it("throws OrganizationUnavailableError when X-Organization-Id does not match any real Membership, even if the user has a different valid one", async () => {
    const { store, organizations, resolver } = makeResolver();
    await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1");

    await expect(
      resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1", organizationIdHint: "org-does-not-exist" }),
    ).rejects.toBeInstanceOf(OrganizationUnavailableError);
  });
});

describe("RequestContextResolver - revocation (user-global, not per-Organization, physical model §10)", () => {
  it("rejects a token issued before globalLogoutAfter", async () => {
    const { store, organizations, resolver, globalUsers } = makeResolver();
    await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1");
    const staleIssuedAt = new Date(Date.now() - 60_000).toISOString();
    const ctx = await resolver.resolve({ claims: claims({ issuedAt: staleIssuedAt }), requestId: "r1", correlationId: "c1", organizationIdHint: undefined });
    await globalUsers.logoutAll(ctx.principal.userId);

    await expect(
      resolver.resolve({ claims: claims({ tokenId: "jti-old", issuedAt: staleIssuedAt }), requestId: "r2", correlationId: "c2", organizationIdHint: undefined }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects a token issued before deviceLogoutAfter for a revoked device", async () => {
    const { store, organizations, resolver, globalUsers } = makeResolver();
    await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1");
    const staleIssuedAt = new Date(Date.now() - 60_000).toISOString();
    const ctx = await resolver.resolve({ claims: claims({ deviceId: "device-1", issuedAt: staleIssuedAt }), requestId: "r1", correlationId: "c1", organizationIdHint: undefined });
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
      resolver.resolve({ claims: claims({ deviceId: "device-1", tokenId: "jti-old", issuedAt: staleIssuedAt }), requestId: "r2", correlationId: "c2", organizationIdHint: undefined }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  // Mutação: checar `user.identityStatus` só na criação (não a cada resolve()) deixaria este
  // teste passar mesmo com a suspensão aplicada depois do primeiro login bem-sucedido.
  it("suspended identity (GlobalUser.identityStatus) is rejected even with a valid token", async () => {
    const { store, organizations, resolver, globalUsers } = makeResolver();
    await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1");
    const ctx = await resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1", organizationIdHint: undefined });
    const user = await globalUsers.get(ctx.principal.userId);
    await store.update({ ...user!, identityStatus: "SUSPENDED" });

    await expect(
      resolver.resolve({ claims: claims({ tokenId: "jti-2" }), requestId: "r2", correlationId: "c2", organizationIdHint: undefined }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});

describe("RequestContextResolver - Organization lifecycle gate (physical model §11's chain ends 'TenantLifecycleRecord ACTIVE')", () => {
  // Mutação: remover a leitura de tenantLifecycleKey(membership.organizationId)/o check de
  // status ACTIVE do resolver faria este teste (única evidência de que o gate existe de
  // verdade, não só na documentação do arquivo) passar mesmo com o tenant DELETING. Wave B2B-6
  // (D-101): `resolveWorkingOrganization()` substitui o `AuthenticationError` (401) que este
  // caso costumava lançar por `OrganizationUnavailableError` (403) - achado real de
  // inconsistência pré-existente corrigido na Rodada 3 do debate de escopo.
  it("rejects when the Organization's own TenantLifecycleRecord is not ACTIVE, even with a real ACTIVE Membership", async () => {
    const { store, organizations, resolver } = makeResolver();
    const { organizationId } = await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1");
    const lifecycle = await organizations.get<TenantLifecycleRecord>(tenantLifecycleKey(organizationId));
    organizations.forceUpdate({ ...lifecycle!, status: "DELETING" });

    await expect(resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1", organizationIdHint: undefined })).rejects.toBeInstanceOf(OrganizationUnavailableError);
  });

  it("resolves normally when the Organization's TenantLifecycleRecord is ACTIVE (sanity, not just the negative case)", async () => {
    const { store, organizations, resolver } = makeResolver();
    const { organizationId } = await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1");
    const lifecycle = await organizations.get<TenantLifecycleRecord>(tenantLifecycleKey(organizationId));
    expect(lifecycle?.status).toBe(TENANT_ACTIVE_STATUS);

    const ctx = await resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1", organizationIdHint: undefined });
    expect(ctx.tenant.tenantId).toBe(organizationId);
  });
});

describe("RequestContextResolver - Membership role resolution (B2B-7, D-097/D-098)", () => {
  // Mutação: remover "ADMIN" da lista aceita em resolveRoles() (voltar ao estado pré-B2B-7)
  // faria esta asserção lançar UnsupportedMembershipRoleError em vez de resolver normalmente -
  // exatamente o gap que B2B-7 fecha (D-095 achado 2.2).
  it("resolves ADMIN into RequestContext.tenant.roles instead of throwing UnsupportedMembershipRoleError", async () => {
    const { store, organizations, resolver } = makeResolver();
    const { userId, organizationId } = await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1");
    const membership = await organizations.get(membershipKey(organizationId, userId));
    organizations.forceUpdate({ ...(membership as Record<string, unknown> & { PK: string; SK: string }), role: "ADMIN" });

    const ctx = await resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1", organizationIdHint: undefined });
    expect(ctx.tenant.roles).toEqual(["ADMIN"]);
  });

  // Mutação: remover o assert de resolveRoles() por completo (deixar o cast unsafe de
  // authorization.ts decidir sozinho) faria este teste não lançar UnsupportedMembershipRoleError
  // para um valor de role fora do domínio real de Membership["role"] - fail-closed preservado
  // mesmo depois de B2B-7 ampliar o domínio aceito de 3 para 4 valores.
  it("still throws UnsupportedMembershipRoleError for a role value outside the real 4-value domain (corrupted data)", async () => {
    const { store, organizations, resolver } = makeResolver();
    const { userId, organizationId } = await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1");
    const membership = await organizations.get(membershipKey(organizationId, userId));
    organizations.forceUpdate({ ...(membership as Record<string, unknown> & { PK: string; SK: string }), role: "SUPERADMIN" });

    const rejection = await resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1", organizationIdHint: undefined }).catch((err: unknown) => err);
    expect(rejection).toBeInstanceOf(UnsupportedMembershipRoleError);
  });
});

// Wave B2B-13 (E2E/Adversarial Security, D-112, Q6/Q7 of roadmap-evolution/17 §121): closes 2
// real gaps found while auditing existing coverage - a real Membership revocation had never been
// chained with a subsequent resolve() in the same test (only the WRITE side, "status becomes
// REMOVED", was ever proven - membership-management.test.ts), and no test used genuinely
// different roles per Organization for the same user (both existing multi-org tests used OWNER
// in both orgs, never proving a role from one Organization can't leak into another's authorize()).
describe("RequestContextResolver - Membership revocation and cross-org role isolation (Q6/Q7)", () => {
  // Mutação: `RemoveMembershipService.remove()` deixando de gravar `status: "REMOVED"` (ou
  // `resolveActiveMembership()` deixando de checar `status === "ACTIVE"`) faria este teste passar
  // mesmo com o acesso já revogado - a cadeia escrita-then-leitura no MESMO teste é o que prova
  // que a revogação é respeitada de verdade, não só gravada.
  it("a real RemoveMembershipService revocation is respected by a subsequent resolve() for the removed user, scoped to that Organization", async () => {
    const { store, organizations, resolver } = makeResolver();
    const { organizationId: sharedOrg } = await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-owner");

    // The member also owns their OWN, unrelated Organization - this isolates the assertion to
    // "access to THIS org is revoked" (resolveWorkingOrganization's OrganizationUnavailableError)
    // rather than conflating it with the separate onboarding gate that would fire first if this
    // were the member's ONLY membership (a member with zero usable memberships anywhere gets
    // OnboardingRequiredError instead, a real and correct - but different - denial).
    const { userId: memberUserId, organizationId: memberOwnOrg } = await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-member");

    const ids = makeIdGenerator();
    const membershipId = ids.newMembershipId();
    organizations.forceUpdate({
      ...membershipKey(sharedOrg, memberUserId),
      entityType: "Membership",
      membershipId,
      organizationId: sharedOrg,
      userId: memberUserId,
      role: "MEMBER",
      status: "ACTIVE",
      joinedAt: "2026-08-30T00:00:00.000Z",
      createdBy: memberUserId,
      version: 1,
      ...membershipGsi4Keys(memberUserId, sharedOrg, membershipId),
    });

    // Sanity - the member can resolve the shared org BEFORE removal (proves the setup is real).
    const beforeCtx = await resolver.resolve({ claims: claims({ sub: "cognito-sub-member" }), requestId: "r1", correlationId: "c1", organizationIdHint: sharedOrg });
    expect(beforeCtx.tenant.tenantId).toBe(sharedOrg);

    const ownerCtx = await resolver.resolve({ claims: claims({ sub: "cognito-sub-owner" }), requestId: "r2", correlationId: "c2", organizationIdHint: sharedOrg });
    const noAssignedItems = { findAssignedActiveItems: async () => ({ itemIds: [], totalKnown: 0, truncated: false }) };
    const removeMembership = new RemoveMembershipService(organizations, "MainTable", ids, noAssignedItems);
    await removeMembership.remove(ownerCtx, memberUserId, 1);

    await expect(
      resolver.resolve({ claims: claims({ sub: "cognito-sub-member", tokenId: "jti-2" }), requestId: "r3", correlationId: "c3", organizationIdHint: sharedOrg }),
    ).rejects.toBeInstanceOf(OrganizationUnavailableError);

    // The member's OWN Organization is untouched - proves the revocation is scoped, not a
    // blanket "this user can never resolve anything again".
    const stillWorksCtx = await resolver.resolve({ claims: claims({ sub: "cognito-sub-member", tokenId: "jti-3" }), requestId: "r4", correlationId: "c4", organizationIdHint: memberOwnOrg });
    expect(stillWorksCtx.tenant.tenantId).toBe(memberOwnOrg);
  });

  // Mutação: `resolveRoles()` ou `authorize()` lendo o role de uma Membership errada (ex.
  // reaproveitando um valor cacheado da última Organization resolvida) faria este teste passar
  // mesmo com o role real da Organization B sendo diferente - prova que o role resolvido reflete
  // sempre a Organization ATIVA no momento, nunca vaza de outra Membership do mesmo usuário.
  it("a role never leaks between Organizations - MEMBER in one, OWNER in another, same user", async () => {
    const { store, organizations, resolver } = makeResolver();
    const { userId, organizationId: orgA } = await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1");
    const membershipA = await organizations.get(membershipKey(orgA, userId));
    organizations.forceUpdate({ ...(membershipA as Record<string, unknown> & { PK: string; SK: string }), role: "MEMBER" });

    const { organizationId: orgB } = await bootstrapWithOrganization(store, organizations, "MainTable", "cognito-sub-1-second-org-fixture");
    const ids = makeIdGenerator();
    const membershipIdB = ids.newMembershipId();
    organizations.forceUpdate({
      ...membershipKey(orgB, userId),
      entityType: "Membership",
      membershipId: membershipIdB,
      organizationId: orgB,
      userId,
      role: "OWNER",
      status: "ACTIVE",
      joinedAt: "2026-08-30T00:00:00.000Z",
      createdBy: userId,
      version: 1,
      ...membershipGsi4Keys(userId, orgB, membershipIdB),
    });

    const ctxA = await resolver.resolve({ claims: claims(), requestId: "r1", correlationId: "c1", organizationIdHint: orgA });
    expect(ctxA.tenant.roles).toEqual(["MEMBER"]);

    const ctxB = await resolver.resolve({ claims: claims({ tokenId: "jti-2" }), requestId: "r2", correlationId: "c2", organizationIdHint: orgB });
    expect(ctxB.tenant.roles).toEqual(["OWNER"]);
  });
});
