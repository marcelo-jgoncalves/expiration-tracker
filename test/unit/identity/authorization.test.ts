import { describe, expect, it } from "vitest";
import { authorize, AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";

function ctx(overrides: Partial<RequestContext["tenant"]> = {}, userId = "user-a"): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId, cognitoSubject: "sub-a", sessionId: "s1" },
    tenant: { tenantId: "tenant-a", roles: ["OWNER"], ...overrides },
    auth: { issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-01T01:00:00.000Z", tokenId: "t1" },
  };
}

describe("authorize()", () => {
  it("allows an OWNER to act on their own tenant's resource", () => {
    expect(() =>
      authorize({ context: ctx(), action: "item:create", resource: { tenantId: "tenant-a" } }),
    ).not.toThrow();
  });

  it("denies when resource.tenantId belongs to a different tenant (cross-tenant ID swap)", () => {
    expect(() => authorize({ context: ctx(), action: "item:read", resource: { tenantId: "tenant-B" } })).toThrow(
      AuthorizationDeniedError,
    );
  });

  it("denies a principal with no roles (no membership)", () => {
    expect(() =>
      authorize({ context: ctx({ roles: [] }), action: "item:read", resource: { tenantId: "tenant-a" } }),
    ).toThrow(AuthorizationDeniedError);
  });

  it("denies VIEWER role attempting a write action", () => {
    expect(() =>
      authorize({ context: ctx({ roles: ["VIEWER"] }), action: "item:create", resource: { tenantId: "tenant-a" } }),
    ).toThrow(AuthorizationDeniedError);
  });

  it("denies MEMBER role attempting an admin-only action (delete)", () => {
    expect(() =>
      authorize({ context: ctx({ roles: ["MEMBER"] }), action: "item:delete", resource: { tenantId: "tenant-a" } }),
    ).toThrow(AuthorizationDeniedError);
  });

  it("allows action with no resource (e.g. list/create with no prior object)", () => {
    expect(() => authorize({ context: ctx(), action: "item:create" })).not.toThrow();
  });

  it("MEMBER denied access to a resource owned/assigned to someone else in the same tenant", () => {
    expect(() =>
      authorize({
        context: ctx({ roles: ["MEMBER"] }, "user-a"),
        action: "item:update",
        resource: { tenantId: "tenant-a", ownerUserId: "user-b", assigneeUserId: "user-b" },
      }),
    ).toThrow(AuthorizationDeniedError);
  });

  it("OWNER bypasses per-resource ownership mismatch (tenant-wide admin)", () => {
    expect(() =>
      authorize({
        context: ctx({ roles: ["OWNER"] }, "user-a"),
        action: "item:update",
        resource: { tenantId: "tenant-a", ownerUserId: "user-b", assigneeUserId: "user-b" },
      }),
    ).not.toThrow();
  });

  // B2B-7 (D-097/D-098): ADMIN gets parity with OWNER over business-resource actions.
  // Mutação: remover "ADMIN" de ADMIN_ROLES (voltar ao estado pré-B2B-7) faria esta asserção
  // lançar AuthorizationDeniedError("INSUFFICIENT_ROLE") em vez de passar.
  it("allows ADMIN to perform an admin-tier resource action (delete), parity with OWNER", () => {
    expect(() =>
      authorize({ context: ctx({ roles: ["ADMIN"] }), action: "item:delete", resource: { tenantId: "tenant-a" } }),
    ).not.toThrow();
  });

  // Mutação: mudar "tenant:configure-document-request-delivery" de OWNER_ROLES para ADMIN_ROLES
  // faria esta asserção não lançar - é exatamente a exceção nomeada que B2B-7 decidiu manter
  // OWNER-exclusive (config. externa/reputacional do tenant, não paritária com ADMIN).
  it("denies ADMIN the OWNER-exclusive tenant:configure-document-request-delivery action", () => {
    expect(() =>
      authorize({
        context: ctx({ roles: ["ADMIN"] }),
        action: "tenant:configure-document-request-delivery",
        resource: { tenantId: "tenant-a" },
      }),
    ).toThrow(AuthorizationDeniedError);
  });

  // Mutação: manter "notification:configure": ADMIN_ROLES (estado pré-B2B-7) faria esta
  // asserção lançar AuthorizationDeniedError - o bug fix real desta wave (VIEWER pode
  // legitimamente ser destinatário de lembretes e precisa configurar a própria preferência).
  it("allows VIEWER to configure their own notification preferences (bug fix, not an ADMIN-vs-OWNER call)", () => {
    expect(() =>
      authorize({ context: ctx({ roles: ["VIEWER"] }), action: "notification:configure", resource: { tenantId: "tenant-a" } }),
    ).not.toThrow();
  });

  // Mutação: remover "ADMIN" do bypass de ownership (linha `!roles.includes("ADMIN")`) faria
  // esta asserção lançar RESOURCE_OWNERSHIP_MISMATCH em vez de passar - espelha o teste de
  // OWNER acima, decisão explícita da Rodada 2 do debate de escopo (achado 6 do Codex).
  it("ADMIN bypasses per-resource ownership mismatch, same as OWNER", () => {
    expect(() =>
      authorize({
        context: ctx({ roles: ["ADMIN"] }, "user-a"),
        action: "item:update",
        resource: { tenantId: "tenant-a", ownerUserId: "user-b", assigneeUserId: "user-b" },
      }),
    ).not.toThrow();
  });

  // D-149 (Admin Activity/Audit Log view): activity:read is ADMIN_ROLES-gated, same tier as
  // item:export - disclosure of what OTHER members did is sensitive equivalent to bulk export.
  // Mutação: mudar "activity:read" para READ_ONLY_ROLES faria esta asserção não lançar.
  it("denies MEMBER access to activity:read (admin-only visibility into other members' actions)", () => {
    expect(() =>
      authorize({ context: ctx({ roles: ["MEMBER"] }), action: "activity:read", resource: { tenantId: "tenant-a" } }),
    ).toThrow(AuthorizationDeniedError);
  });

  it("denies VIEWER access to activity:read", () => {
    expect(() =>
      authorize({ context: ctx({ roles: ["VIEWER"] }), action: "activity:read", resource: { tenantId: "tenant-a" } }),
    ).toThrow(AuthorizationDeniedError);
  });

  it("allows ADMIN access to activity:read, parity with OWNER", () => {
    expect(() =>
      authorize({ context: ctx({ roles: ["ADMIN"] }), action: "activity:read", resource: { tenantId: "tenant-a" } }),
    ).not.toThrow();
  });

  it("allows OWNER access to activity:read", () => {
    expect(() =>
      authorize({ context: ctx({ roles: ["OWNER"] }), action: "activity:read", resource: { tenantId: "tenant-a" } }),
    ).not.toThrow();
  });
});
