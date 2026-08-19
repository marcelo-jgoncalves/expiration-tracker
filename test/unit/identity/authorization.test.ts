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
});
