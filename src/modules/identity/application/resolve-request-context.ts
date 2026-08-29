/**
 * resolveRequestContext — implementation-blueprint.md §4.1/§7.2, the central resolver.
 * Steps (verbatim from the blueprint):
 *  1. validation already performed by the API Gateway authorizer (JWT signature/exp) —
 *     this function receives already-validated claims, it does not verify JWT signatures;
 *  2. consistent lookup of cognitoSub -> userId (IdentityMapping, atomic first-login create);
 *  3. session/device resolution;
 *  4. tenant/membership resolution;
 *  5. reject tokens issued before globalLogoutAfter/deviceLogoutAfter;
 *  6. build the immutable RequestContext.
 */
import { AuthenticationError } from "../../../shared/errors/app-error.js";
import { IdentityMappingRepository } from "../persistence/identity-mapping-repository.js";
import { UserRepository } from "../persistence/user-repository.js";
import { TenantBootstrapService } from "./bootstrap-identity.js";
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
  private readonly bootstrap: TenantBootstrapService;

  constructor(
    private readonly identityMappings: IdentityMappingRepository,
    private readonly users: UserRepository,
    private readonly ids: IdGenerator,
    store: IdentityStore,
    tableName: string,
  ) {
    this.bootstrap = new TenantBootstrapService(store, tableName);
  }

  async resolve(input: ResolveRequestContextInput): Promise<RequestContext> {
    const { claims } = input;

    // Steps 2-4 (W3-07/D-067): IdentityMapping + TenantLifecycleRecord(ACTIVE) + User are
    // bootstrapped atomically on first login (bootstrap-identity.ts) - replaces the previous
    // sequential findOrCreate()-then-createProfileIfAbsent() (D-063's confirmed bug: a
    // resolver that silently reprovisions a fresh ACTIVE User for a tenant the deletion
    // cascade already removed). MVP tenantId=userId (data-model.md §7.3), decided inside
    // TenantBootstrapService and nowhere else so a future Organization model changes one
    // call site.
    const newUserId = this.ids.newUserId();
    const { mapping, profile } = await this.bootstrap.bootstrap(claims.sub, newUserId);

    if (!profile) {
      // Lifecycle is not ACTIVE (DELETING/QUIESCING/PURGING/VERIFIED/DELETED/BLOCKED/HELD) -
      // never resurrect the tenant just because its owner authenticated again.
      throw new AuthenticationError("Tenant is not active.", { tenantId: mapping.tenantId });
    }

    if (profile.status !== "ACTIVE") {
      throw new AuthenticationError("User is not active.", { userId: profile.userId });
    }

    // Step 5: reject tokens issued before global logout watermark.
    if (profile.globalLogoutAfter && claims.issuedAt < profile.globalLogoutAfter) {
      throw new AuthenticationError("Session revoked (global logout).", { userId: profile.userId });
    }

    let deviceSession;
    if (claims.deviceId) {
      deviceSession = await this.users.getDeviceSession(mapping.tenantId, mapping.userId, claims.deviceId);
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

    return {
      requestId: input.requestId,
      correlationId: input.correlationId,
      principal: {
        userId: profile.userId,
        cognitoSubject: claims.sub,
        sessionId,
        deviceId: claims.deviceId,
      },
      tenant: {
        tenantId: profile.tenantId,
        roles: profile.roles,
      },
      auth: {
        issuedAt: claims.issuedAt,
        expiresAt: claims.expiresAt,
        tokenId: claims.tokenId,
      },
    };
  }
}
