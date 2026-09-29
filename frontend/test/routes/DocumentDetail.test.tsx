import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent, within } from "@testing-library/react";
import { renderAtRoute } from "../testUtils.js";
import { DocumentDetail } from "../../src/routes/DocumentDetail.js";
import { ApiError } from "../../src/api/errors.js";
import type { DocumentArchiveDocument, DocumentArchiveVersion, MembershipRole } from "../../src/api/types.js";

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));
vi.mock("../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, post: postMock },
}));

const { fetchOrganizationsMock } = vi.hoisted(() => ({ fetchOrganizationsMock: vi.fn() }));
vi.mock("../../src/api/organizations.js", () => ({
  fetchOrganizations: fetchOrganizationsMock,
  selectOrganization: vi.fn(),
}));

function document(overrides: Partial<DocumentArchiveDocument>): DocumentArchiveDocument {
  return {
    documentId: "doc-1",
    subjectId: "subject-1",
    documentTypeId: "apolice-seguro",
    status: "ACTIVE",
    hasValidity: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function version(overrides: Partial<DocumentArchiveVersion>): DocumentArchiveVersion {
  return {
    documentId: "doc-1",
    seq: 1,
    versionId: "v1",
    state: "RECEIVED",
    origin: "MANUAL_UPLOAD",
    pendingFileScans: 0,
    infectedFileScans: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 5,
    ...overrides,
  };
}

const pendingDisclosure = {
  disclosure: {
    runId: "run-1",
    runStatus: "COMPLETED",
    runVersion: 2,
    fields: [
      {
        fieldName: "expirationDate",
        valueType: "DATE",
        candidateValue: "2027-03-31",
        confidence: 0.9,
        sources: ["DETERMINISTIC_PARSER"],
        agreement: "SINGLE_SOURCE",
        state: "PENDING_CONFIRMATION",
        version: 3,
      },
    ],
  },
};

function mockAsRole(role: MembershipRole) {
  fetchOrganizationsMock.mockResolvedValue({ organizations: [{ organizationId: "org-1", displayName: "Acme", role, version: 1 }] });
}

function mockDocumentWithPendingField() {
  getMock.mockImplementation((path: string) => {
    if (path === "/document-archive/documents/doc-1") return Promise.resolve({ document: document({}) });
    if (path === "/document-archive/documents/doc-1/versions") return Promise.resolve({ versions: [version({})] });
    if (path === "/document-archive/documents/doc-1/versions/1/extractions") return Promise.resolve(pendingDisclosure);
    return Promise.reject(new Error("unexpected path " + path));
  });
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  fetchOrganizationsMock.mockReset();
});

describe("DocumentDetail (A12) - D-349 confirm/reject a suggested extracted field", () => {
  it("VIEWER never sees Confirmar/Rejeitar (extraction:confirm is WRITE_ROLES, not READ_ONLY_ROLES)", async () => {
    mockDocumentWithPendingField();
    mockAsRole("VIEWER");
    renderAtRoute("/documents/:documentId", <DocumentDetail />, "/documents/doc-1");

    await waitFor(() => expect(screen.getByText("2027-03-31")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Confirmar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rejeitar" })).not.toBeInTheDocument();
  });

  it("MEMBER confirms a pending field, sending the DocumentVersion/run/field OCC versions (no expectedItemVersion - A12 has no ExpirationItem)", async () => {
    mockDocumentWithPendingField();
    postMock.mockResolvedValue({ field: { fieldName: "expirationDate", state: "CONFIRMED" } });
    mockAsRole("MEMBER");
    renderAtRoute("/documents/:documentId", <DocumentDetail />, "/documents/doc-1");

    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/document-archive/documents/doc-1/versions/1/extractions/run-1/fields/expirationDate/confirm",
        { expectedDocumentVersionVersion: 5, expectedRunVersion: 2, expectedFieldVersion: 3, confirmedValue: "2027-03-31" },
        { idempotencyKey: expect.any(String) },
      ),
    );
  });

  it("MEMBER rejects a pending field - the route still carries /versions/{seq}/ even though reject never touches DocumentVersion", async () => {
    mockDocumentWithPendingField();
    postMock.mockResolvedValue({ field: { fieldName: "expirationDate", state: "REJECTED" } });
    mockAsRole("MEMBER");
    renderAtRoute("/documents/:documentId", <DocumentDetail />, "/documents/doc-1");

    await waitFor(() => expect(screen.getByText("2027-03-31")).toBeInTheDocument());
    // Both the extraction row and the version's own review action bar render a "Rejeitar" button
    // with the identical accessible name - scoped to the disclosure list to avoid the ambiguity.
    const disclosureList = screen.getByRole("list", { name: "Sugestões extraídas automaticamente" });
    fireEvent.click(within(disclosureList).getByRole("button", { name: "Rejeitar" }));
    fireEvent.click(within(disclosureList).getByRole("button", { name: "Confirmar rejeição" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/document-archive/documents/doc-1/versions/1/extractions/run-1/fields/expirationDate/reject",
        { expectedRunVersion: 2, expectedFieldVersion: 3, correctionReason: undefined },
        { idempotencyKey: expect.any(String) },
      ),
    );
  });

  it("a conflicting confirm is surfaced as a visible error, never silently ignored", async () => {
    mockDocumentWithPendingField();
    postMock.mockRejectedValue(new ApiError({ code: "CONFLICT", category: "CONFLICT", message: "stale", retryable: false }));
    mockAsRole("MEMBER");
    renderAtRoute("/documents/:documentId", <DocumentDetail />, "/documents/doc-1");

    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmar" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("A versão do documento ou a extração mudaram"));
  });
});
