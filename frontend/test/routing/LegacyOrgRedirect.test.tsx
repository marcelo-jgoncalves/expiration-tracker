import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ActiveOrganizationContext, type ActiveOrganizationValue } from "../../src/auth/ActiveOrganizationContext.js";
import { LegacyOrgRedirect } from "../../src/routing/LegacyOrgRedirect.js";

function activeOrganizationValue(overrides: Partial<ActiveOrganizationValue>): ActiveOrganizationValue {
  return {
    organizationId: "org-9",
    onboardingState: undefined,
    organizationSelectionRequired: undefined,
    switching: false,
    select: () => {},
    isPending: false,
    ...overrides,
  };
}

function Landed() {
  const location = useLocation();
  return (
    <div data-testid="landed">
      {location.pathname}
      {location.search}
    </div>
  );
}

function renderAtLegacyPath(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ActiveOrganizationContext.Provider value={activeOrganizationValue({})}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route
              path="/app/:orgId/*"
              element={
                <Landed />
              }
            />
            <Route path="*" element={<LegacyOrgRedirect />} />
          </Routes>
        </MemoryRouter>
      </ActiveOrganizationContext.Provider>
    </QueryClientProvider>,
  );
}

describe("LegacyOrgRedirect (D-2xx, Block 0)", () => {
  it("heals a bare legacy path forward to the equivalent /app/:orgId path, preserving the sub-path", () => {
    renderAtLegacyPath("/items/item-1/renew");
    expect(screen.getByTestId("landed")).toHaveTextContent("/app/org-9/items/item-1/renew");
  });

  it("preserves a query string across the redirect", () => {
    renderAtLegacyPath("/items?status=active");
    expect(screen.getByTestId("landed")).toHaveTextContent("/app/org-9/items?status=active");
  });
});
