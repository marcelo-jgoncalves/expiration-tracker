import { describe, expect, it } from "vitest";
import { ChangeMembershipRoleService } from "../../../src/modules/organization/application/change-membership-role.js";
import { TransferOwnershipService } from "../../../src/modules/organization/application/transfer-ownership.js";
import { RemoveMembershipService } from "../../../src/modules/organization/application/remove-membership.js";
import { LeaveOrganizationService } from "../../../src/modules/organization/application/leave-organization.js";
import { ListMembersService, ListInvitationsService } from "../../../src/modules/organization/application/list-membership.js";
import { InMemoryOrganizationStore } from "./in-memory-store.js";
import { organizationKey, type Organization } from "../../../src/modules/organization/domain/organization.js";
import { membershipKey, type Membership, type MembershipRole } from "../../../src/modules/organization/domain/membership.js";
import {
  LastOwnerError,
  OwnerTierChangeRequiresOwnerError,
  ResponsibilityReassignmentRequiredError,
  ConflictError,
  NotFoundError,
  SelfOwnershipTransferError,
  OwnershipTransferTargetAlreadyOwnerError,
  OwnershipTransferTargetIneligibleError,
} from "../../../src/shared/errors/app-error.js";
import { membershipAuditKey, type MembershipAuditEvent } from "../../../src/modules/organization/domain/audit-event.js";
import { AuthorizationDeniedError, authorizedTenantIdFromPersistedEntity } from "../../../src/modules/identity/domain/authorization.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";
import type { AssignedActiveItemsLookup } from "../../../src/modules/organization/ports/assigned-active-items-lookup.js";
import type { AssignedActiveRequirementsLookup } from "../../../src/modules/organization/ports/assigned-active-requirements-lookup.js";
import { GlobalUserRepository } from "../../../src/modules/identity/persistence/global-user-repository.js";
import { InMemoryIdentityStore } from "../identity/in-memory-store.js";

/** Test double for `AssignedActiveItemsLookup` - `assignments` maps `userId` to the ACTIVE
 * `ExpirationItem` ids assigned to them, defaulting an unlisted user to "no active items" (the
 * common case in most of these tests, which don't exercise the reassignment mechanism). */
function fakeAssignedItems(assignments: Record<string, string[]> = {}): AssignedActiveItemsLookup {
  return {
    async findAssignedActiveItems(_organizationId: string, userId: string) {
      const itemIds = assignments[userId] ?? [];
      return { itemIds, totalKnown: itemIds.length, truncated: false };
    },
  };
}

/** D-194 Fatia 2 - sibling test double for `AssignedActiveRequirementsLookup`, same shape/
 * defaulting convention as `fakeAssignedItems` above. */
function fakeAssignedRequirements(assignments: Record<string, string[]> = {}): AssignedActiveRequirementsLookup {
  return {
    async findAssignedActiveRequirements(_organizationId: string, userId: string) {
      const requirementIds = assignments[userId] ?? [];
      return { requirementIds, totalKnownRequirements: requirementIds.length, truncatedRequirements: false };
    },
  };
}

const ORG_1 = authorizedTenantIdFromPersistedEntity({ tenantId: "org-1" });
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

function ctx(userId: string, roles: string[], correlationId = "c1"): RequestContext {
  return {
    requestId: "r1",
    correlationId,
    principal: { userId, cognitoSubject: `sub-${userId}`, sessionId: "s1" },
    tenant: { tenantId: "org-1", roles },
    auth: { issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T01:00:00.000Z", tokenId: "t1" },
  };
}

function seedMembership(store: InMemoryOrganizationStore, userId: string, role: MembershipRole, status: Membership["status"] = "ACTIVE"): void {
  store.forceUpdate({
    ...membershipKey(ORG_1,userId),
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
    ...organizationKey(ORG_1),
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
    const updated = await store.get<Membership>(membershipKey(ORG_1,"user-member"));
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
    const service = new RemoveMembershipService(store, TABLE, ids(), fakeAssignedItems(), fakeAssignedRequirements());

    await expect(service.remove(ctx("user-admin", ["ADMIN"]), "user-owner-2", 1)).rejects.toBeInstanceOf(OwnerTierChangeRequiresOwnerError);
  });

  // Mutação: remover a entry de ownerCount da transação de remove faria isto não lançar
  // LastOwnerError - remover o único OWNER ACTIVE deve ser bloqueado atomicamente.
  it("blocks removing the organization's last ACTIVE OWNER (LastOwnerError)", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    const service = new RemoveMembershipService(store, TABLE, ids(), fakeAssignedItems(), fakeAssignedRequirements());

    await expect(service.remove(ctx("user-owner", ["OWNER"]), "user-owner", 1)).rejects.toBeInstanceOf(LastOwnerError);
  });

  // Mutação: usar `Put` incondicional em vez de `Update` com `#status = :removed` faria a
  // Membership sumir (hard-delete) em vez de virar REMOVED (retenção/auditoria).
  it("soft-removes a MEMBER (status REMOVED, never hard-delete)", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-member", "MEMBER");
    const service = new RemoveMembershipService(store, TABLE, ids(), fakeAssignedItems(), fakeAssignedRequirements());

    await service.remove(ctx("user-owner", ["OWNER"]), "user-member", 1);
    const removed = await store.get<Membership>(membershipKey(ORG_1,"user-member"));
    expect(removed?.status).toBe("REMOVED");
  });

  // D-155/D-157: removedAt is the clock the ACCOUNT_ACTIVE LGPD purge worker (D-127 Prioridade 5)
  // needs for "encerramento + 30 dias" - it was the missing blocker this field closes. Mutação:
  // remover `removedAt = :now` do SET (voltar a só status+version) faria isto ficar undefined.
  it("stamps removedAt when soft-removing a member", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-member", "MEMBER");
    const service = new RemoveMembershipService(store, TABLE, ids(), fakeAssignedItems(), fakeAssignedRequirements(), () => "2026-06-15T10:00:00.000Z");

    await service.remove(ctx("user-owner", ["OWNER"]), "user-member", 1);
    const removed = await store.get<Membership>(membershipKey(ORG_1,"user-member"));
    expect(removed?.removedAt).toBe("2026-06-15T10:00:00.000Z");
  });

  // D-179/D-180: the GSI8 (MaintenanceDueIndex) pointer must land ATOMICALLY in the same
  // transaction as the REMOVED transition, never a separate write - this is what lets
  // membership-purge's worker discover the candidate via Query instead of a full Scan. Mutação:
  // dropping the GSI8PK/GSI8SK SET clause (or computing it from the wrong removedAt) would leave
  // this undetected/mismatched.
  it("writes the GSI8 MaintenanceDueIndex pointer atomically when soft-removing a member", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-member", "MEMBER");
    const service = new RemoveMembershipService(store, TABLE, ids(), fakeAssignedItems(), fakeAssignedRequirements(), () => "2026-06-15T10:00:00.000Z");

    await service.remove(ctx("user-owner", ["OWNER"]), "user-member", 1);
    const removed = await store.get<Membership>(membershipKey(ORG_1,"user-member"));
    expect(removed?.GSI8PK).toBe("WORK#MEMBERSHIP_PURGE");
    expect(removed?.GSI8SK).toBe(`2026-07-15T10:00:00.000Z#TENANT#org-1#membership-user-member`);
  });

  // Mutação: uma condição frouxa que ainda assim marca removedAt num write que não deveria ter
  // acontecido (ex. ignorar expectedVersion) deixaria isto detectável só por este teste - uma
  // remoção que falha por versão desatualizada não deve deixar nenhum rastro no registro.
  it("leaves removedAt unset when the remove fails its version condition", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-member", "MEMBER");
    const service = new RemoveMembershipService(store, TABLE, ids(), fakeAssignedItems(), fakeAssignedRequirements());

    await expect(service.remove(ctx("user-owner", ["OWNER"]), "user-member", 999)).rejects.toThrow();
    const stillActive = await store.get<Membership>(membershipKey(ORG_1,"user-member"));
    expect(stillActive?.status).toBe("ACTIVE");
    expect(stillActive?.removedAt).toBeUndefined();
  });

  // D-122/D-125 (Responsibility Reassignment on Member Removal). Mutação: remover a checagem
  // `if (assigned.itemIds.length > 0) throw ...` (ou trocar por uma condição sempre-falsa) faria
  // isto NÃO lançar ResponsibilityReassignmentRequiredError - o membro seria removido mesmo
  // ainda sendo assignee de um item ACTIVE, perdendo rastreabilidade silenciosamente.
  it("blocks removing a member who is still the assignee of an ACTIVE item", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-member", "MEMBER");
    const service = new RemoveMembershipService(store, TABLE, ids(), fakeAssignedItems({ "user-member": ["item-1"] }), fakeAssignedRequirements());

    const err = await service.remove(ctx("user-owner", ["OWNER"]), "user-member", 1).catch((e) => e);
    expect(err).toBeInstanceOf(ResponsibilityReassignmentRequiredError);
    expect(err.details).toMatchObject({ targetUserId: "user-member", itemIds: ["item-1"], totalKnown: 1, truncated: false });
    const stillActive = await store.get<Membership>(membershipKey(ORG_1,"user-member"));
    expect(stillActive?.status).toBe("ACTIVE");
  });

  // D-194 Fatia 2 - additive contract test: when ONLY Requirements are found (no ExpirationItem),
  // the pre-existing `itemIds`/`totalKnown`/`truncated` fields stay exactly as they were before
  // this slice (empty/zero/false), and the NEW `requirements` field carries the finding. Mutação:
  // dropping the `assignedReqs.requirementIds.length > 0` branch of the OR (or the `requirements`
  // spread) would make this member removable despite a real, undiscovered Requirement assignment.
  it("blocks removing a member who is still the assignee of a Requirement (no ExpirationItem involved)", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-member", "MEMBER");
    const service = new RemoveMembershipService(store, TABLE, ids(), fakeAssignedItems(), fakeAssignedRequirements({ "user-member": ["req-1", "req-2"] }));

    const err = await service.remove(ctx("user-owner", ["OWNER"]), "user-member", 1).catch((e) => e);
    expect(err).toBeInstanceOf(ResponsibilityReassignmentRequiredError);
    expect(err.details).toMatchObject({
      targetUserId: "user-member",
      itemIds: [],
      totalKnown: 0,
      truncated: false,
      requirements: { requirementIds: ["req-1", "req-2"], totalKnownRequirements: 2, truncatedRequirements: false },
    });
    const stillActive = await store.get<Membership>(membershipKey(ORG_1,"user-member"));
    expect(stillActive?.status).toBe("ACTIVE");
  });

  // D-194 Fatia 2 - proves `requirements` is genuinely ABSENT (not an empty/undefined key) when
  // nothing is found, so a caller checking `"requirements" in err.details` sees the field only
  // when it's meaningful.
  it("never includes a `requirements` key when no Requirement is assigned", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-member", "MEMBER");
    const service = new RemoveMembershipService(store, TABLE, ids(), fakeAssignedItems({ "user-member": ["item-1"] }), fakeAssignedRequirements());

    const err = await service.remove(ctx("user-owner", ["OWNER"]), "user-member", 1).catch((e) => e);
    expect(err).toBeInstanceOf(ResponsibilityReassignmentRequiredError);
    expect("requirements" in err.details).toBe(false);
  });

  // Mutação: inverter a ordem (checar assigned items antes do tier OWNER) mudaria qual erro um
  // ADMIN tentando remover um OWNER-com-itens-atribuídos veria primeiro - a checagem de
  // autorização/tier deve vencer, porque ela decide SE o caller pode agir, antes de qualquer
  // pergunta sobre o estado do alvo.
  it("surfaces OwnerTierChangeRequiresOwnerError before the reassignment check when both apply", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 2);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-owner-2", "OWNER");
    seedMembership(store, "user-admin", "ADMIN");
    const service = new RemoveMembershipService(store, TABLE, ids(), fakeAssignedItems({ "user-owner-2": ["item-1"] }), fakeAssignedRequirements());

    await expect(service.remove(ctx("user-admin", ["ADMIN"]), "user-owner-2", 1)).rejects.toBeInstanceOf(OwnerTierChangeRequiresOwnerError);
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
    const service = new LeaveOrganizationService(store, TABLE, ids(), fakeAssignedItems(), fakeAssignedRequirements());

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
    const service = new LeaveOrganizationService(store, TABLE, ids(), fakeAssignedItems(), fakeAssignedRequirements());

    await service.leave(ctx("user-member", ["MEMBER"]));
    const membership = await store.get<Membership>(membershipKey(ORG_1,"user-member"));
    expect(membership?.status).toBe("REMOVED");
  });

  // D-155/D-157, same clock as RemoveMembershipService - a voluntary leave is just as much a
  // ACCOUNT_ACTIVE (não-fechamento) termination as an admin removal.
  it("stamps removedAt when a member leaves voluntarily", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-member", "MEMBER");
    const service = new LeaveOrganizationService(store, TABLE, ids(), fakeAssignedItems(), fakeAssignedRequirements(), () => "2026-06-15T10:00:00.000Z");

    await service.leave(ctx("user-member", ["MEMBER"]));
    const membership = await store.get<Membership>(membershipKey(ORG_1,"user-member"));
    expect(membership?.removedAt).toBe("2026-06-15T10:00:00.000Z");
  });

  // D-179/D-180 - same atomic-pointer invariant as RemoveMembershipService's own test above.
  it("writes the GSI8 MaintenanceDueIndex pointer atomically when a member leaves voluntarily", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-member", "MEMBER");
    const service = new LeaveOrganizationService(store, TABLE, ids(), fakeAssignedItems(), fakeAssignedRequirements(), () => "2026-06-15T10:00:00.000Z");

    await service.leave(ctx("user-member", ["MEMBER"]));
    const membership = await store.get<Membership>(membershipKey(ORG_1,"user-member"));
    expect(membership?.GSI8PK).toBe("WORK#MEMBERSHIP_PURGE");
    expect(membership?.GSI8SK).toBe(`2026-07-15T10:00:00.000Z#TENANT#org-1#membership-user-member`);
  });

  // D-122/D-125. Mutação: mesma classe do teste equivalente em RemoveMembershipService - remover
  // a checagem de assigned items faria leave() suceder mesmo com itens ACTIVE ainda atribuídos.
  it("blocks a member from leaving while still the assignee of an ACTIVE item", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-member", "MEMBER");
    const service = new LeaveOrganizationService(store, TABLE, ids(), fakeAssignedItems({ "user-member": ["item-1", "item-2"] }), fakeAssignedRequirements());

    const err = await service.leave(ctx("user-member", ["MEMBER"])).catch((e) => e);
    expect(err).toBeInstanceOf(ResponsibilityReassignmentRequiredError);
    expect(err.details).toMatchObject({ targetUserId: "user-member", totalKnown: 2, truncated: false });
    const stillActive = await store.get<Membership>(membershipKey(ORG_1,"user-member"));
    expect(stillActive?.status).toBe("ACTIVE");
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
    const service = new ListMembersService(store, new GlobalUserRepository(new InMemoryIdentityStore()));

    const members = await service.listMembers(ctx("user-viewer", ["VIEWER"]));
    expect(members.map((m) => m.userId).sort()).toEqual(["user-owner", "user-viewer"]);
  });

  // #15 (2026-09-21): email/displayName resolve from GlobalUser only when the identity is
  // ACTIVE - a suspended identity's PII must never surface, even to teammates within the same
  // tenant (same rule notification/persistence/dynamodb-recipient-resolver.ts already enforces).
  it("resolves email/displayName only for an ACTIVE global identity, never for a suspended one", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-active", "MEMBER");
    seedMembership(store, "user-suspended", "MEMBER");
    const identityStore = new InMemoryIdentityStore();
    await identityStore.update({
      PK: "USER#user-active",
      SK: "PROFILE",
      entityType: "GlobalUser",
      userId: "user-active",
      emailNormalized: "active@example.com",
      displayName: "Ana Ativa",
      identityStatus: "ACTIVE",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    });
    await identityStore.update({
      PK: "USER#user-suspended",
      SK: "PROFILE",
      entityType: "GlobalUser",
      userId: "user-suspended",
      emailNormalized: "suspenso@example.com",
      displayName: "Bruno Suspenso",
      identityStatus: "SUSPENDED",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
    });
    const service = new ListMembersService(store, new GlobalUserRepository(identityStore));

    const members = await service.listMembers(ctx("user-active", ["MEMBER"]));
    const active = members.find((m) => m.userId === "user-active");
    const suspended = members.find((m) => m.userId === "user-suspended");

    expect(active).toMatchObject({ email: "active@example.com", displayName: "Ana Ativa" });
    expect(suspended?.email).toBeUndefined();
    expect(suspended?.displayName).toBeUndefined();
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

describe("TransferOwnershipService", () => {
  const NOW = "2026-09-28T12:00:00.000Z";

  function seedActiveIdentity(identityStore: InMemoryIdentityStore, userId: string, identityStatus: "ACTIVE" | "SUSPENDED" = "ACTIVE"): Promise<unknown> {
    return identityStore.update({
      PK: `USER#${userId}`,
      SK: "PROFILE",
      entityType: "GlobalUser",
      userId,
      emailNormalized: `${userId}@example.com`,
      identityStatus,
      createdAt: NOW,
      updatedAt: NOW,
      version: 1,
    });
  }

  function makeService(store: InMemoryOrganizationStore, identityStore: InMemoryIdentityStore): TransferOwnershipService {
    return new TransferOwnershipService(store, TABLE, ids(), new GlobalUserRepository(identityStore), () => NOW);
  }

  // Mutação: remover "membership:transfer-ownership" de ACTION_ROLES/OWNER_ROLES (ou trocar por
  // ADMIN_ROLES) faria um ADMIN conseguir chamar transfer - a matriz baseline é a primeira linha
  // de defesa, igual ao teste equivalente de ChangeMembershipRoleService acima.
  it("denies ADMIN from transferring ownership (matrix baseline)", async () => {
    const store = new InMemoryOrganizationStore();
    const identityStore = new InMemoryIdentityStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-admin", "ADMIN");
    await seedActiveIdentity(identityStore, "user-admin");
    const service = makeService(store, identityStore);

    await expect(service.transfer(ctx("user-admin", ["ADMIN"]), "user-owner", 1, 1)).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  // Mutação: remover a checagem `targetUserId === callerUserId` faria um OWNER "transferir" para
  // si mesmo silenciosamente, em vez de um erro nomeado sem sentido de negócio.
  it("rejects transferring ownership to oneself", async () => {
    const store = new InMemoryOrganizationStore();
    const identityStore = new InMemoryIdentityStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    await seedActiveIdentity(identityStore, "user-owner");
    const service = makeService(store, identityStore);

    await expect(service.transfer(ctx("user-owner", ["OWNER"]), "user-owner", 1, 1)).rejects.toBeInstanceOf(SelfOwnershipTransferError);
  });

  it("rejects when the target has no active membership", async () => {
    const store = new InMemoryOrganizationStore();
    const identityStore = new InMemoryIdentityStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    const service = makeService(store, identityStore);

    await expect(service.transfer(ctx("user-owner", ["OWNER"]), "user-ghost", 1, 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  // Mutação: remover a checagem `target.role === "OWNER"` faria a transação prosseguir sobre um
  // alvo que já é OWNER, produzindo um estado sem sentido (dois OWNERs, um deles rebaixado à toa).
  it("rejects when the target is already an ACTIVE OWNER", async () => {
    const store = new InMemoryOrganizationStore();
    const identityStore = new InMemoryIdentityStore();
    seedOrganization(store, 2);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-owner-2", "OWNER");
    await seedActiveIdentity(identityStore, "user-owner-2");
    const service = makeService(store, identityStore);

    await expect(service.transfer(ctx("user-owner", ["OWNER"]), "user-owner-2", 1, 1)).rejects.toBeInstanceOf(OwnershipTransferTargetAlreadyOwnerError);
  });

  // Achado real da Rodada 1 do protocolo Claude<->Codex (D-348): elegibilidade do sucessor exige
  // GlobalUser.identityStatus === ACTIVE, não só Membership ACTIVE - mesma dupla checagem que
  // resolve-request-context.ts já exige para qualquer sessão autenticada.
  it("rejects when the target's global identity is not ACTIVE", async () => {
    const store = new InMemoryOrganizationStore();
    const identityStore = new InMemoryIdentityStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-suspended", "MEMBER");
    await seedActiveIdentity(identityStore, "user-suspended", "SUSPENDED");
    const service = makeService(store, identityStore);

    await expect(service.transfer(ctx("user-owner", ["OWNER"]), "user-suspended", 1, 1)).rejects.toBeInstanceOf(OwnershipTransferTargetIneligibleError);
  });

  it("rejects when the target has no GlobalUser row at all", async () => {
    const store = new InMemoryOrganizationStore();
    const identityStore = new InMemoryIdentityStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-member", "MEMBER");
    const service = makeService(store, identityStore);

    await expect(service.transfer(ctx("user-owner", ["OWNER"]), "user-member", 1, 1)).rejects.toBeInstanceOf(OwnershipTransferTargetIneligibleError);
  });

  // Achado real da Rodada 2: a checagem de versão precisa acontecer ANTES de montar a
  // transação, para que o fromRole/toRole gravado na auditoria corresponda exatamente ao estado
  // lido - nunca a uma versão hipotética mais nova que a ConditionExpression também aceitaria.
  it("rejects with ConflictError when the caller's expected version is stale", async () => {
    const store = new InMemoryOrganizationStore();
    const identityStore = new InMemoryIdentityStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-member", "MEMBER");
    await seedActiveIdentity(identityStore, "user-member");
    const service = makeService(store, identityStore);

    await expect(service.transfer(ctx("user-owner", ["OWNER"]), "user-member", 99, 1)).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects with ConflictError when the target's expected version is stale", async () => {
    const store = new InMemoryOrganizationStore();
    const identityStore = new InMemoryIdentityStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-member", "MEMBER");
    await seedActiveIdentity(identityStore, "user-member");
    const service = makeService(store, identityStore);

    await expect(service.transfer(ctx("user-owner", ["OWNER"]), "user-member", 1, 99)).rejects.toBeInstanceOf(ConflictError);
  });

  // Caso feliz completo: papéis trocados, ownerCount intocado (delta zero), e os dois eventos de
  // auditoria OWNERSHIP_TRANSFERRED gravados com o mesmo correlationId e direções opostas.
  it("swaps roles atomically, leaves ownerCount untouched, and writes a paired OWNERSHIP_TRANSFERRED audit trail", async () => {
    const store = new InMemoryOrganizationStore();
    const identityStore = new InMemoryIdentityStore();
    seedOrganization(store, 1);
    seedMembership(store, "user-owner", "OWNER");
    seedMembership(store, "user-member", "MEMBER");
    await seedActiveIdentity(identityStore, "user-member");
    const service = makeService(store, identityStore);

    await service.transfer(ctx("user-owner", ["OWNER"], "c-transfer-1"), "user-member", 1, 1);

    const caller = await store.get<Membership>(membershipKey(ORG_1, "user-owner"));
    const target = await store.get<Membership>(membershipKey(ORG_1, "user-member"));
    expect(caller).toMatchObject({ role: "ADMIN", version: 2 });
    expect(target).toMatchObject({ role: "OWNER", version: 2 });

    const org = await store.get<Organization>(organizationKey(ORG_1));
    expect(org?.ownerCount).toBe(1); // delta zero - never touched by a pure swap

    const auditPk = membershipAuditKey(ORG_1, NOW, "ignored").PK;
    const events = await store.queryByPk<MembershipAuditEvent>(auditPk);
    const transferred = events.filter((e) => e.action === "OWNERSHIP_TRANSFERRED");
    expect(transferred).toHaveLength(2);
    expect(transferred.every((e) => e.correlationId === "c-transfer-1")).toBe(true);

    const relinquished = transferred.find((e) => e.resourceId === caller!.membershipId);
    const received = transferred.find((e) => e.resourceId === target!.membershipId);
    expect(relinquished?.changes).toMatchObject({ fromRole: "OWNER", toRole: "ADMIN", counterpartUserId: "user-member", direction: "RELINQUISHED" });
    expect(received?.changes).toMatchObject({ fromRole: "MEMBER", toRole: "OWNER", counterpartUserId: "user-owner", direction: "RECEIVED" });
  });
});
