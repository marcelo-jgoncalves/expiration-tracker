import { describe, expect, it, beforeEach, vi } from "vitest";
import { Route } from "react-router-dom";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderAtRoute } from "../../testUtils.js";
import { SubjectLayout } from "../../../src/routes/subjects/SubjectLayout.js";
import type { TrackedSubject } from "../../../src/api/types.js";

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock("../../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, post: vi.fn() },
}));

const { fetchOrganizationsMock } = vi.hoisted(() => ({ fetchOrganizationsMock: vi.fn() }));
vi.mock("../../../src/api/organizations.js", () => ({
  fetchOrganizations: fetchOrganizationsMock,
  selectOrganization: vi.fn(),
}));

function mockAsRole(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role, version: 1 }] });
}

function subject(overrides: Partial<TrackedSubject> = {}): TrackedSubject {
  return {
    subjectId: "subject-1",
    tenantId: "t1",
    type: "VENDOR",
    displayName: "Conservare Facilities ME",
    externalId: "14.221.900/0001-55",
    tags: [],
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

/** Placeholder for the real nested content (`RequirementsCollection`, tested on its own) - this
 * file is only about `SubjectLayout` itself: identity/actions/compliance/local nav never
 * unmounting, per D-339. */
function IndexPlaceholder() {
  return <p>conteúdo de requisitos aqui</p>;
}

function renderLayout(initialEntry: string) {
  return renderAtRoute(
    "/subjects/:subjectId/*",
    <SubjectLayout />,
    initialEntry,
    undefined,
    <>
      <Route index element={<IndexPlaceholder />} />
      <Route path="requests" element={<p>conteúdo de solicitações aqui</p>} />
    </>,
  );
}

beforeEach(() => {
  getMock.mockReset();
  fetchOrganizationsMock.mockReset();
  getMock.mockImplementation((path: string) => {
    if (path.includes("/compliance")) {
      return Promise.resolve({ compliance: { totalRequirements: 2, satisfiedCount: 1, expiringSoonCount: 0, missingCount: 1, compliancePercent: 50 } });
    }
    if (path.startsWith("/subjects/")) {
      return Promise.resolve({ subject: subject() });
    }
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
});

describe("SubjectLayout (D-339, substitui A09 SubjectHub)", () => {
  it("renders the subject name, type, and compliance numerator/denominator, with the index section's content", async () => {
    renderLayout("/subjects/subject-1");

    await waitFor(() => expect(screen.getByRole("heading", { name: "Conservare Facilities ME" })).toBeInTheDocument());
    expect(screen.getByText(/Fornecedor.*14\.221\.900/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("1 de 2 requisitos satisfeitos")).toBeInTheDocument());
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("conteúdo de requisitos aqui")).toBeInTheDocument();
  });

  it("keeps the subject identity/compliance/nav mounted while switching to the Solicitações section", async () => {
    renderLayout("/subjects/subject-1/requests");

    await waitFor(() => expect(screen.getByRole("heading", { name: "Conservare Facilities ME" })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("50%")).toBeInTheDocument());
    expect(screen.getByText("conteúdo de solicitações aqui")).toBeInTheDocument();
    expect(screen.queryByText("conteúdo de requisitos aqui")).not.toBeInTheDocument();
  });

  it("local nav marks 'Requisitos' as current on the index route, and 'Solicitações' on /requests", async () => {
    renderLayout("/subjects/subject-1");
    await waitFor(() => expect(screen.getByRole("link", { name: "Requisitos" })).toHaveAttribute("aria-current", "page"));
    expect(screen.getByRole("link", { name: "Solicitações" })).not.toHaveAttribute("aria-current");
  });

  it("shows '—' (never 0%) when totalRequirements is 0", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.includes("/compliance")) {
        return Promise.resolve({ compliance: { totalRequirements: 0, satisfiedCount: 0, expiringSoonCount: 0, missingCount: 0, compliancePercent: null } });
      }
      return Promise.resolve({ subject: subject() });
    });
    renderLayout("/subjects/subject-1");

    // Item 37 (spec §5.6): sem denominador, nunca "0 de 0 requisitos satisfeitos" (a frase antiga
    // sugeria uma avaliação real que deu zero) - o texto explícito é "Nenhum requisito aplicável
    // cadastrado", e o valor acessível do "—" anuncia a ausência de base de cálculo, não 0%.
    // Mutação: reverter para "0 de 0 requisitos satisfeitos" faria esta asserção falhar.
    await waitFor(() => expect(screen.getByText("Nenhum requisito aplicável cadastrado")).toBeInTheDocument());
    expect(screen.queryByText(/de 0 requisitos satisfeitos/)).not.toBeInTheDocument();
    const section = screen.getByRole("heading", { name: "Conformidade documental" }).closest("section");
    expect(section?.querySelector(".ui-compliance__percent")?.textContent).toBe("—");
    expect(section?.querySelector(".ui-compliance__percent")).toHaveAttribute("aria-label", "Conformidade não calculada: nenhum requisito aplicável cadastrado");
  });

  it("'Editar fornecedor' opens the SubjectFormDialog modal pre-filled, instead of navigating to a route", async () => {
    mockAsRole("OWNER");
    renderLayout("/subjects/subject-1");

    await waitFor(() => expect(screen.getByRole("button", { name: "Editar fornecedor" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Editar fornecedor" }));

    expect(await screen.findByRole("dialog", { name: "Editar fornecedor" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/^Nome/)).toHaveValue("Conservare Facilities ME"));
  });

  it("shows the archived InlineNotice for an ARCHIVED subject", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.includes("/compliance")) return Promise.resolve({ compliance: { totalRequirements: 0, satisfiedCount: 0, expiringSoonCount: 0, missingCount: 0, compliancePercent: null } });
      return Promise.resolve({ subject: subject({ status: "ARCHIVED" }) });
    });
    renderLayout("/subjects/subject-1");

    await waitFor(() => expect(screen.getByText(/Este fornecedor está arquivado/)).toBeInTheDocument());
  });
});
