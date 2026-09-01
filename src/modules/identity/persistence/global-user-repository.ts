/**
 * GlobalUser repository — Multi-User B2B (docs/architecture/multi-user-b2b-physical-model.md
 * §1/§10), `PK=USER#<userId>`, `SK=PROFILE`: the tenant-independent identity. Wave B2B-2/D-087
 * introduced this row additively (nothing read it yet); Wave B2B-5/D-095 makes it the ONLY
 * identity-level record `IdentityBootstrapService.bootstrapUser()` creates — the legacy
 * tenant-scoped `UserProfile` was no longer auto-created at login from that wave on, and later
 * removed entirely (D-160 — zero real reader, fields duplicated from this entity/`IdentityMapping`).
 * `entityType: "GlobalUser"` (not `"User"`, historically used by the removed `UserProfile`) still
 * lets the two coexist without ambiguity for any pre-cutover row still around in `dev`.
 *
 * `DeviceSession` and the two logout operations move here from `user-repository.ts` in the same
 * wave (physical model §10: "DeviceSession migra para o User global, logoutAll fica
 * user-global") — both are properties of the global identity now, not of a tenant-scoped
 * profile. `logoutAll` sets `GlobalUser.globalLogoutAfter` (was `UserProfile.globalLogoutAfter`)
 * — a **mudança de contrato observável, não só relocação de schema** (physical model §10):
 * revoking a token now revokes it everywhere the user is a member, always, never scoped to
 * whichever Organization happened to be active when the call was made. Evaluated and accepted
 * as the correct security/product choice in the approved design — credential-compromise
 * containment is `Membership` revocation's job, not session logout's.
 */
import type { EntityKey, IdentityStore } from "../ports/identity-store.js";

export interface GlobalUser {
  PK: string;
  SK: "PROFILE";
  entityType: "GlobalUser";
  userId: string;
  emailNormalized: string;
  identityStatus: "ACTIVE" | "SUSPENDED";
  /** Set by `logoutAll` — RequestContextResolver rejects any token with `issuedAt` before this
   * watermark. User-global (physical model §10), not per-Organization. */
  globalLogoutAfter?: string;
  /** Wave B2B-5 (D-095, Codex Rodada 3 achado 1): set exactly once, transactionally, the first
   * time this user creates an Organization via `POST /bff/organizations` — a temporary cap on
   * self-service org creation (not a general "has a usable Membership" signal, and never
   * reusable as one by B2B-6/B2B-8) that keeps the "at most 1 ACTIVE Membership" invariant
   * `RequestContextResolver`/`resolveActiveMembership` rely on true by construction, not by
   * best-effort check-then-act. Written via `buildAttributeOnceUpdate` in the SAME
   * `TransactWriteItems` as the Organization/Membership/TenantLifecycleRecord/TenantEntitlement
   * creation (`CreateOrganizationService.buildCreateEntries()` + this one extra entry) — never
   * check-then-act. */
  hasCreatedOrganization?: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function globalUserKey(userId: string): EntityKey {
  return { PK: `USER#${userId}`, SK: "PROFILE" };
}

export interface DeviceSession {
  PK: string;
  SK: string; // SESSION#<deviceId>
  entityType: "DeviceSession";
  userId: string;
  deviceId: string;
  sessionId: string;
  refreshFamilyId: string;
  deviceLogoutAfter?: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  status: "ACTIVE" | "REVOKED";
}

/** `PK=USER#<userId>` — never `TENANT#`-prefixed, so W3-07's purge scan (which filters by
 * `begins_with(PK, "TENANT#<tenantId>")`) cannot reach it by construction, same invariant the
 * physical model documents for `User`/`GlobalUser` itself (§121 Q11). */
export function deviceSessionKey(userId: string, deviceId: string): EntityKey {
  return { PK: `USER#${userId}`, SK: `SESSION#${deviceId}` };
}

export class GlobalUserRepository {
  constructor(
    private readonly store: IdentityStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async get(userId: string): Promise<GlobalUser | undefined> {
    return this.store.get<GlobalUser>(globalUserKey(userId));
  }

  async getDeviceSession(userId: string, deviceId: string): Promise<DeviceSession | undefined> {
    return this.store.get<DeviceSession>(deviceSessionKey(userId, deviceId));
  }

  async upsertDeviceSession(session: DeviceSession): Promise<void> {
    await this.store.update(session);
  }

  /** Logout by device — revokes only this device's refresh family. */
  async logoutDevice(userId: string, deviceId: string): Promise<void> {
    const session = await this.getDeviceSession(userId, deviceId);
    if (!session) return;
    await this.store.update({ ...session, status: "REVOKED", deviceLogoutAfter: this.now() });
  }

  /** Logout global — implementation-blueprint.md §4.2: revokes every token issued before now,
   * across every Organization this user belongs to (physical model §10 — user-global by
   * construction, not scoped to whichever Organization was active). */
  async logoutAll(userId: string): Promise<void> {
    const user = await this.get(userId);
    if (!user) return;
    await this.store.update({ ...user, globalLogoutAfter: this.now(), updatedAt: this.now() });
  }
}
