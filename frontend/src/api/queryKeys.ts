/**
 * Central query key factory (Wave B2B-10, `docs/architecture/reviews/
 * multi-user-b2b-wave-b2b10-scoping/`) - every tenant-scoped query/invalidation key goes
 * through here, never written by hand at the call site. `organizationId` is a required
 * parameter of every factory function (not read from an implicit module-level variable) so
 * the compiler forces every call site to supply it explicitly - same discipline as
 * `organizationIdHint` in the backend's `resolve-request-context.ts` (Wave B2B-6).
 *
 * `organizationId` alone is NOT sufficient to prevent cross-tenant cache leakage during a
 * switch (the browser never sends it - the BFF derives tenant scope from the session
 * server-side) - see `auth/ActiveOrganizationContext.tsx` for the `switching` gate that
 * closes that race. This factory only owns key SHAPE/isolation-by-key, not the switch-time
 * race itself.
 */
export const queryKeys = {
  items: {
    dashboard: (organizationId: string, status: string) => ["org", organizationId, "items", "dashboard", status] as const,
    /** Prefix matching every status - for invalidating all dashboard views at once (e.g. after
     * create/renew, mirrors the pre-B2B-10 invalidation scope of ["items","dashboard"]). */
    dashboardAll: (organizationId: string) => ["org", organizationId, "items", "dashboard"] as const,
    detail: (organizationId: string, itemId: string) => ["org", organizationId, "items", "detail", itemId] as const,
    all: (organizationId: string) => ["org", organizationId, "items"] as const,
  },
  subjects: {
    dashboard: (organizationId: string, status: string) => ["org", organizationId, "subjects", "dashboard", status] as const,
    detail: (organizationId: string, subjectId: string) => ["org", organizationId, "subjects", "detail", subjectId] as const,
    requirements: (organizationId: string, subjectId: string) => ["org", organizationId, "subjects", "requirements", subjectId] as const,
    submissions: (organizationId: string, subjectId: string, assignmentId: string) =>
      ["org", organizationId, "subjects", "submissions", subjectId, assignmentId] as const,
  },
  organizations: {
    members: (organizationId: string) => ["org", organizationId, "members"] as const,
    invitations: (organizationId: string) => ["org", organizationId, "invitations"] as const,
  },
} as const;

/** Not tenant-scoped by design - identifies the session itself (which organization, if any,
 * is active), never scoped by the organizationId it resolves. */
export const sessionQueryKey = ["session"] as const;

/** The list of Organizations a user belongs to - itself not scoped to any one organization
 * (it exists precisely to let the user pick/see across all of them). */
export const organizationsListQueryKey = ["organizations", "list"] as const;
