import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { renderAtRoute } from "../testUtils.js";
import { OrganizationSwitcher } from "../../src/components/OrganizationSwitcher.js";

const { fetchOrganizationsMock } = vi.hoisted(() => ({ fetchOrganizationsMock: vi.fn() }));
vi.mock("../../src/api/organizations.js", () => ({
  fetchOrganizations: fetchOrganizationsMock,
  selectOrganization: vi.fn(),
}));

beforeEach(() => {
  fetchOrganizationsMock.mockReset();
});

describe("OrganizationSwitcher", () => {
  it("renders nothing when the user belongs to only one Organization", async () => {
    fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 1 }] });

    renderAtRoute("/overview", <OrganizationSwitcher />, "/overview");

    await waitFor(() => expect(fetchOrganizationsMock).toHaveBeenCalled());
    expect(screen.queryByLabelText("Organização")).not.toBeInTheDocument();
  });

  it("renders a select listing every Organization, with the active one selected, when there are 2+", async () => {
    fetchOrganizationsMock.mockResolvedValue({
      organizations: [
        { organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 1 },
        { organizationId: "org-2", displayName: "Beta", role: "MEMBER", version: 1 },
      ],
    });

    renderAtRoute("/overview", <OrganizationSwitcher />, "/overview", { organizationId: "org-2" });

    await waitFor(() => expect(screen.getByLabelText("Organização")).toBeInTheDocument());
    expect(screen.getByLabelText("Organização")).toHaveValue("org-2");
    expect(screen.getByRole("option", { name: "Acme" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Beta" })).toBeInTheDocument();
  });

  it("navigates to the chosen organization's /app/:orgId/overview URL (D-2xx: OrgRouteGuard, not this component, calls select())", async () => {
    fetchOrganizationsMock.mockResolvedValue({
      organizations: [
        { organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 1 },
        { organizationId: "org-2", displayName: "Beta", role: "MEMBER", version: 1 },
      ],
    });

    function LocationProbe() {
      const location = useLocation();
      return <span data-testid="pathname">{location.pathname}</span>;
    }

    renderAtRoute(
      "/overview",
      <>
        <OrganizationSwitcher />
        <LocationProbe />
      </>,
      "/overview",
      { organizationId: "org-1" },
    );

    await waitFor(() => expect(screen.getByLabelText("Organização")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Organização"), { target: { value: "org-2" } });

    await waitFor(() => expect(screen.getByTestId("pathname")).toHaveTextContent("/app/org-2/overview"));
  });

  it("disables the select while switching", async () => {
    fetchOrganizationsMock.mockResolvedValue({
      organizations: [
        { organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 1 },
        { organizationId: "org-2", displayName: "Beta", role: "MEMBER", version: 1 },
      ],
    });

    renderAtRoute("/overview", <OrganizationSwitcher />, "/overview", { organizationId: "org-1", switching: true });

    await waitFor(() => expect(screen.getByLabelText("Organização")).toBeDisabled());
  });
});
