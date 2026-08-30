/**
 * User repository — data-model.md §2 (`TENANT#t#USER#u` / `PROFILE`), org-scoped profile only.
 *
 * `DeviceSession`, `logoutAll`, `logoutDevice`, and `UserProfile.globalLogoutAfter` moved to
 * `global-user-repository.ts` in Wave B2B-5 (D-095, physical model §10) — device sessions and
 * global-logout revocation are properties of the tenant-independent identity now, never of a
 * single Organization's profile row. This repository keeps only what is genuinely per-org:
 * `UserProfile` itself (created lazily by `RequestContextResolver` for whichever Organization a
 * `Membership` resolves to, per-org — not at bootstrap time anymore) and the guest-facing
 * `requesterDisplayName` it carries (W5-01/GTR-01), whose eventual home is
 * `Organization.displayName` (physical model §121 Q21) but whose real migration is explicitly
 * Wave B2B-11's job, not B2B-5's.
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
   * Carried along only because `ProfileService`/`profile-handlers.ts` destructure the whole
   * `UserProfile` shape — never read for authorization. */
  roles: string[];
  status: "ACTIVE" | "SUSPENDED";
  /** W5-01/GTR-01 (`decisions-log.md` D-060): name shown to a guest as "who is requesting this
   * document" (`GuestRequestInfo.requesterDisplayName`) and interpolated into the guest-facing
   * email templates. Optional and user-editable (`PUT /profile`) — never inferred from the
   * user's e-mail domain (this codebase's epistemic-integrity discipline: never guess data that
   * was never actually captured). Absent until the user sets it once. */
  requesterDisplayName?: string;
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

  /** W5-01/GTR-01: sets or clears (`undefined`) the name shown to guests as the requester's
   * identity. Same unconditional-overwrite pattern as `GlobalUserRepository.logoutAll`/
   * `logoutDevice` — this port has no per-item OCC beyond `updateConditional`'s counter-only use
   * (quota.ts), and a
   * lost update on this single self-editable text field carries the same negligible,
   * already-accepted risk as those two fields. Caller (`ProfileService`) is responsible for
   * confirming the profile exists first. */
  async setRequesterDisplayName(profile: UserProfile, requesterDisplayName: string | undefined): Promise<UserProfile> {
    const updated: UserProfile = { ...profile, requesterDisplayName, updatedAt: this.now() };
    await this.store.update(updated);
    return updated;
  }
}
