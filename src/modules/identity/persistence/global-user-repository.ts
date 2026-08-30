/**
 * GlobalUser repository — Multi-User B2B Wave B2B-2 (docs/architecture/multi-user-b2b-physical-model.md
 * §1): the future tenant-independent identity, `PK=USER#<userId>`, `SK=PROFILE`. Additive foundation
 * only in this wave — `TenantBootstrapService` still creates the legacy tenant-scoped `UserProfile`/
 * `TenantLifecycleRecord` alongside this row until Wave B2B-4/B2B-5 land Organization-based onboarding
 * and cut `RequestContext` over (docs/architecture/multi-user-b2b-wave-tracker.md B2B-2 sequencing
 * note, D-087). Nothing reads this row yet — it exists so Wave B2B-3's `Membership` has a real
 * `userId` to reference.
 *
 * `entityType: "GlobalUser"` (not `"User"`, already used by the legacy `UserProfile`) so the two can
 * coexist without ambiguity during the transition — verified no code scans/filters by `entityType`
 * today, so this is a free choice, not a migration of an existing convention.
 */
import type { EntityKey, IdentityStore } from "../ports/identity-store.js";

export interface GlobalUser {
  PK: string;
  SK: "PROFILE";
  entityType: "GlobalUser";
  userId: string;
  emailNormalized: string;
  identityStatus: "ACTIVE" | "SUSPENDED";
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function globalUserKey(userId: string): EntityKey {
  return { PK: `USER#${userId}`, SK: "PROFILE" };
}

export class GlobalUserRepository {
  constructor(private readonly store: IdentityStore) {}

  async get(userId: string): Promise<GlobalUser | undefined> {
    return this.store.get<GlobalUser>(globalUserKey(userId));
  }
}
