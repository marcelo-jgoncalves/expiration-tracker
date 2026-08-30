import { describe, expect, it } from "vitest";
import { BffAuthService } from "../../../src/modules/bff/application/bff-auth-service.js";
import { InMemorySessionStore } from "./in-memory-session-store.js";
import { FakeCognitoOidcClient, FakeIdTokenVerifier, FakeTokenEncryptor } from "./fakes.js";
import { InMemoryIdentityStore } from "../identity/in-memory-store.js";
import { InMemoryOrganizationStore } from "../organization/in-memory-store.js";
import { IdentityBootstrapService } from "../../../src/modules/identity/application/bootstrap-identity.js";
import { GlobalUserRepository } from "../../../src/modules/identity/persistence/global-user-repository.js";
import { CreateOrganizationService } from "../../../src/modules/organization/application/create-organization.js";
import { AcceptInvitationService } from "../../../src/modules/organization/application/accept-invitation.js";
import { ProxyService, type BackendFetcher } from "../../../src/modules/bff/application/proxy-service.js";
import type { Session } from "../../../src/modules/bff/domain/session.js";
import { membershipKey } from "../../../src/modules/organization/domain/membership.js";
import { organizationKey, type Organization } from "../../../src/modules/organization/domain/organization.js";
import { tenantLifecycleKey, type TenantLifecycleRecord } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";

const TABLE = "MainTable";

function buildService() {
  const sessionStore = new InMemorySessionStore();
  const identityStore = new InMemoryIdentityStore();
  const organizations = new InMemoryOrganizationStore();
  const bootstrap = new IdentityBootstrapService(identityStore, TABLE);
  const globalUsers = new GlobalUserRepository(identityStore);
  let orgIdCounter = 0;
  const ids = () => ({
    newOrganizationId: () => `org-${++orgIdCounter}`,
    newMembershipId: () => `membership-${orgIdCounter}`,
    newInvitationId: () => `invitation-${orgIdCounter}`,
    newAuditEventId: () => `audit-${orgIdCounter}`,
  });
  const createOrganization = new CreateOrganizationService(organizations, TABLE, ids());
  const acceptInvitation = new AcceptInvitationService(organizations, TABLE, ids(), "test-pepper");
  let userCounter = 0;
  let deviceCounter = 0;

  const service = new BffAuthService({
    sessionStore,
    cognitoClient: new FakeCognitoOidcClient(),
    idTokenVerifier: new FakeIdTokenVerifier(),
    tokenEncryptor: new FakeTokenEncryptor(),
    bootstrap,
    globalUsers,
    organizations,
    mainTableName: TABLE,
    createOrganization,
    acceptInvitation,
    pepper: "test-pepper",
    redirectUri: "https://app.example.com/bff/callback",
    authorizeUrl: "https://auth.example.com/oauth2/authorize",
    clientId: "client-1",
    now: () => "2026-08-30T00:00:00.000Z",
    newUserId: () => `user-${++userCounter}`,
    newDeviceId: () => `device-${++deviceCounter}`,
  });

  return { service, sessionStore, organizations };
}

async function loginOnce(ctx: ReturnType<typeof buildService>) {
  const started = await ctx.service.startLogin("/");
  const url = new URL(started.redirectUrl);
  const state = url.searchParams.get("state")!;
  return ctx.service.handleCallback({ loginCookie: started.loginToken, code: "auth-code-1", state });
}

/** Grafts a second ACTIVE Membership (+ Organization + TenantLifecycleRecord) for a userId that
 * already has one — synthetic (no real writer produces a 2nd ACTIVE Membership for the same user
 * outside of a real 2nd invitation accept), same pattern as
 * test/unit/identity/resolver.test.ts's multi-org fixture. */
function graftSecondOrganization(organizations: InMemoryOrganizationStore, userId: string, organizationId: string, lifecycleStatus: "ACTIVE" | "DELETING" = "ACTIVE"): void {
  organizations.forceUpdate({
    ...organizationKey(organizationId),
    entityType: "Organization",
    organizationId,
    displayName: "Second Org",
    timezone: "America/Sao_Paulo",
    ownerCount: 1,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    version: 1,
  } satisfies Organization);
  organizations.forceUpdate({
    ...tenantLifecycleKey(organizationId),
    SK: "LIFECYCLE",
    entityType: "TenantLifecycleRecord",
    tenantId: organizationId,
    status: lifecycleStatus,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    version: 1,
  } satisfies TenantLifecycleRecord);
  organizations.forceUpdate({
    ...membershipKey(organizationId, userId),
    entityType: "Membership",
    membershipId: "membership-second",
    organizationId,
    userId,
    role: "OWNER",
    status: "ACTIVE",
    joinedAt: "2026-08-30T00:00:00.000Z",
    createdBy: userId,
    version: 1,
    GSI4PK: `USER#${userId}`,
    GSI4SK: `ORG#${organizationId}#MEMBERSHIP#membership-second`,
  });
}

describe("ProxyService - X-Organization-Id boundary (Wave B2B-6, D-101)", () => {
  // Mutação: encaminhar `req.headers["x-organization-id"]` (repassar o que o browser mandou)
  // em vez de gerar o header sempre a partir de `session.activeOrganizationId` faria esta
  // asserção falhar - Tenant Context Injection (OWASP), o browser nunca pode influenciar este
  // header.
  it("ignores a browser-supplied x-organization-id header entirely, using only the session's own value", async () => {
    let capturedHeaders: Record<string, string> = {};
    const backend: BackendFetcher = {
      async fetch(input) {
        capturedHeaders = input.headers;
        return { statusCode: 200, headers: {}, body: "{}" };
      },
    };
    const proxy = new ProxyService(backend, "https://api.example.com");
    const session: Session = {
      PK: "SESSION#x",
      SK: "POINTER",
      entityType: "Session",
      selectorHash: "x",
      secretHash: "y",
      activeOrganizationId: "org-real",
      userId: "user-1",
      cognitoSubject: "sub-1",
      deviceId: "device-1",
      csrfSecret: "csrf",
      encryptedRefreshToken: "enc",
      accessToken: "access-token",
      accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
      absoluteExpiresAt: "2099-01-01T00:00:00.000Z",
      purgeAfterTtl: 4000000000,
      refreshState: "IDLE",
      createdAt: "2026-08-30T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
      version: 1,
    };

    await proxy.forward(session, { method: "GET", path: "/items/dashboard", headers: { "x-organization-id": "org-attacker" } });

    expect(capturedHeaders["x-organization-id"]).toBe("org-real");
  });
});

describe("BffAuthService.selectOrganization (Wave B2B-6, D-101)", () => {
  // Mutação: não revalidar via resolveWorkingOrganization() (confiar no organizationId do
  // corpo do request) faria isto suceder mesmo para uma organização de que o usuário não é
  // membro.
  it("rejects selecting an organization the user has no real Membership in", async () => {
    const ctx = buildService();
    const result = await loginOnce(ctx);
    const session = await ctx.service.resolveSession(result.sessionToken);

    const outcome = await ctx.service.selectOrganization(session, "org-not-mine");
    expect(outcome.ok).toBe(false);
  });

  it("selects a real, usable organization and CAS-writes it onto the session", async () => {
    const ctx = buildService();
    const result = await loginOnce(ctx);
    const session = await ctx.service.resolveSession(result.sessionToken);
    const { organizationId } = await ctx.service.createOrganization(session, { displayName: "Acme", timezone: "UTC" });

    const outcome = await ctx.service.selectOrganization(session, organizationId);
    expect(outcome.ok).toBe(true);
    const updated = await ctx.service.resolveSession(result.sessionToken);
    expect(updated.activeOrganizationId).toBe(organizationId);
  });
});

describe("BffAuthService.resolveSessionWithOnboarding - multi-org cardinality (Wave B2B-6, D-101)", () => {
  // Mutação: "pega a primeira" em vez de organizationSelectionRequired faria isto retornar um
  // activeOrganizationId específico em vez de reportar ambiguidade - nunca escolher por conta
  // própria entre organizações igualmente válidas.
  it("reports organizationSelectionRequired (never picks one) when the user has 2 usable organizations and no prior selection", async () => {
    const ctx = buildService();
    const result = await loginOnce(ctx);
    const session = await ctx.service.resolveSession(result.sessionToken);
    const { organizationId: firstOrgId } = await ctx.service.createOrganization(session, { displayName: "Acme", timezone: "UTC" });
    graftSecondOrganization(ctx.organizations, session.userId, "org-second");
    // createOrganization() já auto-selecionou firstOrgId na sessão (bookkeeping normal, D-096) -
    // limpa explicitamente para testar a regra de cardinalidade em isolamento, simulando uma
    // sessão sem seleção prévia válida (ex. um segundo dispositivo nunca logado antes).
    const sessionAfterCreate = await ctx.service.resolveSession(result.sessionToken);
    await ctx.sessionStore.updateConditional<Session>(
      { ...sessionAfterCreate, activeOrganizationId: undefined, version: sessionAfterCreate.version + 1 },
      { version: sessionAfterCreate.version },
    );

    const withOnboarding = await ctx.service.resolveSessionWithOnboarding(result.sessionToken);
    expect(withOnboarding.activeOrganizationId).toBeUndefined();
    expect(withOnboarding.organizationSelectionRequired?.organizations.map((o) => o.organizationId).sort()).toEqual(["org-second", firstOrgId].sort());
  });

  // Mutação: remover a revalidação de `session.activeOrganizationId` (confiar nele sem checar
  // resolveWorkingOrganization()) faria isto continuar apontando para uma organização cujo
  // lifecycle não é mais ACTIVE - "invalid selection recovery" do escopo de B2B-6.
  it("clears and re-derives a stale activeOrganizationId whose Organization lifecycle is no longer ACTIVE", async () => {
    const ctx = buildService();
    const result = await loginOnce(ctx);
    const session = await ctx.service.resolveSession(result.sessionToken);
    const { organizationId } = await ctx.service.createOrganization(session, { displayName: "Acme", timezone: "UTC" });
    await ctx.service.selectOrganization(session, organizationId);

    const lifecycle = await ctx.organizations.get<TenantLifecycleRecord>(tenantLifecycleKey(organizationId));
    ctx.organizations.forceUpdate({ ...lifecycle!, status: "DELETING" });

    const withOnboarding = await ctx.service.resolveSessionWithOnboarding(result.sessionToken);
    expect(withOnboarding.activeOrganizationId).toBeUndefined();
    // Nenhuma outra organização usável existe - honesto sobre "Membership existe, nada
    // utilizável agora" em vez de onboardingState (achado da Rodada 3 do debate de escopo).
    expect(withOnboarding.organizationSelectionRequired).toEqual({ organizations: [] });
  });

  // Wave B2B-9 (D-104): a Organization completamente deletada (status terminal DELETED, não só
  // DELETING) deve disparar exatamente a mesma auto-cura de sessão - a distinção "session
  // behavior" do escopo de B2B-9 já era coberta pelo mecanismo de B2B-6, mas nenhum teste
  // existente nomeava o estado terminal explicitamente.
  // Mutação: se resolveWorkingOrganization() tratasse DELETED como um caso especial não coberto
  // pelo "qualquer status != ACTIVE" genérico, este teste falharia com activeOrganizationId ainda
  // apontando para a organização deletada.
  it("clears and re-derives a stale activeOrganizationId whose Organization lifecycle reached the terminal DELETED status", async () => {
    const ctx = buildService();
    const result = await loginOnce(ctx);
    const session = await ctx.service.resolveSession(result.sessionToken);
    const { organizationId } = await ctx.service.createOrganization(session, { displayName: "Acme", timezone: "UTC" });
    await ctx.service.selectOrganization(session, organizationId);

    const lifecycle = await ctx.organizations.get<TenantLifecycleRecord>(tenantLifecycleKey(organizationId));
    ctx.organizations.forceUpdate({ ...lifecycle!, status: "DELETED" });

    const withOnboarding = await ctx.service.resolveSessionWithOnboarding(result.sessionToken);
    expect(withOnboarding.activeOrganizationId).toBeUndefined();
    expect(withOnboarding.organizationSelectionRequired).toEqual({ organizations: [] });
  });

  // Wave B2B-9 (D-104): cenário multi-org real - a Organization ativa da sessão é deletada, mas o
  // usuário ainda tem uma segunda Membership usável; a sessão deve se autocurar para a
  // organização sobrevivente (regra de cardinalidade "1 usável -> self-heal" de B2B-6), nunca
  // ficar presa a organizationSelectionRequired vazio nem à organização deletada.
  it("self-heals to the surviving Organization when the session's active Organization is deleted but a second Membership remains usable", async () => {
    const ctx = buildService();
    const result = await loginOnce(ctx);
    const session = await ctx.service.resolveSession(result.sessionToken);
    const { organizationId: deletedOrgId } = await ctx.service.createOrganization(session, { displayName: "Acme", timezone: "UTC" });
    await ctx.service.selectOrganization(session, deletedOrgId);
    graftSecondOrganization(ctx.organizations, session.userId, "org-survivor", "ACTIVE");

    const lifecycle = await ctx.organizations.get<TenantLifecycleRecord>(tenantLifecycleKey(deletedOrgId));
    ctx.organizations.forceUpdate({ ...lifecycle!, status: "DELETED" });

    const withOnboarding = await ctx.service.resolveSessionWithOnboarding(result.sessionToken);
    expect(withOnboarding.activeOrganizationId).toBe("org-survivor");
  });

  // Prova multi-sessão: 2 sessões do mesmo usuário mantêm activeOrganizationId
  // independentemente - verificado por leitura direta do schema (sem GSI por userId) na própria
  // Rodada 1 do debate de escopo, este teste prova o comportamento observável.
  it("keeps activeOrganizationId independent across 2 real sessions (2 logins) of the same user", async () => {
    const ctx = buildService();
    const resultA = await loginOnce(ctx);
    const sessionA = await ctx.service.resolveSession(resultA.sessionToken);
    const { organizationId: orgA } = await ctx.service.createOrganization(sessionA, { displayName: "Acme", timezone: "UTC" });
    graftSecondOrganization(ctx.organizations, sessionA.userId, "org-b-for-same-user");

    // Segundo login real (mesmo cognitoSub via FakeIdTokenVerifier -> mesmo userId via
    // IdentityMapping, mas uma linha de Session NOVA e distinta - device/selector diferentes).
    const resultB = await loginOnce(ctx);
    const sessionB = await ctx.service.resolveSession(resultB.sessionToken);
    expect(sessionB.userId).toBe(sessionA.userId);
    expect(sessionB.PK).not.toBe(sessionA.PK);

    await ctx.service.selectOrganization(sessionA, orgA);
    await ctx.service.selectOrganization(sessionB, "org-b-for-same-user");

    const sessionAAfter = await ctx.service.resolveSession(resultA.sessionToken);
    const sessionBAfter = await ctx.service.resolveSession(resultB.sessionToken);
    expect(sessionAAfter.activeOrganizationId).toBe(orgA);
    expect(sessionBAfter.activeOrganizationId).toBe("org-b-for-same-user");
  });
});

describe("BffAuthService.listOrganizations (Wave B2B-6, D-101)", () => {
  // Mutação: remover o filtro de lifecycle de listUsableOrganizations() faria esta lista
  // incluir uma organização que select()/o recurso rejeitariam depois (achado real da Rodada 1
  // do Codex).
  it("excludes an organization whose TenantLifecycleRecord is not ACTIVE, even with a real ACTIVE Membership", async () => {
    const ctx = buildService();
    const result = await loginOnce(ctx);
    const session = await ctx.service.resolveSession(result.sessionToken);
    const { organizationId } = await ctx.service.createOrganization(session, { displayName: "Acme", timezone: "UTC" });
    graftSecondOrganization(ctx.organizations, session.userId, "org-inactive", "DELETING");

    const list = await ctx.service.listOrganizations(session.userId);
    expect(list.map((o) => o.organizationId)).toEqual([organizationId]);
  });
});
