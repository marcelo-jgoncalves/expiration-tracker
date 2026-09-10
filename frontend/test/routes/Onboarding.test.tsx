import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderAtRoute } from "../testUtils.js";
import { Onboarding } from "../../src/routes/Onboarding.js";

const { createOrganizationMock } = vi.hoisted(() => ({ createOrganizationMock: vi.fn() }));
vi.mock("../../src/api/organizations.js", () => ({
  createOrganization: createOrganizationMock,
  fetchOrganizations: vi.fn(),
  selectOrganization: vi.fn(),
}));

beforeEach(() => {
  createOrganizationMock.mockReset();
});

describe("Onboarding", () => {
  // Wave B2B-14: this is the exact case a freshly-bootstrapped identity hits (zero usable
  // Organizations) - the gap that left every other screen stuck on its loading skeleton
  // forever before OnboardingGate/Onboarding existed.
  it("shows the create-organization form when there are zero usable organizations", () => {
    renderAtRoute("/onboarding", <Onboarding />, "/onboarding", { organizationSelectionRequired: { organizations: [] } });

    expect(screen.getByText("Crie sua organização")).toBeInTheDocument();
    expect(screen.getByLabelText(/Nome da organização/)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  // Mutação: usar `displayName`/`timezone` hardcoded em vez dos valores reais do form faria
  // este teste (que digita um valor específico e verifica que ELE é enviado) falhar.
  it("submits the typed displayName/timezone to createOrganization", async () => {
    createOrganizationMock.mockResolvedValue({ organizationId: "org-new" });
    renderAtRoute("/onboarding", <Onboarding />, "/onboarding", { organizationSelectionRequired: { organizations: [] } });

    fireEvent.change(screen.getByLabelText(/Nome da organização/), { target: { value: "Acme Corp" } });
    fireEvent.change(screen.getByLabelText(/Fuso horário/), { target: { value: "America/Sao_Paulo" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar organização" }));

    await waitFor(() => expect(createOrganizationMock).toHaveBeenCalledWith({ displayName: "Acme Corp", timezone: "America/Sao_Paulo" }));
  });

  // Wave B2B-14: the OTHER real case organizationSelectionRequired covers (1+ organizations,
  // none currently selected) - distinct from "zero organizations", never the create form.
  // A02 (D-255/D-2xx): renders a card grid (name + role) instead of a plain button list, but the
  // create-organization form stays embedded below it (still reachable without a separate route).
  it("shows an org card grid, each card labelled with name and role, when 1+ usable organizations exist but none is selected", () => {
    const selectMock = vi.fn();
    renderAtRoute(
      "/onboarding",
      <Onboarding />,
      "/onboarding",
      {
        organizationSelectionRequired: {
          organizations: [
            { organizationId: "org-a", displayName: "Org A", role: "OWNER", version: 1 },
            { organizationId: "org-b", displayName: "Org B", role: "MEMBER", version: 1 },
          ],
        },
        select: selectMock,
      },
    );

    expect(screen.getByText("Suas organizações")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    // Create-organization form remains embedded, reachable without a separate route.
    expect(screen.getByLabelText(/Nome da organização/)).toBeInTheDocument();

    const cardB = screen.getByRole("button", { name: /Org B/ });
    expect(cardB).toHaveTextContent("Member");
    fireEvent.click(cardB);
    expect(selectMock).toHaveBeenCalledWith("org-b");
  });

  // A02 spec's suspended-membership disabled-card rule requires suspended-state data the BFF
  // does not return today (D-255/D-2xx investigation) - graceful degradation means every listed
  // card is enabled/navigable, never a fabricated disabled state.
  it("never disables a listed org card - suspended-Membership data is not available from the BFF today", () => {
    renderAtRoute(
      "/onboarding",
      <Onboarding />,
      "/onboarding",
      {
        organizationSelectionRequired: {
          organizations: [{ organizationId: "org-a", displayName: "Org A", role: "OWNER", version: 1 }],
        },
        select: vi.fn(),
      },
    );
    expect(screen.getByRole("button", { name: /Org A/ })).toBeEnabled();
  });
});
