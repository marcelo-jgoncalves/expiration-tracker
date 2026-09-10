/**
 * D-2xx (Block 0) - keeps the `:orgId` URL segment and the session's real `activeOrganizationId`
 * (`ActiveOrganizationContext`, Wave B2B-10) reconciled, without introducing a second,
 * competing source of truth. `organizationId` itself stays server-derived exactly as before
 * (the browser still never SENDS it on resource calls - `proxy-service.ts` resolves tenant scope
 * from the session cookie) - this component's only job is to keep the ADDRESS BAR in sync with
 * that session state, using the SAME `select()` mutation the switcher already used
 * (ActiveOrganizationContext's cancel-in-flight + revalidate machinery, unchanged).
 *
 * Mounted just inside `OnboardingGate` (so `organizationId` is always already defined here -
 * `OnboardingGate` renders `Onboarding` instead of this subtree otherwise), wrapping `AppShell`.
 *
 * Reconciliation, one attempt per distinct `orgId`:
 *  - `orgId === organizationId`: already in sync, render children.
 *  - otherwise, on the FIRST render of a new `orgId`: call `select(orgId)` and render a loading
 *    placeholder (never bounce the URL back before even trying - a validly-shared link to a
 *    different real organization must actually switch, not silently reject).
 *  - once that attempt SETTLES (`switching` goes back to false) and `organizationId` still
 *    doesn't match: the candidate `orgId` was invalid/foreign (no active Membership) - self-heal
 *    the URL back to the real active organization's, same rationale as the backend's own
 *    self-heal of a stale `activeOrganizationId` (`resolveSessionWithOnboarding`).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import { InitialLoading } from "../components/AsyncStates.js";

export function OrgRouteGuard({ children }: { children: ReactNode }) {
  const { orgId } = useParams<{ orgId: string }>();
  const { organizationId, switching, select } = useActiveOrganization();
  const location = useLocation();
  const [attemptedOrgId, setAttemptedOrgId] = useState<string | undefined>(undefined);
  // `select()`'s mutation flips `switching` asynchronously (a tick after `mutate()` is called,
  // never within the same render) - this tracks whether THIS attempt has actually been seen
  // in flight at least once, so a render in the single-tick gap between "just called select()"
  // and "switching turned true" is never mistaken for "the attempt already settled and failed".
  const sawSwitchingForAttempt = useRef(false);

  useEffect(() => {
    if (!orgId || orgId === organizationId) return;
    if (switching) {
      sawSwitchingForAttempt.current = true;
      return;
    }
    if (attemptedOrgId !== orgId) {
      setAttemptedOrgId(orgId);
      sawSwitchingForAttempt.current = false;
      select(orgId);
    }
    // Only re-runs when the URL's orgId itself changes (or organizationId/switching catch up) -
    // never re-fires purely because `select`'s identity changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, organizationId, switching, attemptedOrgId]);

  if (!orgId || orgId === organizationId) return <>{children}</>;

  if (switching || attemptedOrgId !== orgId || !sawSwitchingForAttempt.current) {
    return <InitialLoading label="Carregando organização…" />;
  }

  // The select() attempt for this exact orgId was actually observed in flight (switching went
  // true) and has since settled with organizationId still not matching - orgId does not resolve
  // to a Membership this user actually has. Self-heal the URL rather than trusting it further
  // (organizationId is guaranteed defined here by OnboardingGate).
  const healedPath = location.pathname.replace(`/${orgId}`, `/${organizationId}`);
  return <Navigate to={`${healedPath}${location.search}`} replace />;
}
