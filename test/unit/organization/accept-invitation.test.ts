import { describe, expect, it } from "vitest";
import { CreateInvitationService } from "../../../src/modules/organization/application/create-invitation.js";
import { AcceptInvitationService } from "../../../src/modules/organization/application/accept-invitation.js";
import { MembershipInviteRateLimiter } from "../../../src/modules/organization/application/membership-invite-rate-limiter.js";
import { InMemoryOrganizationStore } from "./in-memory-store.js";
import { organizationKey, type Organization } from "../../../src/modules/organization/domain/organization.js";
import { membershipKey, type Membership } from "../../../src/modules/organization/domain/membership.js";
import type { InvitationTokenPointer } from "../../../src/modules/organization/domain/invitation-token.js";
import { ConflictError, InvitationTokenUnavailableError } from "../../../src/shared/errors/app-error.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";

const TABLE = "MainTable";
const PEPPER = "test-pepper";
let counter = 0;
function ids() {
  return {
    newOrganizationId: () => `org-${++counter}`,
    newMembershipId: () => `membership-${++counter}`,
    newInvitationId: () => `invitation-${++counter}`,
    newAuditEventId: () => `audit-${++counter}`,
  };
}

function ownerCtx(organizationId = "org-1"): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-owner", cognitoSubject: "sub-owner", sessionId: "s1" },
    tenant: { tenantId: organizationId, roles: ["OWNER"] },
    auth: { issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T01:00:00.000Z", tokenId: "t1" },
  };
}

async function seedOrganization(store: InMemoryOrganizationStore, organizationId = "org-1"): Promise<void> {
  const org: Organization = {
    ...organizationKey(organizationId),
    entityType: "Organization",
    organizationId,
    displayName: "Acme",
    timezone: "America/Sao_Paulo",
    ownerCount: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
  };
  store.forceUpdate(org);
  const membership: Membership = {
    ...membershipKey(organizationId, "user-owner"),
    entityType: "Membership",
    membershipId: "membership-owner",
    organizationId,
    userId: "user-owner",
    role: "OWNER",
    status: "ACTIVE",
    joinedAt: "2026-01-01T00:00:00.000Z",
    createdBy: "user-owner",
    version: 1,
    GSI4PK: "USER#user-owner",
    GSI4SK: `ORG#${organizationId}#MEMBERSHIP#membership-owner`,
  };
  store.forceUpdate(membership);
}

async function issueInvite(store: InMemoryOrganizationStore, email: string, role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" = "MEMBER") {
  const rateLimiter = new MembershipInviteRateLimiter(store);
  const createService = new CreateInvitationService(store, TABLE, ids(), rateLimiter, PEPPER);
  return createService.invite(ownerCtx(), { email, role });
}

describe("AcceptInvitationService", () => {
  // Mutação: remover `Update Membership` da transação (ou trocar por um `Put` incondicional)
  // faria este teste não criar a Membership com o role correto do convite.
  it("creates an ACTIVE Membership with the role from the invitation", async () => {
    const store = new InMemoryOrganizationStore();
    await seedOrganization(store);
    const { token } = await issueInvite(store, "new@example.com", "MEMBER");
    const service = new AcceptInvitationService(store, TABLE, ids(), PEPPER);

    const result = await service.accept({ token, userId: "user-new", callerVerifiedEmail: "new@example.com" });

    expect(result.role).toBe("MEMBER");
    const membership = await store.get<Membership>(membershipKey("org-1", "user-new"));
    expect(membership?.status).toBe("ACTIVE");
  });

  // Mutação: remover o incremento condicional de `ownerCount` quando `role === "OWNER"` faria
  // esta asserção falhar - aceitar um convite de OWNER deve incrementar `ownerCount` na mesma
  // transação (reaproveita o caminho de incremento previsto em D-086 §8, nunca exercitado antes).
  it("increments Organization.ownerCount when accepting an OWNER invitation", async () => {
    const store = new InMemoryOrganizationStore();
    await seedOrganization(store);
    const { token } = await issueInvite(store, "co-owner@example.com", "OWNER");
    const service = new AcceptInvitationService(store, TABLE, ids(), PEPPER);

    await service.accept({ token, userId: "user-co-owner", callerVerifiedEmail: "co-owner@example.com" });

    const org = await store.get<Organization>(organizationKey("org-1"));
    expect(org?.ownerCount).toBe(2);
  });

  // Mutação: remover `emailNormalized = :callerVerifiedEmail` da ConditionExpression do Update
  // Invitation (aceitar por posse do token sozinho) faria esta asserção não lançar - fecha
  // account-takeover (physical model §121 Q13): posse do link não basta, o e-mail verificado do
  // chamador precisa bater com o do convite.
  it("rejects acceptance when the caller's verified email does not match the invitation (anti account-takeover)", async () => {
    const store = new InMemoryOrganizationStore();
    await seedOrganization(store);
    const { token } = await issueInvite(store, "intended@example.com", "MEMBER");
    const service = new AcceptInvitationService(store, TABLE, ids(), PEPPER);

    await expect(service.accept({ token, userId: "attacker", callerVerifiedEmail: "attacker@example.com" })).rejects.toBeInstanceOf(InvitationTokenUnavailableError);
    const membership = await store.get<Membership>(membershipKey("org-1", "attacker"));
    expect(membership).toBeUndefined();
  });

  // Mutação: remover `Update InvitationTokenPointer`/sua ConditionExpression da transação (só
  // verificar `consumedAt` na resolução prévia, nunca dentro da transação) faria a SEGUNDA
  // chamada com o mesmo token também suceder - fecha replay (physical model §121 Q14).
  it("rejects a replayed token (already consumed)", async () => {
    const store = new InMemoryOrganizationStore();
    await seedOrganization(store);
    const { token } = await issueInvite(store, "replay@example.com", "MEMBER");
    const service = new AcceptInvitationService(store, TABLE, ids(), PEPPER);

    await service.accept({ token, userId: "user-replay", callerVerifiedEmail: "replay@example.com" });
    await expect(service.accept({ token, userId: "user-replay-2", callerVerifiedEmail: "replay@example.com" })).rejects.toBeInstanceOf(InvitationTokenUnavailableError);
  });

  // Mutação: remover a cláusula `expiresAt > :now` da ConditionExpression do consumo do token
  // (deixar só `attribute_not_exists(consumedAt)`) faria esta asserção não lançar - fecha a
  // corrida estreita entre a resolução prévia e o commit da transação (achado real do próprio
  // self-grade da Rodada 2 do debate de escopo).
  it("rejects a token that is already expired at the transaction's own condition, not just at pre-resolution", async () => {
    const store = new InMemoryOrganizationStore();
    await seedOrganization(store);
    const { token } = await issueInvite(store, "expired@example.com", "MEMBER");
    // Força o pointer a já estar expirado sem passar pela resolução prévia (simula a corrida:
    // o valor mudou entre a leitura e o commit) - localiza o pointer real gravado pelo invite.
    const allItems = store.allItems();
    const pointer = allItems.find((item) => item["entityType"] === "InvitationTokenPointer") as unknown as InvitationTokenPointer;
    store.forceUpdate({ ...pointer, expiresAt: "2020-01-01T00:00:00.000Z" });

    const service = new AcceptInvitationService(store, TABLE, ids(), PEPPER);
    await expect(service.accept({ token, userId: "user-x", callerVerifiedEmail: "expired@example.com" })).rejects.toBeInstanceOf(InvitationTokenUnavailableError);
  });

  // Mutação: remover a `ConditionExpression: "attribute_not_exists(PK) OR #status = :removed"`
  // do Update de Membership faria isto aceitar silenciosamente em vez de detectar "já é membro".
  it("reports a clear conflict when the caller already has an ACTIVE membership in the organization", async () => {
    const store = new InMemoryOrganizationStore();
    await seedOrganization(store);
    const { token } = await issueInvite(store, "user-owner@example.com", "MEMBER");
    const service = new AcceptInvitationService(store, TABLE, ids(), PEPPER);

    await expect(service.accept({ token, userId: "user-owner", callerVerifiedEmail: "user-owner@example.com" })).rejects.toBeInstanceOf(ConflictError);
  });

  // Mutação: remover a verificação estrutural do formato do token (`parseInvitationToken`)
  // faria um token malformado lançar um erro de infraestrutura em vez do erro genérico
  // anti-enumeration esperado.
  it("rejects a structurally invalid token with the same generic error (anti-enumeration)", async () => {
    const store = new InMemoryOrganizationStore();
    await seedOrganization(store);
    const service = new AcceptInvitationService(store, TABLE, ids(), PEPPER);

    await expect(service.accept({ token: "not-a-real-token", userId: "user-x", callerVerifiedEmail: "x@example.com" })).rejects.toBeInstanceOf(InvitationTokenUnavailableError);
  });
});
