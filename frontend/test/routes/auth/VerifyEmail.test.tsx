import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { VerifyEmail } from "../../../src/routes/auth/VerifyEmail.js";

const { confirmSignUpMock, resendConfirmationCodeMock, navigateMock } = vi.hoisted(() => ({
  confirmSignUpMock: vi.fn(),
  resendConfirmationCodeMock: vi.fn(),
  navigateMock: vi.fn(),
}));

vi.mock("../../../src/api/auth.js", () => ({
  login: vi.fn(),
  signUp: vi.fn(),
  confirmSignUp: confirmSignUpMock,
  resendConfirmationCode: resendConfirmationCodeMock,
  forgotPassword: vi.fn(),
  confirmForgotPassword: vi.fn(),
}));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

function renderVerifyEmail(initialEntry = "/verify-email?email=new%40example.com") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/verify-email" element={<VerifyEmail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  confirmSignUpMock.mockReset();
  resendConfirmationCodeMock.mockReset();
  navigateMock.mockReset();
});

describe("VerifyEmail", () => {
  it("pre-fills the e-mail from the query string", () => {
    renderVerifyEmail();
    expect(screen.getByLabelText(/E-mail/)).toHaveValue("new@example.com");
  });

  it("confirms and navigates to /login on success", async () => {
    confirmSignUpMock.mockResolvedValue(undefined);
    renderVerifyEmail();
    fireEvent.change(screen.getByLabelText(/Código de confirmação/), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(confirmSignUpMock).toHaveBeenCalledWith({ email: "new@example.com", confirmationCode: "123456" }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/login?returnTo=%2Foverview", { replace: true }));
  });

  it("shows an error on an invalid/expired code", async () => {
    confirmSignUpMock.mockRejectedValue(new Error("invalid"));
    renderVerifyEmail();
    fireEvent.change(screen.getByLabelText(/Código de confirmação/), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() => expect(screen.getByText("Código inválido ou expirado.")).toBeInTheDocument());
  });

  it("resends the code and shows a confirmation notice, without exposing whether the e-mail exists", async () => {
    resendConfirmationCodeMock.mockResolvedValue(undefined);
    renderVerifyEmail();
    fireEvent.click(screen.getByRole("button", { name: "Reenviar código" }));

    await waitFor(() => expect(resendConfirmationCodeMock).toHaveBeenCalledWith({ email: "new@example.com" }));
    await waitFor(() => expect(screen.getByText(/Se o e-mail estiver registrado/)).toBeInTheDocument());
  });
});
