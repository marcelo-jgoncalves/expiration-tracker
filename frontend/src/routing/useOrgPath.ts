/**
 * D-2xx (Block 0) - every real screen mounts under `/app/:orgId/...` now; an internal `Link`/
 * `navigate()` call that still targets an old bare path (`/items/${id}`) works (LegacyOrgRedirect
 * heals it forward), but at the cost of a real, visible round trip: AppShell fully unmounts and
 * remounts across that extra hop, which breaks the route-change focus management
 * (`AppShell.tsx`'s `useFocusMainOnRouteChange` treats the remount as a first render and skips
 * focusing `#surface-content`) and drops any `navigate(path, { state })` payload LegacyOrgRedirect
 * doesn't forward (found by the E2E suite: CreateItem/RenewItem's post-success banners rely on
 * that state). Every internal link/navigate call site was migrated to this helper for exactly
 * that reason - it must stay the one way screens address each other going forward.
 */
import { useParams } from "react-router-dom";

/** `path` is the part after `/app/:orgId` (must start with `/`, e.g. `/items/${itemId}`). */
export function useOrgPath(): (path: string) => string {
  const { orgId } = useParams<{ orgId: string }>();
  return (path: string) => `/app/${orgId}${path}`;
}
