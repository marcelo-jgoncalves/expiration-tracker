/** W5-01/GTR-01 (`decisions-log.md` D-060): ProfileService lets a user read/set their own
 * UserProfile.requesterDisplayName. */
import { describe, expect, it, beforeEach } from "vitest";
import { InMemoryIdentityStore } from "./in-memory-store.js";
import { UserRepository } from "../../../src/modules/identity/persistence/user-repository.js";
import { ProfileService } from "../../../src/modules/identity/application/profile-service.js";
import { AuthorizationDeniedError } from "../../../src/modules/identity/domain/authorization.js";
import { NotFoundError } from "../../../src/shared/errors/app-error.js";
import type { RequestContext } from "../../../src/modules/identity/domain/request-context.js";

const TENANT = "t1";
const USER = "u1";

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: "r1",
    correlationId: "c1",
    principal: { userId: USER, cognitoSubject: "sub-u1", sessionId: "s1" },
    tenant: { tenantId: TENANT, roles: ["OWNER"] },
    auth: { issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), tokenId: "jti-1" },
    ...overrides,
  };
}

describe("ProfileService", () => {
  let store: InMemoryIdentityStore;
  let users: UserRepository;
  let service: ProfileService;

  beforeEach(async () => {
    store = new InMemoryIdentityStore();
    users = new UserRepository(store, () => "2026-08-28T00:00:00.000Z");
    service = new ProfileService({ users });
    await users.createProfileIfAbsent({
      userId: USER,
      tenantId: TENANT,
      identitySubject: "sub-u1",
      emailNormalized: "owner@acme.example",
      roles: ["OWNER"],
      status: "ACTIVE",
    });
  });

  it("getProfile returns the caller's own profile, requesterDisplayName unset by default", async () => {
    const profile = await service.getProfile(ctx());
    expect(profile.userId).toBe(USER);
    expect(profile.requesterDisplayName).toBeUndefined();
  });

  it("getProfile enforces the authorization matrix (no membership => denied)", async () => {
    await expect(service.getProfile(ctx({ tenant: { tenantId: TENANT, roles: [] } }))).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it("setRequesterDisplayName sets the field, readable via a subsequent getProfile", async () => {
    const updated = await service.setRequesterDisplayName(ctx(), "Empresa Alfa Ltda.");
    expect(updated.requesterDisplayName).toBe("Empresa Alfa Ltda.");
    expect((await service.getProfile(ctx())).requesterDisplayName).toBe("Empresa Alfa Ltda.");
  });

  it("setRequesterDisplayName(undefined) clears a previously-set value", async () => {
    await service.setRequesterDisplayName(ctx(), "Empresa Alfa Ltda.");
    const cleared = await service.setRequesterDisplayName(ctx(), undefined);
    expect(cleared.requesterDisplayName).toBeUndefined();
  });

  it("setRequesterDisplayName requires WRITE_ROLES (VIEWER denied)", async () => {
    await expect(
      service.setRequesterDisplayName(ctx({ tenant: { tenantId: TENANT, roles: ["VIEWER"] } }), "Empresa Alfa Ltda."),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it("readOwnProfile guard: throws NotFoundError if the profile somehow doesn't exist for an authorized context", async () => {
    const ghostCtx = ctx({ principal: { userId: "ghost-user", cognitoSubject: "sub-ghost", sessionId: "s1" } });
    await expect(service.getProfile(ghostCtx)).rejects.toBeInstanceOf(NotFoundError);
  });
});
