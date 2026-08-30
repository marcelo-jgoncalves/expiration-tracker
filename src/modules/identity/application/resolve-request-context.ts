/**
 * resolveRequestContext — Multi-User B2B Wave B2B-5 (RequestContext Cutover, D-095,
 * docs/architecture/multi-user-b2b-physical-model.md §11). Steps:
 *  1. validation already performed by the API Gateway authorizer (JWT signature/exp) — this
 *     function receives already-validated claims, it does not verify JWT signatures;
 *  2. bootstrap the global identity (`IdentityBootstrapService`, 2-item atomic create) —
 *     authentication no longer creates any tenant/Organization;
 *  3. classify onboarding state (`OnboardingStateResolver`, Wave B2B-4/D-094) — only
 *     `HAS_USABLE_MEMBERSHIP` proceeds to a working `RequestContext`, everything else throws
 *     `OnboardingRequiredError` carrying the exact state;
 *  4. resolve the (today, invariantly unique) `ACTIVE` `Membership` directly — no transport
 *     exists yet for a BFF-session-selected organization (achado 2.1, D-095's Rodada 1); this is
 *     a deliberate, registered PHASED DEVIATION from §11's literal resolution chain, closed by
 *     Wave B2B-6 once B2B-8 makes >1 Membership reachable;
 *  5. verify the Organization's own TenantLifecycleRecord is still ACTIVE (§11's chain ends
 *     "-> TenantLifecycleRecord ACTIVE -> RequestContext" — an ACTIVE Membership alone says
 *     nothing about the Organization's own lifecycle);
 *  6. reject tokens issued before globalLogoutAfter/deviceLogoutAfter (now user-global, §10);
 *  7. build the immutable RequestContext.
 */
import { AuthenticationError, InternalError, OnboardingRequiredError, UnsupportedMembershipRoleError } from "../../../shared/errors/app-error.js";
import { UserRepository } from "../persistence/user-repository.js";
import { GlobalUserRepository } from "../persistence/global-user-repository.js";
import { IdentityBootstrapService } from "./bootstrap-identity.js";
import { OnboardingStateResolver } from "../../organization/application/onboarding-state.js";
import { resolveActiveMembership as resolveActiveMemberships } from "../../organization/application/resolve-active-membership.js";
import type { Membership } from "../../organization/domain/membership.js";
import type { OrganizationStore } from "../../organization/ports/organization-store.js";
import { tenantLifecycleKey, TENANT_ACTIVE_STATUS, type TenantLifecycleRecord } from "../../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import type { IdentityStore } from "../ports/identity-store.js";
import type { RequestContext } from "../domain/request-context.js";

/** Claims already validated (signature + expiry) by the API Gateway JWT authorizer. */
export interface ValidatedClaims {
  sub: string;
  tokenId: string; // jti
  issuedAt: string; // iat, ISO-8601
  expiresAt: string; // exp, ISO-8601
  deviceId?: string;
}

export interface ResolveRequestContextInput {
  claims: ValidatedClaims;
  requestId: string;
  correlationId: string;
}

export interface IdGenerator {
  newUserId(): string;
  newSessionId(): string;
}

export class RequestContextResolver {
  private readonly bootstrap: IdentityBootstrapService;
  private readonly onboarding: OnboardingStateResolver;

  constructor(
    private readonly users: UserRepository,
    private readonly globalUsers: GlobalUserRepository,
    private readonly organizations: OrganizationStore,
    private readonly ids: IdGenerator,
    store: IdentityStore,
    tableName: string,
  ) {
    this.bootstrap = new IdentityBootstrapService(store, tableName);
    this.onboarding = new OnboardingStateResolver(organizations);
  }

  async resolve(input: ResolveRequestContextInput): Promise<RequestContext> {
    const { claims } = input;

    const newUserId = this.ids.newUserId();
    const { user } = await this.bootstrap.bootstrapUser(claims.sub, newUserId);

    if (user.identityStatus !== "ACTIVE") {
      throw new AuthenticationError("User is not active.", { userId: user.userId });
    }

    // Step 5 (user-global watermark, §10 — was UserProfile.globalLogoutAfter pre-cutover).
    if (user.globalLogoutAfter && claims.issuedAt < user.globalLogoutAfter) {
      throw new AuthenticationError("Session revoked (global logout).", { userId: user.userId });
    }

    let deviceSession;
    if (claims.deviceId) {
      deviceSession = await this.globalUsers.getDeviceSession(user.userId, claims.deviceId);
      if (deviceSession) {
        if (deviceSession.status === "REVOKED") {
          throw new AuthenticationError("Session revoked (device logout).", { deviceId: claims.deviceId });
        }
        if (deviceSession.deviceLogoutAfter && claims.issuedAt < deviceSession.deviceLogoutAfter) {
          throw new AuthenticationError("Session revoked (device logout).", { deviceId: claims.deviceId });
        }
      }
    }
    const sessionId = deviceSession?.sessionId ?? this.ids.newSessionId();

    const onboardingState = await this.onboarding.resolve(user.userId);
    if (onboardingState !== "HAS_USABLE_MEMBERSHIP") {
      throw new OnboardingRequiredError(onboardingState, { userId: user.userId });
    }

    const membership = await this.resolveActiveMembership(user.userId);

    // §11's chain ends "...-> TenantLifecycleRecord ACTIVE -> RequestContext" - a Membership
    // being ACTIVE says nothing about whether its Organization itself is still ACTIVE (W3-07's
    // per-organization deletion lifecycle, formalized for real in Wave B2B-9 but the fence must
    // already hold here: never build a working context for an org mid-deletion). Not reachable
    // via any real writer yet (no Organization deletion flow exists until B2B-9) - kept as a
    // real guard regardless, same discipline as the rest of this codebase (never trust an
    // invariant it didn't just check).
    const lifecycle = await this.organizations.get<TenantLifecycleRecord>(tenantLifecycleKey(membership.organizationId));
    if (!lifecycle || lifecycle.status !== TENANT_ACTIVE_STATUS) {
      throw new AuthenticationError("Tenant is not active.", { organizationId: membership.organizationId });
    }

    const roles = this.resolveRoles(membership.role);

    // ProfileService's invariant ("a UserProfile is guaranteed to already exist by the time any
    // RequestContext resolves") must keep holding post-cutover, now per-Organization instead of
    // per-legacy-tenant — provisioned lazily here, the first time this (organizationId, userId)
    // pair resolves, instead of at bootstrap time (no Organization is known yet at bootstrap).
    await this.users.createProfileIfAbsent({
      tenantId: membership.organizationId,
      userId: user.userId,
      identitySubject: claims.sub,
      emailNormalized: user.emailNormalized,
      roles,
      status: "ACTIVE",
    });

    return {
      requestId: input.requestId,
      correlationId: input.correlationId,
      principal: {
        userId: user.userId,
        cognitoSubject: claims.sub,
        sessionId,
        deviceId: claims.deviceId,
      },
      tenant: {
        tenantId: membership.organizationId,
        membershipId: membership.membershipId,
        roles,
      },
      auth: {
        issuedAt: claims.issuedAt,
        expiresAt: claims.expiresAt,
        tokenId: claims.tokenId,
      },
    };
  }

  /**
   * Physical model §11's resolution chain assumes a transported organization selection
   * (`BFF session.activeOrganizationId`) — no such transport exists yet (D-095 achado 2.1: the
   * BFF only forwards the raw Cognito access token to the resource API, `proxy-service.ts`).
   * This derives the (today, invariantly unique — no writer produces a 2nd ACTIVE Membership for
   * the same user until Wave B2B-8 exists) `ACTIVE` `Membership` directly via `queryGsi4()`,
   * hydrated against the base partition (never trusts the GSI4 projection's own `status`, same
   * discipline `OnboardingStateResolver` already applies — physical model §6). Fails closed,
   * loud, if it ever finds more than one — never "pega a primeira". Wave B2B-6 replaces this
   * with real transported selection once B2B-8 makes >1 reachable.
   */
  private async resolveActiveMembership(userId: string): Promise<Membership> {
    const active = await resolveActiveMemberships(this.organizations, userId);

    if (active.length === 0) {
      throw new InternalError("OnboardingStateResolver reported HAS_USABLE_MEMBERSHIP but no ACTIVE Membership was found on re-resolution.", { userId });
    }
    if (active.length > 1) {
      throw new InternalError("User has more than one ACTIVE Membership - not supported until Wave B2B-6 (multi-org selection).", { userId, activeCount: active.length });
    }
    const [membership] = active;
    if (!membership) {
      throw new InternalError("Unreachable: active.length === 1 but active[0] is undefined.", { userId });
    }
    return membership;
  }

  /** B2B-7 (D-097/D-098) closed the gap named in D-095: `authorization.ts` now recognizes all
   * 4 real `Membership.role` values. The assert stays (fail-closed, Codex Rodada 1 achado
   * 2.2/Rodada 2 mudança F, D-095) for any value outside that domain — loud, not silent,
   * instead of letting an unrecognized role fail every `authorize()` check via that matrix's
   * own unsafe cast. */
  private resolveRoles(role: Membership["role"]): string[] {
    if (role !== "OWNER" && role !== "ADMIN" && role !== "MEMBER" && role !== "VIEWER") {
      throw new UnsupportedMembershipRoleError(role);
    }
    return [role];
  }
}
