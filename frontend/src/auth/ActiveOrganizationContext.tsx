/**
 * Active organization state (Wave B2B-10 design, `docs/architecture/reviews/
 * multi-user-b2b-wave-b2b10-scoping/`, Claude 9.2/Codex 9.2 - 3 rounds, `AGENTS.md` §4).
 *
 * Deliberately a SINGLE Context Provider, never a bare hook reimplementing this state per
 * caller (Round 2 finding: multiple `useState` instances would desync `switching`, letting
 * org-scoped queries in one part of the tree keep fetching while the switcher itself thinks a
 * switch is in progress). Mount `ActiveOrganizationProvider` once, inside `AuthProvider`, above
 * everything that needs tenant-scoped data - `useActiveOrganization()` only ever consumes it.
 *
 * Closes the real cache-isolation race found in Round 1/2 of the design debate: `organizationId`
 * is NOT itself an input the backend's queryFn depends on (the browser never sends it - the BFF
 * derives tenant scope from the session server-side, `proxy-service.ts`), so TanStack Query's
 * "changing a key segment refetches automatically" guarantee does not apply here on its own.
 * The `switching` flag + explicit `cancelQueries` close both halves of the race: no NEW
 * org-scoped fetch starts while switching, and any request already in flight for the OLD
 * organization is aborted (via the AbortSignal every org-scoped queryFn now forwards - see
 * `api/items.ts`/`api/subjects.ts`) rather than left to resolve into the wrong cache entry.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchSessionInfo, type OnboardingState, type UsableOrganization } from "../api/session.js";
import { selectOrganization as selectOrganizationRequest } from "../api/organizations.js";
import { sessionQueryKey } from "../api/queryKeys.js";

/** Exported so test suites can supply a fixed value directly (`ActiveOrganizationContext.Provider
 * value={{...}}`) instead of exercising the real network-backed `ActiveOrganizationProvider` for
 * every route test that merely needs an `organizationId` to exist - see `test/testUtils.tsx`. */
export interface ActiveOrganizationValue {
  /** `undefined` while the session query hasn't resolved yet, or when no organization is
   * currently selected (0 or >1 usable organizations - see `organizationSelectionRequired`). */
  organizationId: string | undefined;
  onboardingState: OnboardingState | undefined;
  organizationSelectionRequired: { organizations: UsableOrganization[] } | undefined;
  /** True only for the session query's OWN first resolution (Wave B2B-14's `OnboardingGate`
   * needs this to tell "haven't checked yet" apart from "checked, no organization exists" -
   * both look identical from `organizationId`/`organizationSelectionRequired` alone, since
   * neither is populated until the query actually resolves). Never true again after the first
   * resolution - a later `switching`/refetch is a distinct, already-covered state. */
  isPending: boolean;
  /** True from the moment `select()` is called until the session refetch confirms the new
   * `activeOrganizationId` - every org-scoped `useQuery` must gate on `!switching` (via
   * `enabled`) for the duration. */
  switching: boolean;
  select: (organizationId: string) => void;
}

export const ActiveOrganizationContext = createContext<ActiveOrganizationValue | undefined>(undefined);

export function ActiveOrganizationProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [switching, setSwitching] = useState(false);

  const sessionQuery = useQuery({
    queryKey: sessionQueryKey,
    queryFn: ({ signal }) => fetchSessionInfo({ signal }),
    // 30s, matching AuthContext's window (D-136/D-A) - this Provider mounts only once
    // AuthProvider's own session query already resolved AUTHENTICATED, so as long as both
    // share the same staleTime the cached result from that first fetch is still fresh here,
    // and TanStack Query serves it without a second network round-trip to /bff/session.
    staleTime: 30_000,
  });

  const selectMutation = useMutation({
    mutationFn: (organizationId: string) => selectOrganizationRequest(organizationId),
    onMutate: async (_newOrganizationId) => {
      setSwitching(true);
      const currentOrganizationId = sessionQuery.data?.activeOrganizationId;
      // Aborts any in-flight fetch for the CURRENT organization (every "org"-prefixed key,
      // items/subjects/members/invitations alike) - closes the half of the race where a
      // response arrives after the server has already flipped the session, but would
      // otherwise still be written into the old organization's cache entry.
      if (currentOrganizationId) {
        await queryClient.cancelQueries({ queryKey: ["org", currentOrganizationId], exact: false });
      }
    },
    onSettled: async () => {
      // Only re-enable org-scoped queries once the session itself confirms the new
      // activeOrganizationId - never assume the mutation's 204 alone means the client-visible
      // state has caught up.
      await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
      setSwitching(false);
    },
  });

  const select = useCallback((organizationId: string) => selectMutation.mutate(organizationId), [selectMutation]);

  const value = useMemo<ActiveOrganizationValue>(
    () => ({
      organizationId: sessionQuery.data?.activeOrganizationId,
      onboardingState: sessionQuery.data?.onboardingState,
      organizationSelectionRequired: sessionQuery.data?.organizationSelectionRequired,
      switching,
      select,
      isPending: sessionQuery.isPending,
    }),
    [sessionQuery.data, sessionQuery.isPending, switching, select],
  );

  return <ActiveOrganizationContext.Provider value={value}>{children}</ActiveOrganizationContext.Provider>;
}

export function useActiveOrganization(): ActiveOrganizationValue {
  const ctx = useContext(ActiveOrganizationContext);
  if (!ctx) throw new Error("useActiveOrganization must be used within an ActiveOrganizationProvider.");
  return ctx;
}
