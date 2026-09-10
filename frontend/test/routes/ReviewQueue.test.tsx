import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderAtRoute, TEST_ORGANIZATION_ID } from "../testUtils.js";
import { ReviewQueue } from "../../src/routes/ReviewQueue.js";
import type { ReviewQueueHit } from "../../src/api/types.js";

const { getMock, postMock, requestMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn(), requestMock: vi.fn() }));
vi.mock("../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, post: postMock, request: requestMock },
}));

/** Same `useCurrentMembershipRole()` mocking discipline as
 * `test/routes/document-types/DocumentTypesCollection.test.tsx` - it resolves via a direct
 * `fetch("/bff/organizations", ...)`, not `apiClient`. */
function mockRole(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ organizations: [{ organizationId: TEST_ORGANIZATION_ID, displayName: "Acme", role, version: 1 }] }),
    }),
  );
}

function hit(overrides: Partial<ReviewQueueHit["version"]> = {}, doc: Partial<NonNullable<ReviewQueueHit["document"]>> = {}): ReviewQueueHit {
  return {
    version: {
      documentId: "doc-1",
      seq: 1,
      versionId: "ver-1",
      state: "RECEIVED",
      origin: "MANUAL_UPLOAD",
      receivedAt: "2026-09-09T08:12:00.000Z",
      pendingFileScans: 0,
      infectedFileScans: 0,
      createdAt: "2026-09-09T08:12:00.000Z",
      updatedAt: "2026-09-09T08:12:00.000Z",
      version: 1,
      ...overrides,
    },
    document: { documentId: "doc-1", subjectId: "subj-1", documentTypeId: "dt-1", ...doc },
  };
}

function mockReviews(received: ReviewQueueHit[], underReview: ReviewQueueHit[] = []) {
  getMock.mockImplementation((path: string) => {
    if (path.includes("state=RECEIVED")) return Promise.resolve({ items: received, cursor: null });
    if (path.includes("state=UNDER_REVIEW")) return Promise.resolve({ items: underReview, cursor: null });
    return Promise.resolve({ items: [], cursor: null });
  });
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  requestMock.mockReset();
  vi.unstubAllGlobals();
});

describe("ReviewQueue (A13)", () => {
  it("shows initial loading, then lists RECEIVED items with the default tab selected", async () => {
    mockRole("MEMBER");
    mockReviews([hit()]);
    renderAtRoute("/reviews", <ReviewQueue />, "/reviews");

    expect(screen.getByText("Carregando fila…")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Fila de revisão" })).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByText("doc-1").length).toBeGreaterThan(0));
  });

  it("shows the EMPTY_TRUE state when a tab's queue is empty", async () => {
    mockRole("VIEWER");
    mockReviews([]);
    renderAtRoute("/reviews", <ReviewQueue />, "/reviews");
    await waitFor(() => expect(screen.getAllByText("Nenhum item nesta fila.").length).toBeGreaterThan(0));
  });

  it("VIEWER sees the queue and detail but no action bar (Reivindicar/Aceitar/Rejeitar)", async () => {
    mockRole("VIEWER");
    mockReviews([hit()]);
    renderAtRoute("/reviews", <ReviewQueue />, "/reviews");
    await waitFor(() => expect(screen.getAllByText("doc-1").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: "Reivindicar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aceitar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rejeitar" })).not.toBeInTheDocument();
  });

  it("a MEMBER sees no action bar on an item claimed by another reviewer (docarchive:review + assertReviewerOrAdmin)", async () => {
    mockRole("MEMBER");
    mockReviews([], [hit({ state: "UNDER_REVIEW", reviewerId: "user-other" })]);
    renderAtRoute("/reviews", <ReviewQueue />, "/reviews");
    fireEvent.click(await screen.findByRole("button", { name: /Em revisão/ }));
    await waitFor(() => expect(screen.getAllByText("doc-1").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "doc-1" }));
    await waitFor(() => expect(screen.getByText(/Reivindicado por/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Aceitar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rejeitar" })).not.toBeInTheDocument();
  });

  it("RBAC bypass: an OWNER/ADMIN's action bar stays visible on an item claimed by another reviewer", async () => {
    mockRole("ADMIN");
    mockReviews([], [hit({ state: "UNDER_REVIEW", reviewerId: "user-other" })]);
    renderAtRoute("/reviews", <ReviewQueue />, "/reviews");
    fireEvent.click(await screen.findByRole("button", { name: /Em revisão/ }));
    await waitFor(() => expect(screen.getAllByText("doc-1").length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "doc-1" }));
    // Ownership info is still shown, but the action bar (Aceitar/Rejeitar) is NEVER hidden for
    // an OWNER/ADMIN, per `assertReviewerOrAdmin` (`document-archive-service.ts:2710`).
    await waitFor(() => expect(screen.getByRole("button", { name: "Aceitar" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Rejeitar" })).toBeInTheDocument();
    expect(screen.getByText(/você pode decidir mesmo assim/)).toBeInTheDocument();
  });

  it("a MEMBER can act on an unclaimed item (Reivindicar visible, Aceitar/Rejeitar visible)", async () => {
    mockRole("MEMBER");
    mockReviews([hit()]);
    renderAtRoute("/reviews", <ReviewQueue />, "/reviews");
    await waitFor(() => expect(screen.getByRole("button", { name: "Reivindicar" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Aceitar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rejeitar" })).toBeInTheDocument();
  });

  it("disables Aceitar while a file scan is pending, with an explanation notice, and never hides it", async () => {
    mockRole("MEMBER");
    mockReviews([hit({ pendingFileScans: 1 })]);
    renderAtRoute("/reviews", <ReviewQueue />, "/reviews");
    await waitFor(() => expect(screen.getByRole("button", { name: "Aceitar" })).toBeDisabled());
    expect(screen.getByText(/Verificando segurança/)).toBeInTheDocument();
  });

  it("hides Aceitar (keeps Rejeitar) when a file scan is infected", async () => {
    mockRole("MEMBER");
    mockReviews([hit({ infectedFileScans: 1 })]);
    renderAtRoute("/reviews", <ReviewQueue />, "/reviews");
    await waitFor(() => expect(screen.getByRole("button", { name: "Rejeitar" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Aceitar" })).not.toBeInTheDocument();
    expect(screen.getByText(/Arquivo infectado/)).toBeInTheDocument();
  });

  it("Reivindicar calls POST .../claim with the expected OCC version", async () => {
    mockRole("MEMBER");
    mockReviews([hit()]);
    postMock.mockResolvedValue({ version: { ...hit().version, state: "UNDER_REVIEW", reviewerId: "me", version: 2 } });
    renderAtRoute("/reviews", <ReviewQueue />, "/reviews");
    await waitFor(() => expect(screen.getByRole("button", { name: "Reivindicar" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Reivindicar" }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/document-archive/documents/doc-1/versions/1/claim", { expectedVersion: 1 }, { expectedVersion: 1 }));
  });

  it("Rejeitar opens a closed-set reason form and calls POST .../reject with the chosen reason", async () => {
    mockRole("MEMBER");
    mockReviews([hit()]);
    postMock.mockResolvedValue({ version: { ...hit().version, state: "REJECTED", version: 2 } });
    renderAtRoute("/reviews", <ReviewQueue />, "/reviews");
    await waitFor(() => expect(screen.getByRole("button", { name: "Rejeitar" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Rejeitar" }));
    fireEvent.change(screen.getByLabelText(/Motivo da rejeição/), { target: { value: "OTHER" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar rejeição" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/document-archive/documents/doc-1/versions/1/reject", { expectedVersion: 1, reason: "OTHER" }, { expectedVersion: 1 }),
    );
  });
});
