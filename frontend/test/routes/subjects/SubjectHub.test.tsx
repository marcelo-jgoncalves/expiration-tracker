import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderAtRoute } from "../../testUtils.js";
import { SubjectHub } from "../../../src/routes/subjects/SubjectHub.js";
import type { TrackedSubject } from "../../../src/api/types.js";

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock("../../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, post: vi.fn() },
}));

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
  getMock.mockImplementation((path: string) => {
    if (path.includes("/compliance")) {
      return Promise.resolve({ compliance: { totalRequirements: 2, satisfiedCount: 1, expiringSoonCount: 0, missingCount: 1, compliancePercent: 50 } });
    }
    if (path.startsWith("/document-archive/requirements/")) {
      return Promise.resolve({ requirements: [] });
    }
    // A10 (Block 7, D-267) - `RequirementAssignment` list (subject module), distinct from
    // `/document-archive/requirements/` above - must be matched BEFORE the generic
    // "/subjects/" fallback below, which would otherwise wrongly answer it with a Subject.
    if (path.includes("/requirements")) {
      return Promise.resolve({ assignments: [] });
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

  it("A10 (Block 7): renders 'Rastreamento legado' as a real link with the assignment count, not 'Em breve' text", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.includes("/compliance")) return Promise.resolve({ compliance: { totalRequirements: 2, satisfiedCount: 1, expiringSoonCount: 0, missingCount: 1, compliancePercent: 50 } });
      if (path.startsWith("/document-archive/requirements/")) return Promise.resolve({ requirements: [] });
      if (path.includes("/requirements")) return Promise.resolve({ assignments: [{ assignmentId: "a1" }, { assignmentId: "a2" }] });
      return Promise.resolve({ subject: subject() });
    });
    renderAtRoute("/subjects/:subjectId", <SubjectHub />, "/subjects/subject-1");

    const link = await screen.findByRole("link", { name: /Rastreamento legado/ });
    expect(link).toHaveAttribute("href", expect.stringContaining("/subjects/subject-1/tracking"));
    expect(within(link).getByText("2")).toBeInTheDocument();
  });

  it("shows '—' (never 0%) when totalRequirements is 0", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.includes("/compliance")) {
        return Promise.resolve({ compliance: { totalRequirements: 0, satisfiedCount: 0, expiringSoonCount: 0, missingCount: 0, compliancePercent: null } });
      }
      if (path.startsWith("/document-archive/requirements/")) return Promise.resolve({ requirements: [] });
      if (path.includes("/requirements")) return Promise.resolve({ assignments: [] });
      return Promise.resolve({ subject: subject() });
    });
    renderAtRoute("/subjects/:subjectId", <SubjectHub />, "/subjects/subject-1");

    await waitFor(() => expect(screen.getByText("0 de 0 requisitos satisfeitos")).toBeInTheDocument());
    // Scoped to the compliance panel's percentage element - the page also renders an em dash
    // elsewhere too (e.g. "Solicitações e recorrência — Em breve...").
    const section = screen.getByRole("heading", { name: "Conformidade" }).closest("section");
    expect(section?.querySelector("strong")?.textContent).toBe("—");
  });

  it("shows the archived InlineNotice for an ARCHIVED subject", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.includes("/compliance")) return Promise.resolve({ compliance: { totalRequirements: 0, satisfiedCount: 0, expiringSoonCount: 0, missingCount: 0, compliancePercent: null } });
      if (path.startsWith("/document-archive/requirements/")) return Promise.resolve({ requirements: [] });
      if (path.includes("/requirements")) return Promise.resolve({ assignments: [] });
      return Promise.resolve({ subject: subject({ status: "ARCHIVED" }) });
    });
    renderAtRoute("/subjects/:subjectId", <SubjectHub />, "/subjects/subject-1");

    await waitFor(() => expect(screen.getByText(/Este fornecedor está arquivado/)).toBeInTheDocument());
  });
});
