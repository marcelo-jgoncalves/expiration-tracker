import { describe, expect, it } from "vitest";
import { ChangeMembershipRoleService } from "../../../src/modules/organization/application/change-membership-role.js";
import { RemoveMembershipService } from "../../../src/modules/organization/application/remove-membership.js";
import { LeaveOrganizationService } from "../../../src/modules/organization/application/leave-organization.js";
import { ListMembersService, ListInvitationsService } from "../../../src/modules/organization/application/list-membership.js";
import { InMemoryOrganizationStore } from "./in-memory-store.js";
import { organizationKey, type Organization } from "../../../src/modules/organization/domain/organization.js";
import { membershipKey, type Membership, type MembershipRole } from "../../../src/modules/organization/domain/membership.js";
import { LastOwnerError, OwnerTierChangeRequiresOwnerError } from "../../../src/shared/errors/app-error.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
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

function ctx(userId: string, roles: string[]): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId, cognitoSubject: `sub-${userId}`, sessionId: "s1" },
    tenant: { tenantId: "org-1", roles },
    auth: { issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T01:00:00.000Z", tokenId: "t1" },
  };
}

function seedMembership(store: InMemoryOrganizationStore, userId: string, role: MembershipRole, status: Membership["status"] = "ACTIVE"): void {
  store.forceUpdate({
    ...membershipKey("org-1", userId),
    entityType: "Membership",
    membershipId: `membership-${userId}`,
    organizationId: "org-1",
    userId,
    role,
    status,
    joinedAt: "2026-01-01T00:00:00.000Z",
    createdBy: userId,
    version: 1,
    GSI4PK: `USER#${userId}`,
    GSI4SK: `ORG#org-1#MEMBERSHIP#membership-${userId}`,
  } satisfies Membership);
}

function seedOrganization(store: InMemoryOrganizationStore, ownerCount: number): void {
  store.forceUpdate({
    ...organizationKey("org-1"),
    entityType: "Organization",
    organizationId: "org-1",
    displayName: "Acme",
    timezone: "America/Sao_Paulo",
    ownerCount,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
  } satisfies Organization);
}

describe("ChangeMembershipRoleService", () => {
  // Mutação: remover "ADMIN" de ADMIN_ROLES em authorization.ts (ou remover a chamada a
  // authorize() aqui) faria um MEMBER conseguir chamar role-change - a matriz baseline continua
  // sendo a primeira linha de defesa antes da checagem de tier OWNER.
  it("denies MEMBER from changing any role (matrix baseline)", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-member", "MEMBER");
    seedMembership(store, "user-viewer", "VIEWER");
    const service = new ChangeMembershipRoleService(store, TABLE, ids());

    await expect(service.changeRole(ctx("user-member", ["MEMBER"]), "user-viewer", "ADMIN", 1)).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  // Mutação: remover a checagem `involvesOwnerTier && !ctx.tenant.roles.includes("OWNER")` faria
  // um ADMIN promover outro membro a OWNER - nenhuma fonte pesquisada (GitHub/Slack/Linear/
  // Notion) mostra um Admin tocando o tier Owner.
  it("denies ADMIN promoting a MEMBER to OWNER", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-admin", "ADMIN");
    seedMembership(store, "user-member", "MEMBER");
    const service = new ChangeMembershipRoleService(store, TABLE, ids());

    await expect(service.changeRole(ctx("user-admin", ["ADMIN"]), "user-member", "OWNER", 1)).rejects.toBeInstanceOf(OwnerTierChangeRequiresOwnerError);
  });

  // Mesma classe do achado acima, mas do outro lado da transição: ADMIN não pode DEMOVER um
  // OWNER existente. Mutação: mesma checagem removida.
  it("denies ADMIN demoting an existing OWNER", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 2);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-owner-2", "OWNER");
    seedMembership(store, "user-admin", "ADMIN");
    const service = new ChangeMembershipRoleService(store, TABLE, ids());

    await expect(service.changeRole(ctx("user-admin", ["ADMIN"]), "user-owner-2", "MEMBER", 1)).rejects.toBeInstanceOf(OwnerTierChangeRequiresOwnerError);
  });

  // Mutação: remover `buildOwnerCountDeltaEntry`/a entry de ownerCount da transação (ou trocar
  // sua ConditionExpression por algo sempre-verdadeiro) faria isto NÃO lançar LastOwnerError -
  // demover o único OWNER ACTIVE para MEMBER deve ser bloqueado atomicamente.
  it("blocks demoting the organization's last ACTIVE OWNER (LastOwnerError)", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    const service = new ChangeMembershipRoleService(store, TABLE, ids());

    await expect(service.changeRole(ctx("user-owner", ["OWNER"]), "user-owner", "MEMBER", 1)).rejects.toBeInstanceOf(LastOwnerError);
  });

  // Mutação: remover `ADMIN` de ADMIN_ROLES (voltar ao estado pré-B2B-7) faria esta asserção
  // lançar em vez de suceder - ADMIN gerencia MEMBER/VIEWER livremente, só não toca o tier OWNER.
  it("allows ADMIN to change a MEMBER's role to VIEWER", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-admin", "ADMIN");
    seedMembership(store, "user-member", "MEMBER");
    const service = new ChangeMembershipRoleService(store, TABLE, ids());

    await service.changeRole(ctx("user-admin", ["ADMIN"]), "user-member", "VIEWER", 1);
    const updated = await store.get<Membership>(membershipKey("org-1", "user-member"));
    expect(updated?.role).toBe("VIEWER");
  });
});

describe("RemoveMembershipService", () => {
  // Mutação: remover a checagem de tier OWNER faria um ADMIN remover um OWNER.
  it("denies ADMIN removing an OWNER", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 2);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-owner-2", "OWNER");
    seedMembership(store, "user-admin", "ADMIN");
    const service = new RemoveMembershipService(store, TABLE, ids());

    await expect(service.remove(ctx("user-admin", ["ADMIN"]), "user-owner-2", 1)).rejects.toBeInstanceOf(OwnerTierChangeRequiresOwnerError);
  });

  // Mutação: remover a entry de ownerCount da transação de remove faria isto não lançar
  // LastOwnerError - remover o único OWNER ACTIVE deve ser bloqueado atomicamente.
  it("blocks removing the organization's last ACTIVE OWNER (LastOwnerError)", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    const service = new RemoveMembershipService(store, TABLE, ids());

    await expect(service.remove(ctx("user-owner", ["OWNER"]), "user-owner", 1)).rejects.toBeInstanceOf(LastOwnerError);
  });

  // Mutação: usar `Put` incondicional em vez de `Update` com `#status = :removed` faria a
  // Membership sumir (hard-delete) em vez de virar REMOVED (retenção/auditoria).
  it("soft-removes a MEMBER (status REMOVED, never hard-delete)", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-member", "MEMBER");
    const service = new RemoveMembershipService(store, TABLE, ids());

    await service.remove(ctx("user-owner", ["OWNER"]), "user-member", 1);
    const removed = await store.get<Membership>(membershipKey("org-1", "user-member"));
    expect(removed?.status).toBe("REMOVED");
  });
});

describe("LeaveOrganizationService", () => {
  // Mutação: remover a entry de ownerCount da transação de leave faria o único OWNER conseguir
  // sair, deixando a organização sem nenhum OWNER - o achado central de last-owner protection,
  // convergência 4/4 nas fontes pesquisadas (GitHub/Slack/Linear/Notion).
  it("blocks the organization's last ACTIVE OWNER from leaving", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    const service = new LeaveOrganizationService(store, TABLE, ids());

    await expect(service.leave(ctx("user-owner", ["OWNER"]))).rejects.toBeInstanceOf(LastOwnerError);
  });

  // Mutação: a assinatura de leave() aceitando um targetUserId externo (em vez de operar só
  // sobre ctx.principal.userId) permitiria removê-lo disfarçado de "leave" - este teste prova
  // que um MEMBER só consegue sair de si mesmo (não há parâmetro para mirar outra pessoa).
  it("lets a non-owner MEMBER leave freely", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-member", "MEMBER");
    const service = new LeaveOrganizationService(store, TABLE, ids());

    await service.leave(ctx("user-member", ["MEMBER"]));
    const membership = await store.get<Membership>(membershipKey("org-1", "user-member"));
    expect(membership?.status).toBe("REMOVED");
  });
});

describe("ListMembersService / ListInvitationsService", () => {
  // Mutação: mudar "membership:list-members" de READ_ONLY_ROLES para ADMIN_ROLES faria um
  // VIEWER não conseguir listar membros - qualquer papel real deve poder ver a lista de membros.
  it("allows VIEWER to list members", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-viewer", "VIEWER");
    const service = new ListMembersService(store);

    const members = await service.listMembers(ctx("user-viewer", ["VIEWER"]));
    expect(members.map((m) => m.userId).sort()).toEqual(["user-owner", "user-viewer"]);
  });

  // Mutação: manter "membership:list-invitations" como READ_ONLY_ROLES (mesma tier de
  // list-members) faria um VIEWER ver convites pendentes (e-mail + intenção) - achado real da
  // Rodada 1 do Codex, corrigido no checklist v2.
  it("denies VIEWER from listing pending invitations (privacy - email + intent)", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-viewer", "VIEWER");
    const service = new ListInvitationsService(store);

    await expect(service.listInvitations(ctx("user-viewer", ["VIEWER"]))).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it("allows ADMIN to list pending invitations", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-admin", "ADMIN");
    const service = new ListInvitationsService(store);

    await expect(service.listInvitations(ctx("user-admin", ["ADMIN"]))).resolves.toEqual([]);
  });
});
