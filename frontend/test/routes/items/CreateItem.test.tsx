import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderAtRoute } from "../../testUtils.js";
import { CreateItem } from "../../../src/routes/items/CreateItem.js";

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

function fillMinimalValidForm() {
  fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: "Alvará" } });
  fireEvent.change(screen.getByLabelText(/^Categoria/), { target: { value: "Licenças" } });
  fireEvent.change(screen.getByLabelText(/Data de vencimento/), { target: { value: "2026-09-10" } });
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  navigateMock.mockReset();
  window.sessionStorage.clear();
});

describe("CreateItem", () => {
  it("blocks submission with field-level errors when required fields are missing, without calling the backend", async () => {
    renderAtRoute("/items/new", <CreateItem />, "/items/new");
    fireEvent.click(screen.getByRole("button", { name: "Criar vencimento" }));

    expect(await screen.findByText("Informe um nome.")).toBeInTheDocument();
    expect(screen.getByText("Informe uma categoria.")).toBeInTheDocument();
    expect(screen.getByText("Informe a data de vencimento.")).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("preserves entered values across a validation error - nothing is cleared", async () => {
    renderAtRoute("/items/new", <CreateItem />, "/items/new");
    fireEvent.change(screen.getByLabelText(/^Nome/), { target: { value: "Alvará parcial" } });
    fireEvent.click(screen.getByRole("button", { name: "Criar vencimento" }));

    await screen.findByText("Informe uma categoria.");
    expect(screen.getByLabelText(/^Nome/)).toHaveValue("Alvará parcial");
  });

  it("submits with an Idempotency-Key and navigates to the new item's detail page on success", async () => {
    postMock.mockResolvedValue({ item: { itemId: "item-99" } });
    renderAtRoute("/items/new", <CreateItem />, "/items/new");
    fillMinimalValidForm();

    fireEvent.click(screen.getByRole("button", { name: "Criar vencimento" }));

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    const [path, body, options] = postMock.mock.calls[0] as [string, unknown, { idempotencyKey?: string }];
    expect(path).toBe("/items");
    expect(body).toMatchObject({ name: "Alvará", category: "Licenças", dueDate: "2026-09-10T00:00:00.000Z" });
    expect(options.idempotencyKey).toBeTruthy();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/items/item-99", { state: { justCreated: true } }));
  });

  it("maps a VALIDATION error from the backend to field-specific messages, preserving entered values", async () => {
    const { ApiError } = await import("../../../src/api/errors.js");
    postMock.mockRejectedValue(
      new ApiError({ code: "VALIDATION_FAILED", category: "VALIDATION", message: "Request body failed schema validation.", retryable: false, details: { errors: ["/name must NOT have fewer than 1 characters"] } }),
    );
    renderAtRoute("/items/new", <CreateItem />, "/items/new");
    fillMinimalValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Criar vencimento" }));

    expect(await screen.findByText("must NOT have fewer than 1 characters")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Categoria/)).toHaveValue("Licenças");
  });

  it("shows an honest unknown-outcome message (not a false failure) when the request times out ambiguously", async () => {
    const { ApiError } = await import("../../../src/api/errors.js");
    postMock.mockRejectedValue(ApiError.unknownOutcome(new Error("timeout")));
    renderAtRoute("/items/new", <CreateItem />, "/items/new");
    fillMinimalValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Criar vencimento" }));

    expect(await screen.findByText(/Não foi possível confirmar se este vencimento foi criado/)).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("a retry of the same failed submission (no field changes) reuses the exact same Idempotency-Key", async () => {
    const { ApiError } = await import("../../../src/api/errors.js");
    postMock.mockRejectedValueOnce(ApiError.network(new Error("offline"))).mockResolvedValueOnce({ item: { itemId: "item-1" } });
    renderAtRoute("/items/new", <CreateItem />, "/items/new");
    fillMinimalValidForm();

    fireEvent.click(screen.getByRole("button", { name: "Criar vencimento" }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Criar vencimento" }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));

    const firstKey = (postMock.mock.calls[0]?.[2] as { idempotencyKey?: string }).idempotencyKey;
    const secondKey = (postMock.mock.calls[1]?.[2] as { idempotencyKey?: string }).idempotencyKey;
    expect(secondKey).toBe(firstKey);
  });

  it("session-interruption recovery: a remount (simulating the BFF reauth full-page round trip) rehydrates the draft AND reuses the same Idempotency-Key (mission §49)", async () => {
    postMock.mockImplementation(() => new Promise(() => {})); // never resolves - we only care about the request that goes out
    const first = renderAtRoute("/items/new", <CreateItem />, "/items/new");
    fillMinimalValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Criar vencimento" }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    const keyBeforeReload = (postMock.mock.calls[0]?.[2] as { idempotencyKey?: string }).idempotencyKey;
    first.unmount(); // simulates the full-page navigation away (BFF login) and back

    renderAtRoute("/items/new", <CreateItem />, "/items/new");
    expect(screen.getByLabelText(/^Nome/)).toHaveValue("Alvará");
    expect(screen.getByLabelText(/^Categoria/)).toHaveValue("Licenças");

    fireEvent.click(screen.getByRole("button", { name: "Criar vencimento" }));
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2));
    const keyAfterReload = (postMock.mock.calls[1]?.[2] as { idempotencyKey?: string }).idempotencyKey;
    expect(keyAfterReload).toBe(keyBeforeReload);
  });

  it("prevents a double-submit: the submit button is disabled while the request is in flight", async () => {
    let resolvePost: (value: unknown) => void = () => {};
    postMock.mockImplementation(() => new Promise((resolve) => (resolvePost = resolve)));
    renderAtRoute("/items/new", <CreateItem />, "/items/new");
    fillMinimalValidForm();

    fireEvent.click(screen.getByRole("button", { name: "Criar vencimento" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Criando…" })).toBeDisabled());

    resolvePost({ item: { itemId: "item-1" } });
    expect(postMock).toHaveBeenCalledTimes(1);
  });
});
