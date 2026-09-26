import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor, within, fireEvent } from "@testing-library/react";
import { renderAtRoute } from "../../testUtils.js";
import { SubjectHub } from "../../../src/routes/subjects/SubjectHub.js";
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

beforeEach(() => {
  getMock.mockReset();
  fetchOrganizationsMock.mockReset();
  getMock.mockImplementation((path: string) => {
    if (path.includes("/compliance")) {
      return Promise.resolve({ compliance: { totalRequirements: 2, satisfiedCount: 1, expiringSoonCount: 0, missingCount: 1, compliancePercent: 50 } });
    }
    if (path.startsWith("/document-archive/requirements/")) {
      return Promise.resolve({ requirements: [] });
    }
    // A14 (Block 6) - active-series count for the "Solicitações e recorrência" card (holistic
    // frontend review fix - this card used to be a dead "Em breve" placeholder).
    if (path.startsWith("/document-archive/series/")) {
      return Promise.resolve({ series: [] });
    }
    if (path.startsWith("/subjects/")) {
      return Promise.resolve({ subject: subject() });
    }
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
});

describe("SubjectHub (A09)", () => {
  it("renders the subject name, type, and compliance numerator/denominator", async () => {
    renderAtRoute("/subjects/:subjectId", <SubjectHub />, "/subjects/subject-1");

    await waitFor(() => expect(screen.getByRole("heading", { name: "Conservare Facilities ME" })).toBeInTheDocument());
    expect(screen.getByText(/Fornecedor.*14\.221\.900/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("1 de 2 requisitos satisfeitos")).toBeInTheDocument());
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("A14 (Block 6, holistic frontend review fix): renders 'Solicitações e recorrência' as a real link with the active-series count, never 'Em breve' text", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.includes("/compliance")) return Promise.resolve({ compliance: { totalRequirements: 2, satisfiedCount: 1, expiringSoonCount: 0, missingCount: 1, compliancePercent: 50 } });
      if (path.startsWith("/document-archive/requirements/")) return Promise.resolve({ requirements: [] });
      if (path.startsWith("/document-archive/series/")) {
        return Promise.resolve({ series: [{ status: "ACTIVE" }, { status: "ACTIVE" }, { status: "CANCELLED" }] });
      }
      return Promise.resolve({ subject: subject() });
    });
    renderAtRoute("/subjects/:subjectId", <SubjectHub />, "/subjects/subject-1");

    const link = await screen.findByRole("link", { name: /Solicitações e recorrência/ });
    expect(link).toHaveAttribute("href", expect.stringContaining("/subjects/subject-1/requests"));
    expect(within(link).getByText("2")).toBeInTheDocument();
    expect(screen.queryByText(/Em breve/)).not.toBeInTheDocument();
  });

  it("shows '—' (never 0%) when totalRequirements is 0", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.includes("/compliance")) {
        return Promise.resolve({ compliance: { totalRequirements: 0, satisfiedCount: 0, expiringSoonCount: 0, missingCount: 0, compliancePercent: null } });
      }
      if (path.startsWith("/document-archive/requirements/")) return Promise.resolve({ requirements: [] });
      if (path.startsWith("/document-archive/series/")) return Promise.resolve({ series: [] });
      return Promise.resolve({ subject: subject() });
    });
    renderAtRoute("/subjects/:subjectId", <SubjectHub />, "/subjects/subject-1");

    await waitFor(() => expect(screen.getByText("0 de 0 requisitos satisfeitos")).toBeInTheDocument());
    // Scoped to the compliance panel's percentage element - the page also renders other em
    // dashes now too (e.g. a loading MetricCard before its query resolves).
    const section = screen.getByRole("heading", { name: "Conformidade" }).closest("section");
    expect(section?.querySelector(".ui-compliance__percent")?.textContent).toBe("—");
  });

  it("'Editar fornecedor' opens the SubjectFormDialog modal pre-filled, instead of navigating to a route", async () => {
    mockAsRole("OWNER");
    renderAtRoute("/subjects/:subjectId", <SubjectHub />, "/subjects/subject-1");

    await waitFor(() => expect(screen.getByRole("button", { name: "Editar fornecedor" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Editar fornecedor" }));

    expect(await screen.findByRole("dialog", { name: "Editar fornecedor" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/^Nome/)).toHaveValue("Conservare Facilities ME"));
  });

  it("shows the archived InlineNotice for an ARCHIVED subject", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.includes("/compliance")) return Promise.resolve({ compliance: { totalRequirements: 0, satisfiedCount: 0, expiringSoonCount: 0, missingCount: 0, compliancePercent: null } });
      if (path.startsWith("/document-archive/requirements/")) return Promise.resolve({ requirements: [] });
      if (path.startsWith("/document-archive/series/")) return Promise.resolve({ series: [] });
      return Promise.resolve({ subject: subject({ status: "ARCHIVED" }) });
    });
    renderAtRoute("/subjects/:subjectId", <SubjectHub />, "/subjects/subject-1");

    await waitFor(() => expect(screen.getByText(/Este fornecedor está arquivado/)).toBeInTheDocument());
  });
});
