import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderAtRoute } from "../../testUtils.js";
import { SubjectDetail } from "../../../src/routes/subjects/SubjectDetail.js";
import type { TrackedSubject, RequirementAssignment, DocumentSubmission } from "../../../src/api/types.js";

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));
vi.mock("../../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, post: postMock },
}));

function subject(overrides: Partial<TrackedSubject> = {}): TrackedSubject {
  return {
    subjectId: "subject-1",
    tenantId: "t1",
    type: "VENDOR",
    displayName: "ACME Ltda",
    tags: [],
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function assignment(overrides: Partial<RequirementAssignment> = {}): RequirementAssignment {
  return {
    assignmentId: "assignment-1",
    subjectId: "subject-1",
    tenantId: "t1",
    requirementName: "Seguro RC",
    status: "MISSING",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function submission(overrides: Partial<DocumentSubmission> = {}): DocumentSubmission {
  return {
    submissionId: "submission-1",
    subjectId: "subject-1",
    assignmentId: "assignment-1",
    documentRequestId: "request-1",
    fileName: "apolice.pdf",
    status: "CLEAN",
    createdAt: "2026-01-02T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function mockGet(overrides: { assignments?: RequirementAssignment[]; submissions?: DocumentSubmission[] } = {}) {
  getMock.mockImplementation((path: string) => {
    if (path.includes("/submissions")) return Promise.resolve({ submissions: overrides.submissions ?? [submission({})] });
    if (path.includes("/requirements")) return Promise.resolve({ assignments: overrides.assignments ?? [assignment({})] });
    return Promise.resolve({ subject: subject({}) });
  });
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
});

describe("SubjectDetail (BLOCKER-C review queue)", () => {
  it("shows the subject and its requirement assignments with status labels", async () => {
    mockGet();
    renderAtRoute("/subjects/:subjectId", <SubjectDetail />, "/subjects/subject-1");

    await waitFor(() => expect(screen.getByRole("heading", { name: "ACME Ltda" })).toBeInTheDocument());
    expect(screen.getByText("Seguro RC")).toBeInTheDocument();
    expect(screen.getByText("[Faltando]")).toBeInTheDocument();
  });

  it("expanding a reviewable requirement loads and shows its submissions", async () => {
    mockGet();
    renderAtRoute("/subjects/:subjectId", <SubjectDetail />, "/subjects/subject-1");
    await waitFor(() => expect(screen.getByRole("button", { name: "Revisar" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));

    await waitFor(() => expect(screen.getByText(/apolice\.pdf/)).toBeInTheDocument());
    expect(screen.getByText(/Verificado \(segurança\)/)).toBeInTheDocument();
  });

  it("shows a true-empty message when a reviewed requirement has no submissions yet", async () => {
    mockGet({ submissions: [] });
    renderAtRoute("/subjects/:subjectId", <SubjectDetail />, "/subjects/subject-1");
    await waitFor(() => expect(screen.getByRole("button", { name: "Revisar" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));

    await waitFor(() => expect(screen.getByText("Nenhum documento enviado ainda para este requisito.")).toBeInTheDocument());
  });

  it("linking an item posts to the link route with the assignment's current version as If-Match", async () => {
    mockGet();
    postMock.mockResolvedValue({ assignment: assignment({ status: "SATISFIED", linkedItemId: "item-9", version: 2 }) });
    renderAtRoute("/subjects/:subjectId", <SubjectDetail />, "/subjects/subject-1");
    await waitFor(() => expect(screen.getByRole("button", { name: "Revisar" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    await waitFor(() => expect(screen.getByLabelText(/ID do vencimento/)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/ID do vencimento/), { target: { value: "item-9" } });
    fireEvent.click(screen.getByRole("button", { name: "Vincular" }));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    const [path, body, options] = postMock.mock.calls[0] as [string, unknown, { expectedVersion?: number }];
    expect(path).toBe("/subjects/subject-1/requirements/assignment-1/link");
    expect(body).toEqual({ itemId: "item-9" });
    expect(options.expectedVersion).toBe(1);
  });

  it("shows a validation error when submitting the link form without an itemId", async () => {
    mockGet();
    renderAtRoute("/subjects/:subjectId", <SubjectDetail />, "/subjects/subject-1");
    await waitFor(() => expect(screen.getByRole("button", { name: "Revisar" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Vincular" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Vincular" }));

    expect(screen.getByText("Informe o ID do vencimento a vincular.")).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("an already-SATISFIED requirement shows its linked item and an Unlink action instead of Revisar", async () => {
    mockGet({ assignments: [assignment({ status: "SATISFIED", linkedItemId: "item-9" })] });
    renderAtRoute("/subjects/:subjectId", <SubjectDetail />, "/subjects/subject-1");

    await waitFor(() => expect(screen.getByText("item-9")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Desvincular" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revisar" })).not.toBeInTheDocument();
  });

  it("unlinking posts to the unlink route with the assignment's current version", async () => {
    mockGet({ assignments: [assignment({ status: "SATISFIED", linkedItemId: "item-9" })] });
    postMock.mockResolvedValue({ assignment: assignment({}) });
    renderAtRoute("/subjects/:subjectId", <SubjectDetail />, "/subjects/subject-1");
    await waitFor(() => expect(screen.getByRole("button", { name: "Desvincular" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Desvincular" }));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    const [path, , options] = postMock.mock.calls[0] as [string, unknown, { expectedVersion?: number }];
    expect(path).toBe("/subjects/subject-1/requirements/assignment-1/unlink");
    expect(options.expectedVersion).toBe(1);
  });
});
