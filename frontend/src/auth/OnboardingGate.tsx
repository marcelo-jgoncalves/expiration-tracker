/**
 * Renders `Onboarding` INSTEAD of `children` (AppShell + nested routes) whenever the
 * authenticated session has no active organization yet (Wave B2B-14 - see Onboarding.tsx's own
 * header comment for why this gate didn't exist before). Mounted inside
 * `ActiveOrganizationProvider`, same nesting level `AppShell` used to be at directly.
 *
 * `isPending` (the session query's own first resolution, not `switching`) is what tells
 * "haven't checked yet" apart from "checked, no organization exists" - both look identical from
 * `organizationId` alone, since it's `undefined` in both cases.
 */
import type { ReactNode } from "react";
import { useActiveOrganization } from "./ActiveOrganizationContext.js";
import { Onboarding } from "../routes/Onboarding.js";
import { InitialLoading } from "../components/AsyncStates.js";

export function OnboardingGate({ children }: { children: ReactNode }) {
  const { organizationId, isPending } = useActiveOrganization();

  if (isPending) {
    // D-136/D-A: same neutral component as ProtectedRoute's own loading state - by the time
    // this renders, ActiveOrganizationProvider's session query almost always already has a
    // fresh cached result from AuthProvider's own fetch (same queryKey/staleTime), so this
    // resolves near-instantly rather than triggering a second network round-trip.
    return <InitialLoading />;
  }

  if (!organizationId) {
    return <Onboarding />;
  }

  return <>{children}</>;
}
