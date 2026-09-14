/**
 * PERF-10 (`docs/engineering/performance/TODO.md`, Ciclo B) — shared `staleTime` policy for
 * every `useQuery`/`useInfiniteQuery` call site. Before this, almost every hook had no
 * `staleTime` at all (TanStack Query's default of 0 — refetch on every mount/focus-back), a
 * handful had ad-hoc inline values (`ActiveOrganizationContext.tsx`/`AuthContext.tsx`'s shared
 * `sessionQueryKey`, 30s, deliberately kept as-is — see those files' own comments). This module
 * gives every other hook one of 4 named freshness classes instead of a magic number chosen per
 * call site.
 *
 * Classification is by how often the underlying data realistically changes in this product's
 * domain, and whether a slightly-stale read has any real user-facing cost:
 *  - `STATICISH` — catalogs/reference data an OWNER/ADMIN edits rarely (document type & template
 *    catalogs, the list of organizations a user belongs to). Stale-for-minutes is invisible.
 *  - `REFERENCE` — changes with organizational activity but not from moment to moment (members,
 *    invitations, subject/assignment detail, delivery preferences, series/legacy requests,
 *    report subscriptions, storage usage). A short cache window is a reasonable trade for fewer
 *    refetches on routine navigation.
 *  - `OPERATIONAL` — dashboards/queues/search views that reflect day-to-day work in progress
 *    (items/subjects dashboards, review queue, requirements search/collection, compliance,
 *    activity feed, document detail/versions, reminder policy). Short enough that a teammate's
 *    concurrent change shows up within one interaction, long enough to avoid refetching on every
 *    remount.
 *  - `NEAR_REALTIME` — screens the user is actively watching move (import job/row-results
 *    progress, run polling). These already drive freshness via `refetchInterval` at the call
 *    site (see `useImportJob.ts`, `DossierExport.tsx`'s `pollQuery`) — `staleTime` here is 0 so
 *    a manual `refetch()`/mount always gets a live read, never a cached one.
 */
export const STALE_TIME = {
  STATICISH: 10 * 60 * 1000,
  REFERENCE: 2 * 60 * 1000,
  OPERATIONAL: 30 * 1000,
  NEAR_REALTIME: 0,
} as const;
