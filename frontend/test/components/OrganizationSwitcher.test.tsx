import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
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

  it("calls select() with the newly chosen organizationId", async () => {
    const select = vi.fn();
    fetchOrganizationsMock.mockResolvedValue({
      organizations: [
        { organizationId: "org-1", displayName: "Acme", role: "OWNER", version: 1 },
        { organizationId: "org-2", displayName: "Beta", role: "MEMBER", version: 1 },
      ],
    });

    renderAtRoute("/overview", <OrganizationSwitcher />, "/overview", { organizationId: "org-1", select });

    await waitFor(() => expect(screen.getByLabelText("Organização")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Organização"), { target: { value: "org-2" } });

    expect(select).toHaveBeenCalledWith("org-2");
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
