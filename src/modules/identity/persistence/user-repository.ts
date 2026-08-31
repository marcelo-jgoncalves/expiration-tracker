/**
 * User repository — data-model.md §2 (`TENANT#t#USER#u` / `PROFILE`), org-scoped profile only.
 *
 * `DeviceSession`, `logoutAll`, `logoutDevice`, and `UserProfile.globalLogoutAfter` moved to
 * `global-user-repository.ts` in Wave B2B-5 (D-095, physical model §10) — device sessions and
 * global-logout revocation are properties of the tenant-independent identity now, never of a
 * single Organization's profile row. `requesterDisplayName` (W5-01/GTR-01) was removed in D-129
 * (GTR-01 supersession) — the guest-facing requester identity is now exclusively
 * `Organization.displayName`, never a per-user field. This repository keeps only what is
 * genuinely per-org: `UserProfile` itself, created lazily by `RequestContextResolver` for
 * whichever Organization a `Membership` resolves to, per-org — not at bootstrap time anymore.
 */
import type { EntityKey, IdentityStore } from "../ports/identity-store.js";

export interface UserProfile {
  PK: string;
  SK: "PROFILE";
  entityType: "User";
  userId: string;
  tenantId: string;
  identitySubject: string;
  emailNormalized: string;
  /** Vestigial post-cutover (Wave B2B-5, D-095): `RequestContext.tenant.roles` is now sourced
   * directly from `Membership.role` (organization/domain/membership.ts), never from here.
   * Carried along only for shape stability — never read for authorization. */
  roles: string[];
  status: "ACTIVE" | "SUSPENDED";
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function userProfileKey(tenantId: string, userId: string): EntityKey {
  return { PK: `TENANT#${tenantId}#USER#${userId}`, SK: "PROFILE" };
}

export class UserRepository {
  constructor(
    private readonly store: IdentityStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async getProfile(tenantId: string, userId: string): Promise<UserProfile | undefined> {
    return this.store.get<UserProfile>(userProfileKey(tenantId, userId));
  }

  async createProfileIfAbsent(profile: Omit<UserProfile, "PK" | "SK" | "entityType" | "createdAt" | "updatedAt" | "version">): Promise<UserProfile> {
    const key = userProfileKey(profile.tenantId, profile.userId);
    const existing = await this.getProfile(profile.tenantId, profile.userId);
    if (existing) {
      return existing;
    }
    const now = this.now();
    const item: UserProfile = {
      ...key,
      SK: "PROFILE",
      entityType: "User",
      ...profile,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await this.store.putIfAbsent(item);
    return item;
  }
}
