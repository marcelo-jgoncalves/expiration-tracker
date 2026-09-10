import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ActiveOrganizationContext, type ActiveOrganizationValue } from "../../src/auth/ActiveOrganizationContext.js";
import { OrgRouteGuard } from "../../src/routing/OrgRouteGuard.js";

function Landed() {
  const location = useLocation();
  return <div data-testid="landed">{location.pathname}</div>;
}

function renderGuard(initialPath: string, value: Partial<ActiveOrganizationValue>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const fullValue: ActiveOrganizationValue = {
    organizationId: "org-1",
    onboardingState: undefined,
    organizationSelectionRequired: undefined,
    switching: false,
    select: () => {},
    isPending: false,
    ...value,
  };
  return render(
    <QueryClientProvider client={queryClient}>
      <ActiveOrganizationContext.Provider value={fullValue}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route
              path="/app/:orgId/*"
              element={
                <OrgRouteGuard>
                  <Landed />
                </OrgRouteGuard>
              }
            />
          </Routes>
        </MemoryRouter>
      </ActiveOrganizationContext.Provider>
    </QueryClientProvider>,
  );
}

describe("OrgRouteGuard (D-2xx, Block 0)", () => {
  it("renders children immediately when the URL's orgId already matches the active organization", () => {
    renderGuard("/app/org-1/overview", { organizationId: "org-1" });
    expect(screen.getByTestId("landed")).toHaveTextContent("/app/org-1/overview");
  });

  it("calls select() with the URL's orgId when it differs from the active organization, and shows a loading state meanwhile", () => {
    const select = vi.fn();
    renderGuard("/app/org-2/overview", { organizationId: "org-1", select });

    expect(select).toHaveBeenCalledWith("org-2");
    expect(screen.queryByTestId("landed")).not.toBeInTheDocument();
  });

  it("renders children once the session catches up to the URL's orgId after switching", async () => {
    const select = vi.fn();
    const { rerender } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ActiveOrganizationContext.Provider
          value={{
            organizationId: "org-1",
            onboardingState: undefined,
            organizationSelectionRequired: undefined,
            switching: true,
            select,
            isPending: false,
          }}
        >
          <MemoryRouter initialEntries={["/app/org-2/overview"]}>
            <Routes>
              <Route
                path="/app/:orgId/*"
                element={
                  <OrgRouteGuard>
                    <Landed />
                  </OrgRouteGuard>
                }
              />
            </Routes>
          </MemoryRouter>
        </ActiveOrganizationContext.Provider>
      </QueryClientProvider>,
    );

    expect(screen.queryByTestId("landed")).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ActiveOrganizationContext.Provider
          value={{
            organizationId: "org-2",
            onboardingState: undefined,
            organizationSelectionRequired: undefined,
            switching: false,
            select,
            isPending: false,
          }}
        >
          <MemoryRouter initialEntries={["/app/org-2/overview"]}>
            <Routes>
              <Route
                path="/app/:orgId/*"
                element={
                  <OrgRouteGuard>
                    <Landed />
                  </OrgRouteGuard>
                }
              />
            </Routes>
          </MemoryRouter>
        </ActiveOrganizationContext.Provider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("landed")).toHaveTextContent("/app/org-2/overview"));
  });

  it("self-heals the URL back to the real active org once a genuinely-attempted select() settles without changing organizationId (invalid/foreign org)", async () => {
    const select = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (switching: boolean) => (
      <QueryClientProvider client={queryClient}>
        <ActiveOrganizationContext.Provider
          value={{
            organizationId: "org-1",
            onboardingState: undefined,
            organizationSelectionRequired: undefined,
            switching,
            select,
            isPending: false,
          }}
        >
          <MemoryRouter initialEntries={["/app/bogus-org/overview"]}>
            <Routes>
              <Route
                path="/app/:orgId/*"
                element={
                  <OrgRouteGuard>
                    <Landed />
                  </OrgRouteGuard>
                }
              />
            </Routes>
          </MemoryRouter>
        </ActiveOrganizationContext.Provider>
      </QueryClientProvider>
    );

    const { rerender } = render(tree(false));
    expect(select).toHaveBeenCalledWith("bogus-org");

    // Confirms the attempt actually started (mirrors the real mutation's onMutate flipping
    // `switching` true) before it settles - without this step, the guard must NOT conclude
    // failure (see the "shows a loading state meanwhile" test above).
    rerender(tree(true));
    expect(screen.queryByTestId("landed")).not.toBeInTheDocument();

    // Settles with organizationId still unchanged - a genuinely invalid/foreign orgId.
    rerender(tree(false));
    await waitFor(() => expect(screen.getByTestId("landed")).toHaveTextContent("/app/org-1/overview"));
  });
});
