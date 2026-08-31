/**
 * AssignedActiveItemsLookup — D-122 (Responsibility Reassignment on Member Removal,
 * `docs/architecture/reviews/responsibility-reassignment-scoping/`, Claude 9.1/Codex 9.1, 3
 * rounds). Round-1 named this `SoleResponsibilityChecker`/`findSoleResponsibilityItems`; Round-3
 * ("Estado final consolidado") superseded that name/shape and is authoritative.
 *
 * A narrow port in the CONSUMING module (`organization`), never a direct import of
 * `expiration`'s domain/persistence internals — the real implementation lives in the composition
 * root (`runtime/aws/composition/organization.ts`), querying GSI1 directly there. This is the
 * FIRST time `organization` needs to read data owned by `expiration` — the reverse direction of
 * `expiration/ports/member-eligibility.ts` (that port lets `expiration` read `organization`'s
 * Membership/GlobalUser data; this one lets `organization` read `expiration`'s ExpirationItem
 * data) — same structural pattern, opposite module direction.
 *
 * Pagination contract (Round-3 Correção 2 — a real bug class the Round-2 Codex critique caught):
 * `Query`/`Limit` in DynamoDB bounds items EVALUATED before the `FilterExpression`, not items
 * that SURVIVE it — a naive `Limit: 20` could report "only 3 found" when more exist past the
 * unevaluated 21st raw item. Implementations of this port MUST page to exhaustion (follow
 * `LastEvaluatedKey` until `undefined`, same discipline already in production for GSI1/GSI3/GSI6
 * reads elsewhere in this codebase) and apply the 20-item cap ONLY to the returned `itemIds`
 * list, computed AFTER counting the true total. `totalKnown` is the real count of matches across
 * every page scanned; `truncated` is `true` only when `totalKnown > itemIds.length`. Never use
 * `Limit` as a truncation proxy — that would produce false negatives (a caller could conclude
 * "no reassignment needed" when items actually exist beyond the unevaluated boundary).
 *
 * Cost note (accepted, not a defect to fix here): RCU cost of a full page-to-exhaustion scan
 * scales with the tenant's ACTIVE-status partition size on GSI1 — a known, accepted limitation at
 * this project's current stage (no real production tenants yet, Round-3 "Estado final
 * consolidado").
 */
export interface AssignedActiveItemsResult {
  /** Up to 20 of the matching ExpirationItem ids — never the full set when `truncated`. */
  itemIds: string[];
  /** The TRUE count of ACTIVE items assigned to `userId`, counted across every page scanned —
   * never derived from (and never capped by) `itemIds.length`. */
  totalKnown: number;
  /** `true` only when `totalKnown > itemIds.length` (i.e. more matches exist than the 20-item
   * cap returns). */
  truncated: boolean;
}

export interface AssignedActiveItemsLookup {
  findAssignedActiveItems(organizationId: string, userId: string): Promise<AssignedActiveItemsResult>;
}
