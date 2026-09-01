import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderAtRoute } from "../testUtils.js";
import { OnboardingGate } from "../../src/auth/OnboardingGate.js";

vi.mock("../../src/api/organizations.js", () => ({
  createOrganization: vi.fn(),
  fetchOrganizations: vi.fn(),
  selectOrganization: vi.fn(),
}));

describe("OnboardingGate", () => {
  // Mutação: checar `!organizationId` antes de `isPending` faria este teste (sessão ainda não
  // resolvida, organizationId por isso undefined) mostrar Onboarding em vez do estado de
  // carregamento - o bug real que motivou `isPending` existir em ActiveOrganizationValue.
  it("shows a loading state (never Onboarding) while the session query hasn't resolved yet", () => {
    renderAtRoute(
      "/",
      <OnboardingGate>
        <div>REAL SHELL CONTENT</div>
      </OnboardingGate>,
      "/",
      { organizationId: undefined, isPending: true },
    );

    // D-136/D-A: neutral shared loading component - no technical wording ("session",
    // "organization") exposed to the user.
    expect(screen.getByText("Carregando…")).toBeInTheDocument();
    expect(screen.queryByText("Crie sua organização")).not.toBeInTheDocument();
    expect(screen.queryByText("REAL SHELL CONTENT")).not.toBeInTheDocument();
  });

  it("shows Onboarding once resolved with no active organization", () => {
    renderAtRoute(
      "/",
      <OnboardingGate>
        <div>REAL SHELL CONTENT</div>
      </OnboardingGate>,
      "/",
      { organizationId: undefined, isPending: false, organizationSelectionRequired: { organizations: [] } },
    );

    expect(screen.getByText("Crie sua organização")).toBeInTheDocument();
    expect(screen.queryByText("REAL SHELL CONTENT")).not.toBeInTheDocument();
  });

  it("renders children once resolved with an active organization", () => {
    renderAtRoute(
      "/",
      <OnboardingGate>
        <div>REAL SHELL CONTENT</div>
      </OnboardingGate>,
      "/",
      { organizationId: "org-1", isPending: false },
    );

    expect(screen.getByText("REAL SHELL CONTENT")).toBeInTheDocument();
  });
});
