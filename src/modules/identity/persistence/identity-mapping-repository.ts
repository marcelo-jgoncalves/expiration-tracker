/**
 * IdentityMapping — data-model.md §2/"IdentityMapping" + implementation-blueprint.md §23.1/§7.3:
 * PK=IDENTITY#cognitoSub#<sub>, SK=MAP, created atomically (ConditionExpression
 * attribute_not_exists(PK)) on first login. One of the two documented exceptions to the
 * "every key starts with TENANT#tenantId" rule (the other is GSI3) — the lookup happens
 * *before* any organization is known.
 *
 * `tenantId` removed (Wave B2B-5, D-095, physical model §2 "IdentityMapping (global,
 * tenantless)") — the mapping resolves cognitoSub -> userId only; which Organization(s) a user
 * belongs to is `Membership`'s job (organization/domain/membership.ts), never this mapping's.
 * `IdentityMappingRepository`'s `find`/`findOrCreate` methods (pre-B2B-2) are removed with it —
 * dead since D-087 unified both login paths through `IdentityBootstrapService.bootstrapUser()`
 * (bootstrap-identity.ts), which reads/writes this key directly; nothing has called
 * `findOrCreate` since. Only the key builder + type survive, still needed everywhere a caller
 * does `store.get(identityMappingKey(...))`.
 */
import type { EntityKey } from "../ports/identity-store.js";

export interface IdentityMapping {
  PK: string;
  SK: "MAP";
  entityType: "IdentityMapping";
  cognitoSub: string;
  userId: string;
  createdAt: string;
}

export function identityMappingKey(cognitoSub: string): EntityKey {
  return { PK: `IDENTITY#cognitoSub#${cognitoSub}`, SK: "MAP" };
}
