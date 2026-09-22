import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ResetPassword } from "../../../src/routes/auth/ResetPassword.js";

const { confirmForgotPasswordMock, navigateMock } = vi.hoisted(() => ({ confirmForgotPasswordMock: vi.fn(), navigateMock: vi.fn() }));

vi.mock("../../../src/api/auth.js", () => ({
  login: vi.fn(),
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  resendConfirmationCode: vi.fn(),
  forgotPassword: vi.fn(),
  confirmForgotPassword: confirmForgotPasswordMock,
}));
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

function renderResetPassword(initialEntry = "/reset-password?email=user%40example.com") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/reset-password" element={<ResetPassword />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  confirmForgotPasswordMock.mockReset();
  navigateMock.mockReset();
});

describe("ResetPassword", () => {
  it("blocks submission client-side when the passwords don't match, never calling the API", () => {
    renderResetPassword();
    fireEvent.change(screen.getByLabelText(/Código de confirmação/), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText(/^Nova senha/), { target: { value: "Correct-Horse-1" } });
    fireEvent.change(screen.getByLabelText(/Confirmar nova senha/), { target: { value: "different" } });
    fireEvent.click(screen.getByRole("button", { name: "Redefinir senha" }));

    expect(screen.getByText("As senhas não coincidem.")).toBeInTheDocument();
    expect(confirmForgotPasswordMock).not.toHaveBeenCalled();
  });

  it("submits and navigates to /login on success", async () => {
    confirmForgotPasswordMock.mockResolvedValue(undefined);
    renderResetPassword();
    fireEvent.change(screen.getByLabelText(/Código de confirmação/), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText(/^Nova senha/), { target: { value: "Correct-Horse-1" } });
    fireEvent.change(screen.getByLabelText(/Confirmar nova senha/), { target: { value: "Correct-Horse-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Redefinir senha" }));

    await waitFor(() =>
      expect(confirmForgotPasswordMock).toHaveBeenCalledWith({ email: "user@example.com", confirmationCode: "123456", newPassword: "Correct-Horse-1" }),
    );
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/login?returnTo=%2Foverview", { replace: true }));
  });

  it("shows an error on an invalid/expired code or a password that fails Cognito's policy", async () => {
    confirmForgotPasswordMock.mockRejectedValue(new Error("invalid"));
    renderResetPassword();
    fireEvent.change(screen.getByLabelText(/Código de confirmação/), { target: { value: "000000" } });
    fireEvent.change(screen.getByLabelText(/^Nova senha/), { target: { value: "weak" } });
    fireEvent.change(screen.getByLabelText(/Confirmar nova senha/), { target: { value: "weak" } });
    fireEvent.click(screen.getByRole("button", { name: "Redefinir senha" }));

    await waitFor(() => expect(screen.getByText(/Código inválido\/expirado/)).toBeInTheDocument());
  });
});
