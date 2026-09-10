/**
 * D-2xx (Block 0) - the pre-migration bare paths (`/overview`, `/items`, `/items/:itemId`, ...)
 * stay mounted, each rendering this instead of its real screen, and 301-equivalent (client-side
 * `replace`) into the same path under the real `/app/:orgId` contract. Never removed outright:
 * bookmarks, the E2E suite's existing `page.goto("/items")` calls, and anything else holding an
 * old URL keep working, healed forward to the canonical shape rather than 404ing.
 *
 * Mounted at the exact same layout level the real routes use to keep (`ProtectedRoute` >
 * `ActiveOrganizationProvider` > `OnboardingGate`) - by the time this renders, `organizationId`
 * is guaranteed defined (`OnboardingGate` renders `Onboarding` instead of this subtree
 * otherwise), so this never has to handle the "no organization yet" case itself.
 */
import { Navigate, useLocation } from "react-router-dom";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";

export function LegacyOrgRedirect() {
  const { organizationId } = useActiveOrganization();
  const location = useLocation();
  // Forwards `location.state` too (defense in depth - every internal Link/navigate() call site
  // was migrated to `useOrgPath()` precisely to avoid ever taking this route with state to lose,
  // but a stray future call site landing here should still degrade safely, not silently drop a
  // `navigate(path, { state })` payload the destination screen depends on).
  return <Navigate to={`/app/${organizationId}${location.pathname}${location.search}`} replace state={location.state} />;
}
