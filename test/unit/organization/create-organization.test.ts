import { describe, expect, it } from "vitest";
import { ValidationError } from "../../../src/shared/errors/app-error.js";
import { CreateOrganizationService } from "../../../src/modules/organization/application/create-organization.js";
import { organizationKey, type Organization } from "../../../src/modules/organization/domain/organization.js";
import { membershipKey, type Membership } from "../../../src/modules/organization/domain/membership.js";
import { tenantLifecycleKey, type TenantLifecycleRecord } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { entitlementKey, type TenantEntitlement } from "../../../src/modules/subject/domain/entitlement.js";
import { InMemoryOrganizationStore } from "./in-memory-store.js";

let counter = 0;
function makeIds() {
  return {
    newOrganizationId: () => `org-${++counter}`,
    newMembershipId: () => `mem-${++counter}`,
    newInvitationId: () => `invitation-${++counter}`,
    newAuditEventId: () => `audit-${++counter}`,
  };
}

// G-V3 (test-engineering-standard.md, aplicado desde a escrita per docs/engineering/
// definition-of-done.md E-013): cada `it()` abaixo tem, em comentário, pelo menos uma
// mutação concreta no código real que faria a asserção falhar.
describe("CreateOrganizationService", () => {
  // Mutação: esquecer o 4º entry (`TenantEntitlement`) na `TransactWriteItems` faria
  // `entitlement` ficar `undefined` - a asserção de `toBeDefined()` no entitlement pegaria isso.
  it("creates Organization + Membership OWNER + TenantLifecycleRecord + TenantEntitlement atomically, all linked by organizationId", async () => {
    const store = new InMemoryOrganizationStore();
    const service = new CreateOrganizationService(store, "MainTable", makeIds(), () => "2026-08-30T00:00:00.000Z");

    const { organization, membership } = await service.createOrganization({
      creatorUserId: "user-1",
      displayName: "Acme Inc",
      timezone: "America/Sao_Paulo",
    });

    const orgRow = await store.get<Organization>(organizationKey(organization.organizationId));
    expect(orgRow).toEqual(organization);

    const membershipRow = await store.get<Membership>(membershipKey(organization.organizationId, "user-1"));
    expect(membershipRow).toEqual(membership);
    expect(membershipRow?.role).toBe("OWNER");
    expect(membershipRow?.status).toBe("ACTIVE");

    const lifecycle = await store.get<TenantLifecycleRecord>(tenantLifecycleKey(organization.organizationId));
    expect(lifecycle?.status).toBe("ACTIVE");

    const entitlement = await store.get<TenantEntitlement>(entitlementKey(organization.organizationId));
    expect(entitlement).toBeDefined();
    expect(entitlement?.planId).toBe("free");
  });

  // Mutação: seedar `ownerCount: 0` (ou omitir o campo) em vez de `1` no objeto Organization
  // faria esta asserção falhar - é exatamente o valor que o mecanismo transacional de
  // ownerCount (physical model §8) depende de já existir corretamente desde a criação.
  it("seeds ownerCount=1 atomically with the first OWNER Membership - never computed later by scan", async () => {
    const store = new InMemoryOrganizationStore();
    const service = new CreateOrganizationService(store, "MainTable", makeIds(), () => "2026-08-30T00:00:00.000Z");

    const { organization } = await service.createOrganization({ creatorUserId: "user-1", displayName: "Acme Inc", timezone: "UTC" });
    expect(organization.ownerCount).toBe(1);
  });

  // Mutação: trocar `this.ids.newOrganizationId()` por `input.creatorUserId` (derivar o
  // organizationId do criador, o antipadrão que o physical model §15 proíbe explicitamente)
  // faria `organizationId === creatorUserId`, quebrando a asserção de desigualdade.
  it("organizationId is never derived from creatorUserId - independent ID by construction (distinct prefix, not just distinct value)", async () => {
    const store = new InMemoryOrganizationStore();
    const service = new CreateOrganizationService(store, "MainTable", makeIds(), () => "2026-08-30T00:00:00.000Z");

    const { organization } = await service.createOrganization({ creatorUserId: "user-1", displayName: "Acme Inc", timezone: "UTC" });
    expect(organization.organizationId).not.toBe("user-1");
    expect(organization.PK.startsWith("TENANT#user-1#")).toBe(false);
  });

  // Mutação: gerar `membershipId`/`organizationId` uma única vez por instância de serviço
  // (ex. cache-los em campo de instância) em vez de chamar `this.ids.new*Id()` a cada
  // `createOrganization()` faria a segunda chamada colidir na partição da primeira - a
  // asserção `not.toBe` entre os dois organizationId pegaria isso.
  it("two calls for the same creator produce two independent Organizations, never colliding", async () => {
    const store = new InMemoryOrganizationStore();
    const service = new CreateOrganizationService(store, "MainTable", makeIds(), () => "2026-08-30T00:00:00.000Z");

    const first = await service.createOrganization({ creatorUserId: "user-1", displayName: "Org A", timezone: "UTC" });
    const second = await service.createOrganization({ creatorUserId: "user-1", displayName: "Org B", timezone: "UTC" });

    expect(first.organization.organizationId).not.toBe(second.organization.organizationId);
    const firstRow = await store.get<Organization>(organizationKey(first.organization.organizationId));
    const secondRow = await store.get<Organization>(organizationKey(second.organization.organizationId));
    expect(firstRow?.displayName).toBe("Org A");
    expect(secondRow?.displayName).toBe("Org B");
  });

  // Mutação: usar `membershipGsi4Keys(input.creatorUserId, organizationId, organizationId)`
  // (passar organizationId em vez de membershipId por engano) ainda produziria um GSI4SK
  // válido-parecendo mas com o ID errado - a asserção de conteúdo exato do GSI4SK pegaria isso.
  it("Membership carries correct GSI4 keys (MembershipByUser) pointing at this Organization and membershipId", async () => {
    const store = new InMemoryOrganizationStore();
    const service = new CreateOrganizationService(store, "MainTable", makeIds(), () => "2026-08-30T00:00:00.000Z");

    const { organization, membership } = await service.createOrganization({ creatorUserId: "user-1", displayName: "Acme Inc", timezone: "UTC" });

    expect(membership.GSI4PK).toBe("USER#user-1");
    expect(membership.GSI4SK).toBe(`ORG#${organization.organizationId}#MEMBERSHIP#${membership.membershipId}`);

    const viaGsi4 = await store.queryGsi4({ gsi4pk: "USER#user-1" });
    expect(viaGsi4).toHaveLength(1);
    expect(viaGsi4[0]?.["organizationId"]).toBe(organization.organizationId);
  });

  // D-129 (GTR-01 supersession): Organization.displayName is now the ONLY guest-facing
  // requester identity, so it must never silently persist as whitespace. Mutação: remover o
  // `.trim()` em `buildCreateEntries()` faria este teste falhar (displayName ficaria com o
  // padding original).
  it("D-129: trims displayName before persisting", async () => {
    const store = new InMemoryOrganizationStore();
    const service = new CreateOrganizationService(store, "MainTable", makeIds(), () => "2026-08-30T00:00:00.000Z");

    const { organization } = await service.createOrganization({ creatorUserId: "user-1", displayName: "  Empresa Alfa  ", timezone: "UTC" });
    expect(organization.displayName).toBe("Empresa Alfa");

    const row = await store.get<Organization>(organizationKey(organization.organizationId));
    expect(row?.displayName).toBe("Empresa Alfa");
  });

  // Mutação: remover a checagem `if (displayName.length === 0) throw ...` em
  // `buildCreateEntries()` faria isto não lançar - a asserção de rejeição pegaria isso.
  it("D-129: rejects a whitespace-only displayName with ValidationError", async () => {
    const store = new InMemoryOrganizationStore();
    const service = new CreateOrganizationService(store, "MainTable", makeIds(), () => "2026-08-30T00:00:00.000Z");

    await expect(service.createOrganization({ creatorUserId: "user-1", displayName: "   ", timezone: "UTC" })).rejects.toBeInstanceOf(ValidationError);
  });
});
