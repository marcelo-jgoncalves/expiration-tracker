import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderAtRoute } from "../testUtils.js";
import { RequirementsCollection } from "../../src/routes/RequirementsCollection.js";
import type { Requirement } from "../../src/api/types.js";

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock("../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, post: vi.fn(), request: vi.fn() },
}));

function requirement(overrides: Partial<Requirement> = {}): Requirement {
  return {
    requirementId: "req-1",
    subjectId: "subject-1",
    name: "CND Federal",
    applicability: "APPLICABLE",
    status: "MISSING",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  getMock.mockReset();
});

describe("RequirementsCollection (A11)", () => {
  it("shows initial loading, then lists MISSING requirements by default", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.includes("status=MISSING")) return Promise.resolve({ items: [requirement()], cursor: null });
      return Promise.resolve({ items: [], cursor: null });
    });
    renderAtRoute("/requirements", <RequirementsCollection />, "/requirements");

    expect(screen.getByText("Carregando requisitos…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("link", { name: "CND Federal" })).toBeInTheDocument());
  });

  it("distinguishes NOT_APPLICABLE from MISSING with different labels", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.includes("status=NOT_APPLICABLE")) return Promise.resolve({ items: [requirement({ requirementId: "req-2", status: "NOT_APPLICABLE", name: "Comprovante" })], cursor: null });
      return Promise.resolve({ items: [], cursor: null });
    });
    renderAtRoute("/requirements", <RequirementsCollection />, "/requirements");
    await waitFor(() => expect(screen.getByRole("button", { name: "Não se aplica" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Não se aplica" }));

    await waitFor(() => expect(screen.getByRole("link", { name: "Comprovante" })).toBeInTheDocument());
    // NOT_APPLICABLE renders as a distinct badge label from MISSING's ("Em falta") - never
    // collapsed into the same text, per the audit fix this screen implements.
    expect(screen.getAllByText("Não se aplica").length).toBeGreaterThanOrEqual(2); // filter tab + status badge
  });

  it("shows the EMPTY_TRUE state when the organization has no requirements at all", async () => {
    getMock.mockResolvedValue({ items: [], cursor: null });
    renderAtRoute("/requirements", <RequirementsCollection />, "/requirements");

    await waitFor(() => expect(screen.getByText("Nenhum requisito cadastrado ainda.")).toBeInTheDocument());
  });
});
