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

export function OnboardingGate({ children }: { children: ReactNode }) {
  const { organizationId, isPending } = useActiveOrganization();

  if (isPending) {
    return (
      <div role="status" aria-live="polite">
        Carregando sua organização…
      </div>
    );
  }

  if (!organizationId) {
    return <Onboarding />;
  }

  return <>{children}</>;
}
