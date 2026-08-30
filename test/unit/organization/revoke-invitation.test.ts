import { describe, expect, it } from "vitest";
import { CreateInvitationService } from "../../../src/modules/organization/application/create-invitation.js";
import { RevokeInvitationService } from "../../../src/modules/organization/application/revoke-invitation.js";
import { MembershipInviteRateLimiter } from "../../../src/modules/organization/application/membership-invite-rate-limiter.js";
import { InMemoryOrganizationStore } from "./in-memory-store.js";
import { organizationKey, type Organization } from "../../../src/modules/organization/domain/organization.js";
import { membershipKey, type Membership } from "../../../src/modules/organization/domain/membership.js";
import { invitationDedupKey, invitationKey, type Invitation } from "../../../src/modules/organization/domain/invitation.js";
import { NotFoundError } from "../../../src/shared/errors/app-error.js";
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

function ownerCtx(): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: "user-owner", cognitoSubject: "sub-owner", sessionId: "s1" },
    tenant: { tenantId: "org-1", roles: ["OWNER"] },
    auth: { issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T01:00:00.000Z", tokenId: "t1" },
  };
}

async function seedOrganization(store: InMemoryOrganizationStore): Promise<void> {
  store.forceUpdate({
    ...organizationKey("org-1"),
    entityType: "Organization",
    organizationId: "org-1",
    displayName: "Acme",
    timezone: "America/Sao_Paulo",
    ownerCount: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
  } satisfies Organization);
  store.forceUpdate({
    ...membershipKey("org-1", "user-owner"),
    entityType: "Membership",
    membershipId: "membership-owner",
    organizationId: "org-1",
    userId: "user-owner",
    role: "OWNER",
    status: "ACTIVE",
    joinedAt: "2026-01-01T00:00:00.000Z",
    createdBy: "user-owner",
    version: 1,
    GSI4PK: "USER#user-owner",
    GSI4SK: "ORG#org-1#MEMBERSHIP#membership-owner",
  } satisfies Membership);
}

describe("RevokeInvitationService", () => {
  // Mutação: remover o `Delete InvitationDedupPointer` da transação de revoke faria este e-mail
  // continuar bloqueado para um convite novo mesmo depois de revogar o anterior.
  it("revokes a pending invitation and frees the (org, email) dedup slot for a new invite", async () => {
    const store = new InMemoryOrganizationStore();
    await seedOrganization(store);
    const rateLimiter = new MembershipInviteRateLimiter(store);
    const createService = new CreateInvitationService(store, TABLE, ids(), rateLimiter, "pepper");
    const { invitation } = await createService.invite(ownerCtx(), { email: "revoke-me@example.com", role: "MEMBER" });

    const revokeService = new RevokeInvitationService(store, TABLE, ids());
    await revokeService.revoke(ownerCtx(), invitation.invitationId);

    const revoked = await store.get<Invitation>(invitationKey("org-1", invitation.invitationId));
    expect(revoked?.status).toBe("REVOKED");
    const dedup = await store.get(invitationDedupKey("org-1", "revoke-me@example.com"));
    expect(dedup).toBeUndefined();

    // Reaproveita o e-mail liberado para um convite novo - prova que o dedup foi realmente
    // removido, não só que o status mudou.
    await expect(createService.invite(ownerCtx(), { email: "revoke-me@example.com", role: "MEMBER" })).resolves.toBeDefined();
  });

  // Mutação: remover a checagem `invitation.status !== "PENDING"` (tentar revogar de novo sem
  // checar o estado atual) faria este teste não lançar NotFoundError.
  it("rejects revoking an invitation that is not PENDING", async () => {
    const store = new InMemoryOrganizationStore();
    await seedOrganization(store);
    const rateLimiter = new MembershipInviteRateLimiter(store);
    const createService = new CreateInvitationService(store, TABLE, ids(), rateLimiter, "pepper");
    const { invitation } = await createService.invite(ownerCtx(), { email: "once@example.com", role: "MEMBER" });
    const revokeService = new RevokeInvitationService(store, TABLE, ids());
    await revokeService.revoke(ownerCtx(), invitation.invitationId);

    await expect(revokeService.revoke(ownerCtx(), invitation.invitationId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
