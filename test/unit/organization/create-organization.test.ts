import { describe, expect, it } from "vitest";
import { ValidationError } from "../../../src/shared/errors/app-error.js";
import { CreateOrganizationService } from "../../../src/modules/organization/application/create-organization.js";
import { organizationKey, type Organization } from "../../../src/modules/organization/domain/organization.js";
import { membershipKey, type Membership } from "../../../src/modules/organization/domain/membership.js";
import { tenantLifecycleKey, type TenantLifecycleRecord } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";
import { entitlementKey, type TenantEntitlement } from "../../../src/modules/subject/domain/entitlement.js";
import { notificationEntitlementsKey, type NotificationEntitlements } from "../../../src/modules/notification/domain/notification-entitlements.js";
import { notificationPreferencesKey, type NotificationPreferences } from "../../../src/modules/notification/domain/notification-preferences.js";
import { InMemoryOrganizationStore } from "./in-memory-store.js";
import { authorizedTenantIdFromPersistedEntity } from "../../../src/modules/identity/domain/authorization.js";

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

    const orgRow = await store.get<Organization>(organizationKey(authorizedTenantIdFromPersistedEntity({ tenantId: organization.organizationId })));
    expect(orgRow).toEqual(organization);

    const membershipRow = await store.get<Membership>(membershipKey(authorizedTenantIdFromPersistedEntity({ tenantId: organization.organizationId }), "user-1"));
    expect(membershipRow).toEqual(membership);
    expect(membershipRow?.role).toBe("OWNER");
    expect(membershipRow?.status).toBe("ACTIVE");

    const lifecycle = await store.get<TenantLifecycleRecord>(tenantLifecycleKey(organization.organizationId));
    expect(lifecycle?.status).toBe("ACTIVE");

    const entitlement = await store.get<TenantEntitlement>(entitlementKey(authorizedTenantIdFromPersistedEntity({ tenantId: organization.organizationId })));
    expect(entitlement).toBeDefined();
    expect(entitlement?.planId).toBe("free");
  });

  // PENDING_PROTOCOL_REVIEW (decisions-log.md): antes desta mudança, nenhum tenant recebia
  // NotificationEntitlements, e o router fail-closed em RETRY para sempre. Mutação: remover o
  // 5º entry (`NotificationEntitlements`) da transação faria este registro ficar `undefined`.
  it("seeds NotificationEntitlements atomically - email enabled by default, WhatsApp disabled pending legal clearance (E-019)", async () => {
    const store = new InMemoryOrganizationStore();
    const service = new CreateOrganizationService(store, "MainTable", makeIds(), () => "2026-08-30T00:00:00.000Z");

    const { organization } = await service.createOrganization({ creatorUserId: "user-1", displayName: "Acme Inc", timezone: "UTC" });

    const tenantId = authorizedTenantIdFromPersistedEntity({ tenantId: organization.organizationId });
    const notificationEntitlements = await store.get<NotificationEntitlements>(notificationEntitlementsKey(tenantId));
    expect(notificationEntitlements).toBeDefined();
    expect(notificationEntitlements?.email.enabled).toBe(true);
    expect(notificationEntitlements?.whatsapp.enabled).toBe(false);
  });

  // D-332 (revisão adversarial de D-315/D-316, achado real do Codex): antes desta mudança,
  // `NotificationPreferences` nunca era seedado na criação da Organization - só
  // `NotificationEntitlements` (D-315) era. Um OWNER recém-criado que nunca abrisse a tela de
  // configurações de notificação ficava com `preference.emailEnabled === undefined`, e o router
  // falha fechado em `RETRY` infinito (`PREFERENCE_UNAVAILABLE`) - o mesmo sintoma que D-315
  // resolveu para o entitlement, mas reaberto pelo preference. Mutação: remover o 6º entry
  // (`NotificationPreferences`) da transação faria este registro ficar `undefined`.
  it("seeds NotificationPreferences atomically for the OWNER - email enabled by default, ONBOARDING provenance", async () => {
    const store = new InMemoryOrganizationStore();
    const service = new CreateOrganizationService(store, "MainTable", makeIds(), () => "2026-08-30T00:00:00.000Z");

    const { organization } = await service.createOrganization({ creatorUserId: "user-1", displayName: "Acme Inc", timezone: "UTC" });

    const tenantId = authorizedTenantIdFromPersistedEntity({ tenantId: organization.organizationId });
    const preferences = await store.get<NotificationPreferences>(notificationPreferencesKey(tenantId, "user-1"));
    expect(preferences).toBeDefined();
    expect(preferences?.emailEnabled).toBe(true);
    expect(preferences?.consentSource).toBe("ONBOARDING");
    expect(preferences?.locale).toBe("pt-BR");
  });

  // Mutação: esquecer de chamar `this.pickReminderLocalTime()` (ou não passar o resultado para
  // o objeto Organization) deixaria `defaultReminderLocalTime` `undefined` mesmo com um picker
  // injetado que nunca retorna undefined - a asserção de igualdade exata pegaria isso.
  it("seeds defaultReminderLocalTime from the injected picker, not a hardcoded value", async () => {
    const store = new InMemoryOrganizationStore();
    const service = new CreateOrganizationService(store, "MainTable", makeIds(), () => "2026-08-30T00:00:00.000Z", () => "14:30");

    const { organization } = await service.createOrganization({ creatorUserId: "user-1", displayName: "Acme Inc", timezone: "America/Sao_Paulo" });

    expect(organization.defaultReminderLocalTime).toBe("14:30");
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
    const firstRow = await store.get<Organization>(organizationKey(authorizedTenantIdFromPersistedEntity({ tenantId: first.organization.organizationId })));
    const secondRow = await store.get<Organization>(organizationKey(authorizedTenantIdFromPersistedEntity({ tenantId: second.organization.organizationId })));
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

    const row = await store.get<Organization>(organizationKey(authorizedTenantIdFromPersistedEntity({ tenantId: organization.organizationId })));
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
