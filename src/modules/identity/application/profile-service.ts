/**
 * ProfileService — W5-01/GTR-01 (`decisions-log.md` D-060): lets a user read/set their own
 * `UserProfile.requesterDisplayName`, the name shown to a guest as "who is requesting this
 * document" (`GuestRequestInfo.requesterDisplayName`, interpolated into the guest-facing email
 * templates). Mirrors `NotificationPreferencesService`'s shape (authorize() + the calling
 * user's own record, never an arbitrary id) — the one real difference is that a `UserProfile`
 * is guaranteed to already exist by the time any `RequestContext` resolves (`resolveContext()`
 * provisions it on first login), so this service never needs the get-or-create bridge that
 * `NotificationPreferencesService` needs.
 */
import type { RequestContext } from "../domain/request-context.js";
import { authorize } from "../domain/authorization.js";
import { NotFoundError } from "../../../shared/errors/app-error.js";
import type { UserProfile } from "../persistence/user-repository.js";
import { UserRepository } from "../persistence/user-repository.js";

export interface ProfileServiceDeps {
  users: UserRepository;
}

export class ProfileService {
  private readonly users: UserRepository;

  constructor(deps: ProfileServiceDeps) {
    this.users = deps.users;
  }

  async getProfile(ctx: RequestContext): Promise<UserProfile> {
    authorize({ context: ctx, action: "profile:read", resource: { tenantId: ctx.tenant.tenantId } });
    return this.readOwnProfile(ctx);
  }

  /** `requesterDisplayName: undefined` clears the field back to unset (falls back to the
   * generic guest-facing text again, `sanitizeTenantText`'s own fallback). */
  async setRequesterDisplayName(ctx: RequestContext, requesterDisplayName: string | undefined): Promise<UserProfile> {
    authorize({ context: ctx, action: "profile:update", resource: { tenantId: ctx.tenant.tenantId } });
    const profile = await this.readOwnProfile(ctx);
    return this.users.setRequesterDisplayName(profile, requesterDisplayName);
  }

  private async readOwnProfile(ctx: RequestContext): Promise<UserProfile> {
    const profile = await this.users.getProfile(ctx.tenant.tenantId, ctx.principal.userId);
    // Cannot actually happen for an authenticated RequestContext (resolveContext() always
    // provisions the profile on first login) — kept as a real guard, never assumed, matching
    // the rest of this codebase's discipline of not trusting an invariant it didn't just check.
    if (!profile) throw new NotFoundError("UserProfile", { userId: ctx.principal.userId });
    return profile;
  }
}
