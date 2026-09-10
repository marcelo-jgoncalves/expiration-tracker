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
    /** Prefix matching every status AND both dashboard modalities below (D-136/D-E:
     * `dashboardBounded`/`dashboardPage` extend this exact array, never a parallel/disconnected
     * key) - for invalidating all dashboard views at once (e.g. after create/renew, mirrors the
     * pre-B2B-10 invalidation scope of ["items","dashboard"]). */
    dashboardAll: (organizationId: string) => ["org", organizationId, "items", "dashboard"] as const,
    /** D-136/D-E: Overview's single bounded page - `limit` is part of the key because a
     * different limit is conceptually a different query, never sharing a cache entry with the
     * paginated Collection view below (they used to share `dashboard(orgId, status)`, a real
     * cache collision the D-136/D-E protocol found: a bounded Overview read could silently
     * truncate what the Collection renders, or vice versa). */
    dashboardBounded: (organizationId: string, status: string, limit: number) =>
      [...queryKeys.items.dashboardAll(organizationId), "bounded", status, limit] as const,
    /** D-136/D-E: ItemsCollection's paginated view - cursor state lives in TanStack Query's own
     * `useInfiniteQuery` pageParam, not in this key. */
    dashboardPage: (organizationId: string, status: string) =>
      [...queryKeys.items.dashboardAll(organizationId), "page", status] as const,
    detail: (organizationId: string, itemId: string) => ["org", organizationId, "items", "detail", itemId] as const,
    all: (organizationId: string) => ["org", organizationId, "items"] as const,
    /** A07 (Block 2 D-2xx) - generic per-item document attachments, `GET
     * /items/{itemId}/documents`. Nested under `items` (not a sibling top-level key) because a
     * document's whole lifecycle is scoped to exactly one item, same convention as
     * `subjects.requirements`/`subjects.submissions` below. */
    documents: (organizationId: string, itemId: string) => ["org", organizationId, "items", "documents", itemId] as const,
    /** A06 (Block 2 D-258) - item->policy discovery, `GET /items/{itemId}/reminder-policy`. */
    reminderPolicy: (organizationId: string, itemId: string) => ["org", organizationId, "items", "reminderPolicy", itemId] as const,
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
  documentArchive: {
    /** D-2xx storage-quota-scoping - tenant-wide summary, no sub-filters, one key per org. */
    storageUsage: (organizationId: string) => ["org", organizationId, "documentArchive", "storageUsage"] as const,
    /** A11 (Block 3, D-2xx) - tenant-wide Requirement search, one key per (org, status filter). */
    requirementsSearch: (organizationId: string, status: string, namePrefix: string | undefined, assigneeUserId: string | undefined) =>
      ["org", organizationId, "documentArchive", "requirements", "search", status, namePrefix ?? "", assigneeUserId ?? ""] as const,
    /** A09 (Block 3, D-2xx) - Compliance panel, `GET .../requirements/{subjectId}/compliance`. */
    subjectCompliance: (organizationId: string, subjectId: string) => ["org", organizationId, "documentArchive", "compliance", subjectId] as const,
    /** A20 (Block 4, D-2xx) - DocumentType catalog, one key per (org, status) - same "no
     * unfiltered ALL mode" discipline as `requirementsSearch` above. */
    documentTypes: (organizationId: string, status: string) => ["org", organizationId, "documentArchive", "documentTypes", "list", status] as const,
    documentType: (organizationId: string, documentTypeId: string) => ["org", organizationId, "documentArchive", "documentTypes", "detail", documentTypeId] as const,
    /** A21 (Block 4, D-2xx) - RequirementTemplate catalog. */
    requirementTemplates: (organizationId: string, status: string) => ["org", organizationId, "documentArchive", "requirementTemplates", "list", status] as const,
    requirementTemplate: (organizationId: string, templateId: string) => ["org", organizationId, "documentArchive", "requirementTemplates", "detail", templateId] as const,
    /** A13 (Block 5, D-2xx) - review queue, one key per (org, state) - `GET .../reviews?state=`
     * has no server-side "ALL" mode, same one-required-discriminator discipline as
     * `requirementsSearch` above. */
    reviewQueue: (organizationId: string, state: string) => ["org", organizationId, "documentArchive", "reviews", state] as const,
    /** A12 (Block 5, D-2xx) - Document Detail/Version History. Document metadata and its version
     * list are two independent queries/keys (never merged) - same discipline as
     * `requirementsSearch`/`reviewQueue` above, and the two are invalidated together on every
     * write since a version-list change (accept/reject/commit) can also change the Document's
     * `currentVersionId`. */
    document: (organizationId: string, documentId: string) => ["org", organizationId, "documentArchive", "documents", "detail", documentId] as const,
    documentVersions: (organizationId: string, documentId: string) => ["org", organizationId, "documentArchive", "documents", "versions", documentId] as const,
  },
  activity: {
    /** D-149: cursor state lives in TanStack Query's own `useInfiniteQuery` pageParam, not in
     * this key - `month`/`resourceType` ARE part of the key since a different filter is
     * conceptually a different query (same discipline as items.dashboardBounded's `limit`). */
    page: (organizationId: string, month: string | undefined, resourceType: string | undefined) =>
      ["org", organizationId, "activity", "page", month ?? "current", resourceType ?? "all"] as const,
  },
} as const;

/** Not tenant-scoped by design - identifies the session itself (which organization, if any,
 * is active), never scoped by the organizationId it resolves. */
export const sessionQueryKey = ["session"] as const;

/** The list of Organizations a user belongs to - itself not scoped to any one organization
 * (it exists precisely to let the user pick/see across all of them). */
export const organizationsListQueryKey = ["organizations", "list"] as const;
