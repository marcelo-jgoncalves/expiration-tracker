/**
 * W5-01/GTR-01 (`decisions-log.md` D-060). Exercises the REAL handler pipeline
 * (handleGetProfile/handleUpdateProfile -> defaultSchemaRegistry, the actual singleton every
 * Lambda imports) end to end - same regression class documented in
 * notification/preferences-handlers.test.ts: a schema added to disk but never registered in
 * schema-validator.ts's static import list fails with 500 "Unknown schema $id" in production,
 * never caught by test/contract/schemas.test.ts (a different registry).
 */
import { describe, expect, it, vi } from "vitest";
import * as securityAudit from "../../../src/shared/observability/security-audit.js";
import { InMemoryIdentityStore, makeIdGenerator, bootstrapWithOrganization } from "./in-memory-store.js";
import { InMemoryOrganizationStore } from "../organization/in-memory-store.js";
import { RequestContextResolver, type ValidatedClaims } from "../../../src/modules/identity/application/resolve-request-context.js";
import { UserRepository } from "../../../src/modules/identity/persistence/user-repository.js";
import { GlobalUserRepository } from "../../../src/modules/identity/persistence/global-user-repository.js";
import { TenantQuotaService } from "../../../src/modules/identity/application/quota.js";
import { ProfileService } from "../../../src/modules/identity/application/profile-service.js";
import { handleGetProfile, handleUpdateProfile, type ProfileHttpDeps } from "../../../src/modules/identity/http/profile-handlers.js";
import { tenantLifecycleKey } from "../../../src/shared/tenant-lifecycle/tenant-lifecycle-record.js";

// Wave B2B-5 (D-095): bootstrapUser() no longer auto-provisions a tenant - buildDeps() must
// seed a real Organization+Membership for "cognito-sub-1" (via CreateOrganizationService, not a
// hand-rolled fixture) before any handler call can resolve a working RequestContext.
async function buildDeps(): Promise<ProfileHttpDeps & { identityStore: InMemoryIdentityStore }> {
  const identityStore = new InMemoryIdentityStore();
  const organizations = new InMemoryOrganizationStore();
  await bootstrapWithOrganization(identityStore, organizations, "MainTable", "cognito-sub-1");
  const users = new UserRepository(identityStore);
  const resolver = new RequestContextResolver(users, new GlobalUserRepository(identityStore), organizations, makeIdGenerator(), identityStore, "MainTable");
  const quota = new TenantQuotaService(identityStore, "MainTable");
  const profiles = new ProfileService({ users });
  return { resolver, profiles, quota, identityStore };
}

function claims(overrides: Partial<ValidatedClaims> = {}): ValidatedClaims {
  return {
    sub: "cognito-sub-1",
    tokenId: "jti-1",
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    ...overrides,
  };
}

describe("profile-handlers.ts - real defaultSchemaRegistry wiring", () => {
  it("handleGetProfile returns the caller's own profile, requesterDisplayName null by default", async () => {
    const deps = await buildDeps();
    const response = await handleGetProfile(deps, { requestId: "r1", correlationId: "c1", claims: claims() });
    expect(response.statusCode).toBe(200);
    expect((response.body["profile"] as { requesterDisplayName: string | null }).requesterDisplayName).toBeNull();
  });

  it("handleUpdateProfile accepts a valid body through the REAL schema registry every Lambda imports", async () => {
    const deps = await buildDeps();
    const response = await handleUpdateProfile(deps, {
      requestId: "r1",
      correlationId: "c1",
      claims: claims(),
      body: { requesterDisplayName: "Empresa Alfa Ltda." },
    });
    expect(response.statusCode).toBe(200);
    expect((response.body["profile"] as { requesterDisplayName: string | null }).requesterDisplayName).toBe("Empresa Alfa Ltda.");

    const readBack = await handleGetProfile(deps, { requestId: "r2", correlationId: "c1", claims: claims() });
    expect((readBack.body["profile"] as { requesterDisplayName: string | null }).requesterDisplayName).toBe("Empresa Alfa Ltda.");
  });

  it("handleUpdateProfile(null) clears a previously-set value", async () => {
    const deps = await buildDeps();
    await handleUpdateProfile(deps, { requestId: "r1", correlationId: "c1", claims: claims(), body: { requesterDisplayName: "Empresa Alfa Ltda." } });
    const cleared = await handleUpdateProfile(deps, { requestId: "r2", correlationId: "c1", claims: claims(), body: { requesterDisplayName: null } });
    expect(cleared.statusCode).toBe(200);
    expect((cleared.body["profile"] as { requesterDisplayName: string | null }).requesterDisplayName).toBeNull();
  });

  it("handleUpdateProfile rejects a body that fails schema validation (extra unknown field)", async () => {
    const deps = await buildDeps();
    const response = await handleUpdateProfile(deps, {
      requestId: "r1",
      correlationId: "c1",
      claims: claims(),
      body: { requesterDisplayName: "Empresa Alfa Ltda.", unknownField: "nope" } as never,
    });
    expect(response.statusCode).toBe(400);
  });

  it("handleUpdateProfile rejects an empty-string requesterDisplayName (schema minLength 1 - use null to clear)", async () => {
    const deps = await buildDeps();
    const response = await handleUpdateProfile(deps, { requestId: "r1", correlationId: "c1", claims: claims(), body: { requesterDisplayName: "" } });
    expect(response.statusCode).toBe(400);
  });

  it("emits exactly one security.authorization_denied event on a real authorize() denial, without changing the 403 response", async () => {
    const auditSpy = vi.spyOn(securityAudit, "auditAuthorizationDenied");
    const deps = await buildDeps();
    // W3-07 fence (D-068/D-069 follow-up): quota.consume() now requires a
    // TenantLifecycleRecord for "tenant-x" - this stub resolver bypasses the real bootstrap
    // flow that would normally create one, so seed it directly.
    await deps.identityStore.putIfAbsent({
      ...tenantLifecycleKey("tenant-x"),
      entityType: "TenantLifecycleRecord",
      tenantId: "tenant-x",
      status: "ACTIVE",
      createdAt: "2026-08-29T00:00:00.000Z",
      updatedAt: "2026-08-29T00:00:00.000Z",
      version: 1,
    });
    const noRoleResolver = {
      resolve: async () => ({
        tenant: { tenantId: "tenant-x", roles: [] },
        principal: { userId: "user-x" },
        requestId: "r1",
      }),
    } as unknown as ProfileHttpDeps["resolver"];

    const response = await handleGetProfile({ ...deps, resolver: noRoleResolver }, { requestId: "r1", correlationId: "c1", claims: claims() });

    expect(response.statusCode).toBe(403);
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy).toHaveBeenCalledWith({ reason: "NO_MEMBERSHIP", action: "profile:read" });
    auditSpy.mockRestore();
  });
});
