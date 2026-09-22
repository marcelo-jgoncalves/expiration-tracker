import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ForgotPassword } from "../../../src/routes/auth/ForgotPassword.js";

const { forgotPasswordMock, navigateMock } = vi.hoisted(() => ({ forgotPasswordMock: vi.fn(), navigateMock: vi.fn() }));

vi.mock("../../../src/api/auth.js", () => ({
  login: vi.fn(),
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  resendConfirmationCode: vi.fn(),
  forgotPassword: forgotPasswordMock,
  confirmForgotPassword: vi.fn(),
}));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

function renderForgotPassword() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/forgot-password"]}>
        <Routes>
          <Route path="/forgot-password" element={<ForgotPassword />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  forgotPasswordMock.mockReset();
  navigateMock.mockReset();
});

describe("ForgotPassword", () => {
  it("shows the same generic confirmation whether or not the e-mail is registered (anti-enumeration, decision 3)", async () => {
    forgotPasswordMock.mockResolvedValue(undefined);
    renderForgotPassword();
    fireEvent.change(screen.getByLabelText(/E-mail/), { target: { value: "anyone@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar código" }));

    await waitFor(() => expect(forgotPasswordMock).toHaveBeenCalledWith({ email: "anyone@example.com" }));
    await waitFor(() => expect(screen.getByText(/Se o e-mail informado estiver cadastrado/)).toBeInTheDocument());
  });

  it("links to /reset-password carrying the e-mail forward", async () => {
    forgotPasswordMock.mockResolvedValue(undefined);
    renderForgotPassword();
    fireEvent.change(screen.getByLabelText(/E-mail/), { target: { value: "anyone@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar código" }));

    await waitFor(() => screen.getByRole("button", { name: "Já tenho o código" }));
    fireEvent.click(screen.getByRole("button", { name: "Já tenho o código" }));
    expect(navigateMock).toHaveBeenCalledWith("/reset-password?email=anyone%40example.com");
  });
});
