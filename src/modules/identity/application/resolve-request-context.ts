/**
 * resolveRequestContext — Multi-User B2B, docs/architecture/multi-user-b2b-physical-model.md
 * §11. Steps:
 *  1. validation already performed by the API Gateway authorizer (JWT signature/exp) — this
 *     function receives already-validated claims, it does not verify JWT signatures;
 *  2. bootstrap the global identity (`IdentityBootstrapService`, 2-item atomic create) —
 *     authentication no longer creates any tenant/Organization;
 *  3. classify onboarding state (`OnboardingStateResolver`, Wave B2B-4/D-094) — only
 *     `HAS_USABLE_MEMBERSHIP` proceeds to a working `RequestContext`, everything else throws
 *     `OnboardingRequiredError` carrying the exact state;
 *  4. resolve the working `Membership` — `organizationIdHint` (from `X-Organization-Id`,
 *     Wave B2B-6/D-101) when present, else the (today) single `ACTIVE` Membership; both paths
 *     revalidate via `resolveWorkingOrganization()` (Membership ACTIVE + the Organization's own
 *     `TenantLifecycleRecord` ACTIVE — §11's chain ends "-> TenantLifecycleRecord ACTIVE ->
 *     RequestContext", an ACTIVE Membership alone says nothing about the Organization's own
 *     lifecycle);
 *  5. reject tokens issued before globalLogoutAfter/deviceLogoutAfter (now user-global, §10);
 *  6. build the immutable RequestContext.
 */
import { AuthenticationError, InternalError, OnboardingRequiredError, OrganizationSelectionRequiredError, OrganizationUnavailableError, UnsupportedMembershipRoleError } from "../../../shared/errors/app-error.js";
import { UserRepository } from "../persistence/user-repository.js";
import { GlobalUserRepository } from "../persistence/global-user-repository.js";
import { IdentityBootstrapService } from "./bootstrap-identity.js";
import { OnboardingStateResolver } from "../../organization/application/onboarding-state.js";
import { resolveActiveMembership as resolveActiveMemberships } from "../../organization/application/resolve-active-membership.js";
import { resolveWorkingOrganization } from "../../organization/application/resolve-working-organization.js";
import type { Membership } from "../../organization/domain/membership.js";
import type { OrganizationStore } from "../../organization/ports/organization-store.js";
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
  /** From `X-Organization-Id` (BFF-derived, Wave B2B-6/D-101) — REQUIRED (not `?:`), even
   * though `undefined` is a valid value, so the compiler blocks every real call site (56 across
   * 13 HTTP handler files, `grep -rl` verified) from silently forgetting to thread it through. */
  organizationIdHint: string | undefined;
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

    const membership = await this.resolveActiveMembership(user.userId, input.organizationIdHint);

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
   * Physical model §11's resolution chain: `... -> BFF session.activeOrganizationId (seleção)
   * -> GetItem direto Membership(userId, organizationId) -> TenantLifecycleRecord ACTIVE ->
   * RequestContext`. Wave B2B-6 (D-101) closes the transport gap D-095 left open (achado 2.1) -
   * `organizationIdHint` (from `X-Organization-Id`, BFF-derived, never client-controlled) is
   * revalidated via `resolveWorkingOrganization()` (consolidates Membership ACTIVE + lifecycle
   * ACTIVE - replaces the separate `AuthenticationError` this function used to throw for the
   * lifecycle half of that check). Hint absent falls back to deriving via GSI4: exactly one
   * ACTIVE Membership (today's common case, unchanged behavior) or a named, non-crashing error
   * for 0/>1 - no writer produced a 2nd ACTIVE Membership for the same user before Wave B2B-8
   * made it reachable, per D-095/D-096's own registered deviation.
   */
  private async resolveActiveMembership(userId: string, organizationIdHint: string | undefined): Promise<Membership> {
    if (organizationIdHint) {
      const result = await resolveWorkingOrganization(this.organizations, userId, organizationIdHint);
      if (result.status === "UNAVAILABLE") {
        throw new OrganizationUnavailableError("This organization is not available in your current context.", { organizationId: organizationIdHint });
      }
      return result.membership;
    }

    const active = await resolveActiveMemberships(this.organizations, userId);
    if (active.length === 0) {
      throw new InternalError("OnboardingStateResolver reported HAS_USABLE_MEMBERSHIP but no ACTIVE Membership was found on re-resolution.", { userId });
    }
    if (active.length > 1) {
      throw new OrganizationSelectionRequiredError("Multiple organizations are available; select one via X-Organization-Id.", { userId, activeCount: active.length });
    }
    const [membership] = active;
    if (!membership) {
      throw new InternalError("Unreachable: active.length === 1 but active[0] is undefined.", { userId });
    }
    // Sem hint, a única Membership ACTIVE ainda precisa da mesma checagem de lifecycle - nunca
    // um atalho que confie na hidratação de resolveActiveMemberships() sozinha (essa função só
    // checa Membership.status, não TenantLifecycleRecord).
    const result = await resolveWorkingOrganization(this.organizations, userId, membership.organizationId);
    if (result.status === "UNAVAILABLE") {
      throw new OrganizationUnavailableError("This organization is not available in your current context.", { organizationId: membership.organizationId });
    }
    return result.membership;
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
