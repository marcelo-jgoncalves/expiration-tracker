/**
 * IdentityMapping repository — data-model.md §2/§"IdentityMapping" +
 * implementation-blueprint.md §23.1/§7.3: PK=IDENTITY#cognitoSub#<sub>, SK=MAP, created
 * atomically (ConditionExpression attribute_not_exists(PK)) on first login. This is one
 * of the two documented exceptions to the "every key starts with TENANT#tenantId" rule
 * (the other is GSI3) — the lookup happens *before* tenantId is known.
 */
import type { EntityKey, IdentityStore } from "../ports/identity-store.js";
import { InternalError } from "../../../shared/errors/app-error.js";

export interface IdentityMapping {
  PK: string;
  SK: "MAP";
  entityType: "IdentityMapping";
  cognitoSub: string;
  userId: string;
  tenantId: string;
  createdAt: string;
}

export function identityMappingKey(cognitoSub: string): EntityKey {
  return { PK: `IDENTITY#cognitoSub#${cognitoSub}`, SK: "MAP" };
}

export class IdentityMappingRepository {
  constructor(
    private readonly store: IdentityStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async find(cognitoSub: string): Promise<IdentityMapping | undefined> {
    return this.store.get<IdentityMapping>(identityMappingKey(cognitoSub));
  }

  /**
   * Atomically creates the mapping on first login. MVP: tenantId=userId (data-model.md
   * §7.3 "No MVP, tenantId=userId, mas o código recebe ambos como conceitos separados"),
   * so newUserId is used for both — callers must never derive one from the other outside
   * this function once Organizations (FUT-001) exist.
   *
   * Idempotent under races: if two concurrent first-logins for the same sub both call
   * this, exactly one PutItem wins (attribute_not_exists(PK)); the loser re-reads and
   * returns the winner's mapping instead of erroring, so first-login is safe to retry.
   */
  async findOrCreate(cognitoSub: string, newUserId: string, newTenantId: string): Promise<IdentityMapping> {
    const existing = await this.find(cognitoSub);
    if (existing) {
      return existing;
    }

    const key = identityMappingKey(cognitoSub);
    const candidate: IdentityMapping = {
      ...key,
      SK: "MAP",
      entityType: "IdentityMapping",
      cognitoSub,
      userId: newUserId,
      tenantId: newTenantId,
      createdAt: this.now(),
    };

    const created = await this.store.putIfAbsent(candidate);
    if (created) {
      return candidate;
    }

    // Lost the race: someone else created it first-login-atomically between our
    // find() and putIfAbsent(). Re-read; if it's still missing something is badly
    // wrong (a delete of an IdentityMapping is not a supported operation).
    const winner = await this.find(cognitoSub);
    if (!winner) {
      throw new InternalError("IdentityMapping vanished after losing creation race.", { cognitoSub });
    }
    return winner;
  }
}
