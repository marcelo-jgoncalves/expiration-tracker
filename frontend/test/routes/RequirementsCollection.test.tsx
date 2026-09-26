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
    // D-339 achado 1: o nome do requisito abria o FORNECEDOR (link), nunca o próprio requisito -
    // agora abre o mesmo destino do botão "Ver" (o link para o fornecedor mora no identificador
    // abaixo do nome, testado separadamente).
    await waitFor(() => expect(screen.getByRole("button", { name: "CND Federal" })).toBeInTheDocument());
  });

  it("the requirement name opens the requirement itself (not the subject) - D-339 achado 1", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.includes("/search?")) {
        return path.includes("status=MISSING") ? Promise.resolve({ items: [requirement()], cursor: null }) : Promise.resolve({ items: [], cursor: null });
      }
      if (path.includes("/document-requests")) return Promise.resolve({ documentRequests: [] });
      if (path.startsWith("/document-archive/requirements/")) return Promise.resolve({ requirements: [requirement()] });
      return Promise.resolve({ items: [], cursor: null });
    });
    renderAtRoute("/requirements", <RequirementsCollection />, "/requirements");

    await waitFor(() => expect(screen.getByRole("button", { name: "CND Federal" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "CND Federal" }));

    expect(await screen.findByRole("dialog", { name: "CND Federal" })).toBeInTheDocument();
    // The subject link still exists, just under the identifier, never the requirement's own name.
    expect(screen.getByRole("link", { name: "subject-1" })).toBeInTheDocument();
  });

  it("distinguishes NOT_APPLICABLE from MISSING with different labels", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.includes("status=NOT_APPLICABLE")) return Promise.resolve({ items: [requirement({ requirementId: "req-2", status: "NOT_APPLICABLE", name: "Comprovante" })], cursor: null });
      return Promise.resolve({ items: [], cursor: null });
    });
    renderAtRoute("/requirements", <RequirementsCollection />, "/requirements");
    // Marcelo 2026-09-22 (protótipo `expiration-tracker-requisitos-documentais.html`): the status
    // filter is now a metric tile whose accessible name is "label + count" ("Não se aplica 0"),
    // not the bare label - a regex match survives that without asserting the exact count.
    await waitFor(() => expect(screen.getByRole("button", { name: /Não se aplica/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Não se aplica/ }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Comprovante" })).toBeInTheDocument());
    // NOT_APPLICABLE renders as a distinct badge label from MISSING's ("Em falta") - never
    // collapsed into the same text, per the audit fix this screen implements.
    expect(screen.getAllByText("Não se aplica").length).toBeGreaterThanOrEqual(2); // filter tab + status badge
  });

  // Marcelo 2026-09-22: metric tiles show a REAL per-status count, always (not only while
  // "Todos" is active) - would fail if a tile fell back to "0" for a status that actually has
  // items, or if the count only appeared once its own tab were selected.
  it("shows a real count on each metric tile, independent of which tab is active", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.includes("status=MISSING")) return Promise.resolve({ items: [requirement(), requirement({ requirementId: "req-2" })], cursor: null });
      if (path.includes("status=PENDING")) return Promise.resolve({ items: [requirement({ requirementId: "req-3", status: "PENDING" })], cursor: null });
      return Promise.resolve({ items: [], cursor: null });
    });
    renderAtRoute("/requirements", <RequirementsCollection />, "/requirements");

    await waitFor(() => expect(screen.getByRole("button", { name: /Em falta/ })).toHaveTextContent("2"));
    expect(screen.getByRole("button", { name: /Pendente/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /^Todos/ })).toHaveTextContent("3");
  });

  it("the row 'Ver' action opens the RequirementDetail modal instead of navigating to a route", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.includes("/search?")) {
        return path.includes("status=MISSING") ? Promise.resolve({ items: [requirement()], cursor: null }) : Promise.resolve({ items: [], cursor: null });
      }
      if (path.includes("/document-requests")) return Promise.resolve({ documentRequests: [] });
      if (path.startsWith("/document-archive/requirements/")) return Promise.resolve({ requirements: [requirement()] });
      return Promise.resolve({ items: [], cursor: null });
    });
    renderAtRoute("/requirements", <RequirementsCollection />, "/requirements");

    await waitFor(() => expect(screen.getByRole("button", { name: "Ver" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Ver" }));

    expect(await screen.findByRole("dialog", { name: "CND Federal" })).toBeInTheDocument();
  });

  it("shows the EMPTY_TRUE state when the organization has no requirements at all", async () => {
    getMock.mockResolvedValue({ items: [], cursor: null });
    renderAtRoute("/requirements", <RequirementsCollection />, "/requirements");

    await waitFor(() => expect(screen.getByText("Nenhum requisito cadastrado ainda.")).toBeInTheDocument());
  });

  // Item 37 (novo protótipo+spec de detalhe de fornecedor, spec §3/§6): dentro do hub de um
  // fornecedor específico (`nested`, via `:subjectId` na rota), "Requisitos (N)" precisa
  // continuar mostrando o TOTAL sem busca mesmo depois de digitar na busca - a spec é explícita:
  // "a busca... não muda... o total global". Mutação: usar `requirements.length` (já filtrado)
  // em vez de `subjectTotalCount` na anotação da seção faria esta asserção falhar (o "(2)" viraria
  // "(1)" assim que a busca filtrasse para 1 resultado).
  it("nested inside a subject's hub, 'Requisitos (N)' stays the unfiltered total while searching, with a separate match count", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.startsWith("/document-archive/requirements/")) {
        return Promise.resolve({ requirements: [requirement({ requirementId: "req-1", name: "CND Federal" }), requirement({ requirementId: "req-2", name: "Alvará Municipal" })] });
      }
      return Promise.resolve({ items: [], cursor: null });
    });
    renderAtRoute("/subjects/:subjectId", <RequirementsCollection />, "/subjects/subject-1");

    await waitFor(() => expect(screen.getByRole("heading", { name: "Requisitos (2)" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Buscar por nome do requisito/), { target: { value: "Alvará" } });

    await waitFor(() => expect(screen.getByText("1 resultado para \"Alvará\"")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Requisitos (2)" })).toBeInTheDocument(); // total never changed
    expect(screen.queryByRole("button", { name: "CND Federal" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alvará Municipal" })).toBeInTheDocument();
  });
});
