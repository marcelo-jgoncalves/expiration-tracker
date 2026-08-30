import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, type InitialEntry } from "react-router-dom";
import type { ReactElement } from "react";
import { ActiveOrganizationContext, type ActiveOrganizationValue } from "../src/auth/ActiveOrganizationContext.js";

/** Fixed, network-free stand-in for `ActiveOrganizationProvider` (Wave B2B-10) - every route
 * test that merely needs `organizationId` to be defined (so org-scoped `enabled` gates pass)
 * uses this by default, never the real network-backed Provider. Tests of the switch mechanism
 * itself (cancellation, the `switching` gate, cache isolation) exercise the real
 * `ActiveOrganizationProvider` directly with `fetchSessionInfo`/`selectOrganization` mocked -
 * see `test/auth/ActiveOrganizationContext.test.tsx`. */
export const TEST_ORGANIZATION_ID = "org-1";

function defaultActiveOrganizationValue(): ActiveOrganizationValue {
  return {
    organizationId: TEST_ORGANIZATION_ID,
    onboardingState: undefined,
    organizationSelectionRequired: undefined,
    switching: false,
    select: () => {},
  };
}

/** Renders a routed component at a given path with its own isolated QueryClient (retry
 * disabled - tests assert on the first attempt's outcome, never a flaky retry timing race).
 * `initialEntry` accepts a plain path string, or `{ pathname, state }` to simulate a
 * `navigate(path, { state })` landing (e.g. CreateItem's post-success redirect).
 * `activeOrganization` overrides the stub `ActiveOrganizationContext` value (default: a fixed
 * `organizationId`, never switching) - pass a partial override for a test that specifically
 * needs `switching: true` or a different `organizationId`. */
export function renderAtRoute(
  routePath: string,
  element: ReactElement,
  initialEntry: InitialEntry,
  activeOrganization?: Partial<ActiveOrganizationValue>,
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ActiveOrganizationContext.Provider value={{ ...defaultActiveOrganizationValue(), ...activeOrganization }}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path={routePath} element={element} />
          </Routes>
        </MemoryRouter>
      </ActiveOrganizationContext.Provider>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}
