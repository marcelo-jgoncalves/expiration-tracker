import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderAtRoute } from "../../testUtils.js";
import { RenewItem } from "../../../src/routes/items/RenewItem.js";
import type { ExpirationItem } from "../../../src/api/types.js";

const { getMock, postMock, navigateMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock("../../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, post: postMock },
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

function item(overrides: Partial<ExpirationItem>): ExpirationItem {
  return {
    itemId: "item-1",
    tenantId: "t1",
    name: "Apólice de Seguro",
    category: "Financeiro",
    dueDate: "2026-09-01T00:00:00.000Z",
    tags: [],
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 3,
    ...overrides,
  };
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  navigateMock.mockReset();
  window.sessionStorage.clear();
});

describe("RenewItem", () => {
  it("shows a persistent notice explaining renew creates a new cycle rather than editing (mission §37)", async () => {
    getMock.mockResolvedValue({ item: item({}) });
    renderAtRoute("/items/:itemId/renew", <RenewItem />, "/items/item-1/renew");

    await waitFor(() => expect(screen.getByText(/não é o mesmo que editar a data/)).toBeInTheDocument());
  });

  it("submits the renewal with the item's current version as If-Match and navigates to the new cycle", async () => {
    getMock.mockResolvedValue({ item: item({}) });
    postMock.mockResolvedValue({ item: { itemId: "item-2" } });
    renderAtRoute("/items/:itemId/renew", <RenewItem />, "/items/item-1/renew");

    await waitFor(() => expect(screen.getByLabelText(/Nova data de vencimento/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Nova data de vencimento/), { target: { value: "2027-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar renovação" }));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    const [path, body, options] = postMock.mock.calls[0] as [string, unknown, { expectedVersion?: number; idempotencyKey?: string }];
    expect(path).toBe("/items/item-1/renew");
    expect(body).toMatchObject({ newDueDate: "2027-09-01T00:00:00.000Z" });
    expect(options.expectedVersion).toBe(3);
    expect(options.idempotencyKey).toBeTruthy();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/items/item-2", { state: { justRenewed: true } }));
  });

  it("OCC conflict (409): shows the dedicated recovery notice, never a generic error, and blocks resubmission until Recarregar", async () => {
    const { ApiError } = await import("../../../src/api/errors.js");
    getMock.mockResolvedValue({ item: item({ version: 3 }) });
    postMock.mockRejectedValue(new ApiError({ code: "CONFLICT", category: "CONFLICT", message: "VERSION_CONFLICT", retryable: false }));
    renderAtRoute("/items/:itemId/renew", <RenewItem />, "/items/item-1/renew");

    await waitFor(() => expect(screen.getByLabelText(/Nova data de vencimento/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Nova data de vencimento/), { target: { value: "2027-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar renovação" }));

    await waitFor(() => expect(screen.getByText(/Este vencimento mudou desde que você o abriu/)).toBeInTheDocument());
    expect(screen.queryByText("VERSION_CONFLICT")).not.toBeInTheDocument(); // never the raw backend string
    expect(screen.getByRole("button", { name: "Confirmar renovação" })).toBeDisabled();
  });

  it("OCC recovery: clicking Recarregar refetches the item and re-enables submission with the fresh version", async () => {
    const { ApiError } = await import("../../../src/api/errors.js");
    getMock.mockResolvedValueOnce({ item: item({ version: 3 }) }).mockResolvedValue({ item: item({ version: 4 }) });
    postMock.mockRejectedValueOnce(new ApiError({ code: "CONFLICT", category: "CONFLICT", message: "VERSION_CONFLICT", retryable: false })).mockResolvedValueOnce({ item: { itemId: "item-2" } });
    renderAtRoute("/items/:itemId/renew", <RenewItem />, "/items/item-1/renew");

    await waitFor(() => expect(screen.getByLabelText(/Nova data de vencimento/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Nova data de vencimento/), { target: { value: "2027-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar renovação" }));
    await waitFor(() => expect(screen.getByText(/Este vencimento mudou/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    await waitFor(() => expect(screen.queryByText(/Este vencimento mudou/)).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Confirmar renovação" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar renovação" }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
    const secondCallOptions = postMock.mock.calls[1]?.[2] as { expectedVersion?: number };
    expect(secondCallOptions.expectedVersion).toBe(4); // the freshly-refetched version, not the stale 3
  });

  it("an UNKNOWN_OUTCOME failure tells the user to reload before retrying, rather than claiming failure", async () => {
    const { ApiError } = await import("../../../src/api/errors.js");
    getMock.mockResolvedValue({ item: item({}) });
    postMock.mockRejectedValue(ApiError.unknownOutcome(new Error("timeout")));
    renderAtRoute("/items/:itemId/renew", <RenewItem />, "/items/item-1/renew");

    await waitFor(() => expect(screen.getByLabelText(/Nova data de vencimento/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/Nova data de vencimento/), { target: { value: "2027-09-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar renovação" }));

    expect(await screen.findByText(/Não foi possível confirmar se esta renovação foi concluída/)).toBeInTheDocument();
  });
});
