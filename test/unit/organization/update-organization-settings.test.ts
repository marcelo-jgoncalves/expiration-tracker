import { describe, expect, it } from "vitest";
import { UpdateOrganizationSettingsService } from "../../../src/modules/organization/application/update-organization-settings.js";
import { InMemoryOrganizationStore } from "./in-memory-store.js";
import { organizationKey, type Organization } from "../../../src/modules/organization/domain/organization.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import { ConflictError, NotFoundError, ValidationError } from "../../../src/shared/errors/app-error.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";

const TABLE = "MainTable";

function ctx(userId: string, roles: string[]): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId, cognitoSubject: `sub-${userId}`, sessionId: "s1" },
    tenant: { tenantId: "org-1", roles },
    auth: { issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T01:00:00.000Z", tokenId: "t1" },
  };
}

function seedOrganization(store: InMemoryOrganizationStore): void {
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
}

describe("UpdateOrganizationSettingsService", () => {
  // Mutação: remover "OWNER_ROLES" da entrada da matriz (ou trocar por ADMIN_ROLES) faria um
  // ADMIN conseguir renomear a Organization - a pesquisa/precedente deste projeto (mesma tier de
  // tenant:configure-document-request-delivery) mantém isso OWNER-only.
  it("denies ADMIN from updating settings (OWNER-only tier)", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store);
    const service = new UpdateOrganizationSettingsService(store, TABLE);

    await expect(service.update(ctx("user-admin", ["ADMIN"]), { displayName: "New Name" }, 1)).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it("allows OWNER to update displayName only, leaving timezone untouched", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store);
    const service = new UpdateOrganizationSettingsService(store, TABLE);

    const result = await service.update(ctx("user-owner", ["OWNER"]), { displayName: "Acme Corp" }, 1);

    expect(result.displayName).toBe("Acme Corp");
    expect(result.timezone).toBe("America/Sao_Paulo");
    const stored = await store.get<Organization>(organizationKey("org-1"));
    expect(stored?.displayName).toBe("Acme Corp");
    expect(stored?.version).toBe(2);
  });

  it("allows OWNER to update timezone only, leaving displayName untouched", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store);
    const service = new UpdateOrganizationSettingsService(store, TABLE);

    const result = await service.update(ctx("user-owner", ["OWNER"]), { timezone: "UTC" }, 1);

    expect(result.timezone).toBe("UTC");
    expect(result.displayName).toBe("Acme");
  });

  // Mutação: remover a checagem "displayName === undefined && timezone === undefined" faria uma
  // chamada sem nenhum campo silenciosamente virar um no-op versionado (version incrementa sem
  // nenhuma mudança real), em vez de recusar explicitamente.
  it("rejects an update with neither displayName nor timezone", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store);
    const service = new UpdateOrganizationSettingsService(store, TABLE);

    await expect(service.update(ctx("user-owner", ["OWNER"]), {}, 1)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a blank displayName", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store);
    const service = new UpdateOrganizationSettingsService(store, TABLE);

    await expect(service.update(ctx("user-owner", ["OWNER"]), { displayName: "   " }, 1)).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws NotFoundError for an Organization that does not exist", async () => {
    const store = new InMemoryOrganizationStore();
    const service = new UpdateOrganizationSettingsService(store, TABLE);

    await expect(service.update(ctx("user-owner", ["OWNER"]), { displayName: "X" }, 1)).rejects.toBeInstanceOf(NotFoundError);
  });

  // Mutação: remover o ConditionExpression "version = :expectedVersion" (ou não capturar
  // isTransactionCanceled) faria uma escrita concorrente stale sobrescrever silenciosamente, em
  // vez de reportar um conflito real ao chamador.
  it("throws ConflictError on a stale expectedVersion (OCC)", async () => {
    const store = new InMemoryOrganizationStore();
    seedOrganization(store);
    const service = new UpdateOrganizationSettingsService(store, TABLE);
    await service.update(ctx("user-owner", ["OWNER"]), { displayName: "First" }, 1);

    await expect(service.update(ctx("user-owner", ["OWNER"]), { displayName: "Second" }, 1)).rejects.toBeInstanceOf(ConflictError);
  });
});
