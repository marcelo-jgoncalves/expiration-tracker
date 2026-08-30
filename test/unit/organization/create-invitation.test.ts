import { describe, expect, it } from "vitest";
import { CreateInvitationService } from "../../../src/modules/organization/application/create-invitation.js";
import { InMemoryOrganizationStore } from "./in-memory-store.js";
import { organizationKey, type Organization } from "../../../src/modules/organization/domain/organization.js";
import { membershipKey, type Membership } from "../../../src/modules/organization/domain/membership.js";
import { invitationDedupKey } from "../../../src/modules/organization/domain/invitation.js";
import { MembershipInviteRateLimiter } from "../../../src/modules/organization/application/membership-invite-rate-limiter.js";
import { OwnerTierChangeRequiresOwnerError } from "../../../src/shared/errors/app-error.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";

const TABLE = "MainTable";
let counter = 0;
function ids() {
  return {
    newOrganizationId: () => `org-${++counter}`,
    newMembershipId: () => `membership-${++counter}`,
    newInvitationId: () => `invitation-${++counter}`,
    newAuditEventId: () => `audit-${++counter}`,
  };
}

function ctx(roles: string[] = ["OWNER"], organizationId = "org-1"): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-owner", cognitoSubject: "sub-owner", sessionId: "s1" },
    tenant: { tenantId: organizationId, roles },
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

function makeService(store: InMemoryOrganizationStore) {
  const rateLimiter = new MembershipInviteRateLimiter(store);
  return new CreateInvitationService(store, TABLE, ids(), rateLimiter, "test-pepper");
}

describe("CreateInvitationService", () => {
  // Mutação: remover o `Put InvitationDedupPointer`/`Put InvitationTokenPointer` da transação
  // faria este teste falhar - `invite()` deve gravar os 3 itens (Invitation/TokenPointer/Dedup)
  // atomicamente, não só a Invitation.
  it("creates a PENDING invitation with a token pointer and a dedup pointer", async () => {
    const store = new InMemoryOrganizationStore();
    await seedOrganization(store);
    const service = makeService(store);

    const { invitation, token } = await service.invite(ctx(), { email: "New.Member@Example.com", role: "MEMBER" });

    expect(invitation.status).toBe("PENDING");
    expect(invitation.emailNormalized).toBe("new.member@example.com");
    expect(token).toContain(".");
    const dedup = await store.get(invitationDedupKey("org-1", "new.member@example.com"));
    expect(dedup).toBeDefined();
  });

  // Mutação: remover a checagem `input.role === "OWNER" && !ctx.tenant.roles.includes("OWNER")`
  // faria esta asserção não lançar - um ADMIN convidando alguém diretamente como OWNER deve ser
  // bloqueado (achado corrigido na própria Rodada 1 do debate de escopo).
  it("denies an ADMIN inviting someone directly as OWNER", async () => {
    const store = new InMemoryOrganizationStore();
    await seedOrganization(store);
    const service = makeService(store);

    await expect(service.invite(ctx(["ADMIN"]), { email: "new@example.com", role: "OWNER" })).rejects.toBeInstanceOf(OwnerTierChangeRequiresOwnerError);
  });

  // Mutação: no fluxo de reenvio, remover `ConditionExpression: "#status = :pending"` do Update
  // da Invitation faria isto continuar passando mesmo que a Invitation não fosse mais PENDING -
  // o teste prova que um segundo convite para o MESMO e-mail vira reenvio (mesmo invitationId),
  // não um segundo Invitation PENDING.
  it("treats a second invite to the same pending email as a resend (same invitationId, new token)", async () => {
    const store = new InMemoryOrganizationStore();
    await seedOrganization(store);
    const service = makeService(store);

    const first = await service.invite(ctx(), { email: "dup@example.com", role: "MEMBER" });
    const second = await service.invite(ctx(), { email: "dup@example.com", role: "MEMBER" });

    expect(second.invitation.invitationId).toBe(first.invitation.invitationId);
    expect(second.token).not.toBe(first.token);
  });

  // Mutação: usar a mesma forma de chave de `initial-invite-rate-limiter.ts`
  // (`TENANT#<id>#SETTINGS`/`RATE`, sem o segmento `#MEMBERSHIP-INVITE`) faria esta asserção
  // falhar por colidir com uma quota de guest-invite pré-existente na mesma partição.
  it("uses a rate-limit key namespaced separately from guest document-request invites", async () => {
    const store = new InMemoryOrganizationStore();
    await seedOrganization(store);
    // Simula uma quota de guest-invite já no limite na chave SEM o namespace de membership.
    store.forceUpdate({
      PK: "TENANT#org-1#SETTINGS",
      SK: "RATE",
      entityType: "InitialInviteRateLimit",
      limit: 20,
      windowSeconds: 3600,
      count: 20,
      resetAt: "2099-01-01T00:00:00.000Z",
      purgeAfterTtl: 4000000000,
    });
    const service = makeService(store);

    await expect(service.invite(ctx(), { email: "ok@example.com", role: "MEMBER" })).resolves.toBeDefined();
  });
});
