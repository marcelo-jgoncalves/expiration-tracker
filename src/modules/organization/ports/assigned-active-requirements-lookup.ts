/** AssignedActiveRequirementsLookup — D-194 Fatia 2
 * (`docs/architecture/reviews/search-and-filters-scoping/estado-final-consolidado.md`
 * §"Responsável"). Sibling port to `assigned-active-items-lookup.ts` (D-122/D-125), never an
 * extension of it - the two entities (`ExpirationItem`/`Requirement`) live in different modules
 * (`expiration`/`document-archive`) with different GSI1 status namespaces
 * (`ITEMSTATUS#ACTIVE`/`REQSTATUS#<status>`), so a single port covering both would force
 * `organization/application` to know about two different physical shapes through one interface.
 *
 * A narrow port in the CONSUMING module (`organization`), never a direct import of
 * `document-archive`'s domain/persistence internals - the real implementation lives in the
 * composition root (`runtime/aws/composition/organization.ts`), querying GSI1 directly there
 * (permitted ONLY at the composition root, `document-archive` remains unreachable from
 * `organization/application` per `.dependency-cruiser.cjs`).
 *
 * Unlike `AssignedActiveItemsLookup` (a single `ITEMSTATUS#ACTIVE` partition), "active" for a
 * Requirement means 4 separate GSI1 status partitions - `MISSING`/`PENDING`/`SATISFIED`/
 * `NOT_SATISFIED` - excluding `NOT_APPLICABLE` (a Requirement flipped to NOT_APPLICABLE is no
 * longer anyone's actionable obligation, same reasoning `deriveRequirementStatus`'s own doc
 * comment gives for treating it as a terminal, non-actionable state). Implementations MUST query
 * all 4 in parallel and page each to exhaustion (same `LastEvaluatedKey`-until-`undefined`
 * discipline as `AssignedActiveItemsLookup`, never a `Limit` truncation proxy - see that port's
 * doc comment for the full false-negative rationale, identical here).
 *
 * `requirementIds` is capped at 20 (same cap as `AssignedActiveItemsLookup.itemIds`), applied
 * ONLY to the returned list, computed AFTER `totalKnownRequirements` counts every match across
 * every status partition and every page. `truncatedRequirements` is `true` only when
 * `totalKnownRequirements > requirementIds.length`.
 */
export interface AssignedActiveRequirementsResult {
  /** Up to 20 of the matching Requirement ids, across all 4 non-terminal/non-NOT_APPLICABLE
   * statuses combined — never the full set when `truncatedRequirements`. */
  requirementIds: string[];
  /** The TRUE count of MISSING/PENDING/SATISFIED/NOT_SATISFIED Requirements assigned to
   * `userId`, counted across every status partition and every page scanned — never derived from
   * (and never capped by) `requirementIds.length`. */
  totalKnownRequirements: number;
  /** `true` only when `totalKnownRequirements > requirementIds.length`. */
  truncatedRequirements: boolean;
}

export interface AssignedActiveRequirementsLookup {
  findAssignedActiveRequirements(organizationId: string, userId: string): Promise<AssignedActiveRequirementsResult>;
}
