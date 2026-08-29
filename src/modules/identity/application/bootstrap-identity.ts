/**
 * TenantBootstrapService — W3-07 atomic first-login bootstrap (D-067,
 * `docs/architecture/reviews/w3-07-tenant-fence-round3-active-only-design/
 * claude-analysis-active-only-fence.md` §F.6/§Q roadmap): replaces
 * RequestContextResolver's previous sequential `IdentityMapping.findOrCreate()` then
 * `User.createProfileIfAbsent()` (D-063's confirmed bug — a resolver that re-provisions a
 * fresh ACTIVE User on next login, silently resurrecting a tenant the deletion cascade
 * already removed) with a single `TransactWriteItems` that creates `IdentityMapping` +
 * `TenantLifecycleRecord(ACTIVE)` + `User` together, and refuses to (re)create `User` when
 * the tenant's lifecycle is anything other than ACTIVE.
 *
 * Race/retry semantics: two concurrent first logins for the same `cognitoSub` both attempt
 * the 3-item create; DynamoDB accepts exactly one (the mapping's own
 * `attribute_not_exists(PK)` condition), the loser's TransactWriteItems cancels as a whole,
 * and this service re-reads and resolves against the winner's state instead of erroring -
 * same idempotent-under-races contract IdentityMappingRepository.findOrCreate already
 * documented, now extended to cover all three items atomically instead of just the mapping.
 */
import { InternalError } from "../../../shared/errors/app-error.js";
import { buildVersionedCreate, isTransactionCanceled, type TransactWriteEntry } from "../../../shared/dynamodb/occ.js";
import { tenantLifecycleKey, TENANT_ACTIVE_STATUS, type TenantLifecycleRecord } from "../../../shared/tenant-lifecycle/tenant-lifecycle-record.js";
import type { IdentityStore } from "../ports/identity-store.js";
import { identityMappingKey, type IdentityMapping } from "../persistence/identity-mapping-repository.js";
import { userProfileKey, type UserProfile } from "../persistence/user-repository.js";

export interface BootstrapResult {
  mapping: IdentityMapping;
  lifecycle: TenantLifecycleRecord;
  /** Absent exactly when the tenant's lifecycle is not ACTIVE - the caller (resolver) must
   * treat this as "do not admit this login", never fabricate a profile to fall back to. */
  profile: UserProfile | undefined;
}

export class TenantBootstrapService {
  constructor(
    private readonly store: IdentityStore,
    private readonly tableName: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async bootstrap(cognitoSub: string, newUserId: string): Promise<BootstrapResult> {
    const existingMapping = await this.store.get<IdentityMapping>(identityMappingKey(cognitoSub));
    if (existingMapping) {
      return this.resolveExisting(existingMapping);
    }
    return this.createAll(cognitoSub, newUserId);
  }

  /** Existing mapping: read the lifecycle tombstone and decide whether User may be created/kept. */
  private async resolveExisting(mapping: IdentityMapping): Promise<BootstrapResult> {
    const lifecycle = await this.store.get<TenantLifecycleRecord>(tenantLifecycleKey(mapping.tenantId));

    if (!lifecycle) {
      // Pre-migration tenant: this mapping was created before TenantLifecycleRecord existed
      // in code (grep -ril "TenantLifecycle" src/ was empty before this session, per the
      // approved design doc §O-5's migration note). Backfill the tombstone as ACTIVE now -
      // true by construction, not an inferred guess, since "non-ACTIVE" wasn't even a
      // representable concept when this mapping was created. Best-effort/non-atomic
      // (putIfAbsent, safe under a repeat-login race - the loser just re-reads).
      const backfilled: TenantLifecycleRecord = {
        ...tenantLifecycleKey(mapping.tenantId),
        SK: "LIFECYCLE",
        entityType: "TenantLifecycleRecord",
        tenantId: mapping.tenantId,
        status: TENANT_ACTIVE_STATUS,
        createdAt: this.now(),
        updatedAt: this.now(),
        version: 1,
      };
      await this.store.putIfAbsent(backfilled);
      const winnerLifecycle = (await this.store.get<TenantLifecycleRecord>(tenantLifecycleKey(mapping.tenantId))) ?? backfilled;
      if (winnerLifecycle.status !== TENANT_ACTIVE_STATUS) {
        return { mapping, lifecycle: winnerLifecycle, profile: undefined };
      }
      const profile = await this.ensureProfile(mapping);
      return { mapping, lifecycle: winnerLifecycle, profile };
    }

    if (lifecycle.status !== TENANT_ACTIVE_STATUS) {
      // The central W3-07 invariant: never reprovision/return a User for a tenant that is
      // DELETING/DELETED/etc. just because its owner authenticates again.
      return { mapping, lifecycle, profile: undefined };
    }

    const profile = await this.ensureProfile(mapping);
    return { mapping, lifecycle, profile };
  }

  /** Idempotent: returns the existing profile if one is already there (repeat login), only
   * creates when absent AND the caller has already confirmed lifecycle is ACTIVE. */
  private async ensureProfile(mapping: IdentityMapping): Promise<UserProfile> {
    const key = userProfileKey(mapping.tenantId, mapping.userId);
    const existing = await this.store.get<UserProfile>(key);
    if (existing) return existing;

    const now = this.now();
    const profile: UserProfile = {
      ...key,
      SK: "PROFILE",
      entityType: "User",
      userId: mapping.userId,
      tenantId: mapping.tenantId,
      identitySubject: mapping.cognitoSub,
      emailNormalized: "",
      roles: ["OWNER"],
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    // putIfAbsent, not a raw put: two concurrent resolves of the SAME already-mapped,
    // already-ACTIVE tenant (e.g. two devices logging in for the first time after a
    // pre-migration backfill) could both reach here - only one creation may win.
    const created = await this.store.putIfAbsent(profile);
    if (created) return profile;
    const winner = await this.store.get<UserProfile>(key);
    if (!winner) throw new InternalError("User profile vanished after losing creation race.", { userId: mapping.userId });
    return winner;
  }

  /** No mapping exists yet: create IdentityMapping + TenantLifecycleRecord(ACTIVE) + User
   * atomically. MVP: tenantId=userId (same judgment call as
   * IdentityMappingRepository.findOrCreate - decided here and in that one other place only). */
  private async createAll(cognitoSub: string, newUserId: string): Promise<BootstrapResult> {
    const now = this.now();
    const mapping: IdentityMapping = {
      ...identityMappingKey(cognitoSub),
      SK: "MAP",
      entityType: "IdentityMapping",
      cognitoSub,
      userId: newUserId,
      tenantId: newUserId,
      createdAt: now,
    };
    const lifecycle: TenantLifecycleRecord = {
      ...tenantLifecycleKey(newUserId),
      SK: "LIFECYCLE",
      entityType: "TenantLifecycleRecord",
      tenantId: newUserId,
      status: TENANT_ACTIVE_STATUS,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const profile: UserProfile = {
      ...userProfileKey(newUserId, newUserId),
      SK: "PROFILE",
      entityType: "User",
      userId: newUserId,
      tenantId: newUserId,
      identitySubject: cognitoSub,
      emailNormalized: "",
      roles: ["OWNER"],
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    const entries: TransactWriteEntry[] = [
      { Put: buildVersionedCreate(this.tableName, mapping as unknown as Record<string, unknown> & { PK: string; SK: string }) },
      { Put: buildVersionedCreate(this.tableName, lifecycle as unknown as Record<string, unknown> & { PK: string; SK: string }) },
      { Put: buildVersionedCreate(this.tableName, profile as unknown as Record<string, unknown> & { PK: string; SK: string }) },
    ];

    try {
      await this.store.transactWrite(entries);
      return { mapping, lifecycle, profile };
    } catch (err) {
      if (!isTransactionCanceled(err)) throw err;
      // Lost the race: another concurrent first-login for the same cognitoSub committed its
      // own 3-item create between our get() and transactWrite(). Re-read and resolve against
      // the winner instead of erroring - first login must be safe to retry.
      const winner = await this.store.get<IdentityMapping>(identityMappingKey(cognitoSub));
      if (!winner) {
        throw new InternalError("IdentityMapping vanished after losing bootstrap race.", { cognitoSub });
      }
      return this.resolveExisting(winner);
    }
  }
}
