import { describe, expect, it, beforeEach, vi } from "vitest";
import { screen, waitFor, fireEvent, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderAtRoute } from "../testUtils.js";
import { ActiveOrganizationContext, type ActiveOrganizationValue } from "../../src/auth/ActiveOrganizationContext.js";
import { NotificationPreferences } from "../../src/routes/NotificationPreferences.js";
import { ApiError } from "../../src/api/errors.js";
import type { NotificationPreferences as NotificationPreferencesData } from "../../src/api/types.js";

function renderScreen() {
  return renderAtRoute("/settings/notifications", <NotificationPreferences />, "/settings/notifications");
}

function activeOrgValue(organizationId: string): ActiveOrganizationValue {
  return { organizationId, onboardingState: undefined, organizationSelectionRequired: undefined, switching: false, select: () => {}, isPending: false };
}

/** No router needed here - unlike renderAtRoute's screens, NotificationPreferences never calls
 * useOrgPath()/renders a Link, so a bare ActiveOrganizationContext + QueryClientProvider is
 * enough, and lets this test change `organizationId` via `rerender` directly (renderAtRoute's
 * MemoryRouter bakes the orgId into the URL at mount time, which can't simulate an in-place
 * org switch that keeps the same route/component instance mounted). */
function renderWithOrg(organizationId: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ActiveOrganizationContext.Provider value={activeOrgValue(organizationId)}>
        <NotificationPreferences />
      </ActiveOrganizationContext.Provider>
    </QueryClientProvider>,
  );
  return {
    ...utils,
    switchOrg: (nextOrganizationId: string) =>
      utils.rerender(
        <QueryClientProvider client={queryClient}>
          <ActiveOrganizationContext.Provider value={activeOrgValue(nextOrganizationId)}>
            <NotificationPreferences />
          </ActiveOrganizationContext.Provider>
        </QueryClientProvider>,
      ),
  };
}

const { getMock, putMock } = vi.hoisted(() => ({ getMock: vi.fn(), putMock: vi.fn() }));
vi.mock("../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, put: putMock, post: vi.fn(), delete: vi.fn() },
}));

function basePreferences(overrides: Partial<NotificationPreferencesData> = {}): NotificationPreferencesData {
  return {
    emailEnabled: true,
    locale: "pt-BR",
    quietHours: null,
    consentSource: "USER_SETTINGS",
    version: 1,
    createdAt: "2026-03-12T10:00:00.000Z",
    updatedAt: "2026-03-12T10:00:00.000Z",
    ...overrides,
  };
}

function conflictError() {
  return new ApiError({ code: "CONFLICT", category: "CONFLICT", message: "Version conflict.", retryable: false });
}

beforeEach(() => {
  getMock.mockReset();
  putMock.mockReset();
});

describe("NotificationPreferences (A18, Block 8)", () => {
  it("shows an error state with retry when the initial GET fails", async () => {
    getMock.mockRejectedValue(new Error("down"));
    renderScreen();

    await waitFor(() => expect(screen.getByText("Não foi possível carregar suas preferências.")).toBeInTheDocument());
  });

  it("loads and displays the current preferences", async () => {
    getMock.mockResolvedValue({ preferences: basePreferences({ locale: "en-US" }) });
    renderScreen();

    await waitFor(() => expect(screen.getByLabelText(/^Idioma/)).toHaveValue("en-US"));
    expect(screen.getByLabelText("Ativado")).toBeChecked();
    expect(screen.getByText("Indisponível")).toBeInTheDocument();
  });

  // Deviation 1 (file header comment, Codex review round 1 BLOQUEANTE finding): the checkbox is
  // always disabled (no toggle control on this screen), but it must reflect the REAL value - an
  // SES-complaint suppression (`emailEnabled: false`) must never be shown/sent as re-enabled.
  it("shows the e-mail checkbox unchecked (never forced checked) when the backend reports emailEnabled: false, and preserves it on save", async () => {
    getMock.mockResolvedValue({ preferences: basePreferences({ emailEnabled: false }) });
    putMock.mockResolvedValue({ preferences: basePreferences({ emailEnabled: false, version: 2 }) });
    renderScreen();

    await waitFor(() => expect(screen.getByLabelText("Ativado")).not.toBeChecked());
    expect(screen.getByLabelText("Ativado")).toBeDisabled();
    expect(screen.getByText("Desativado — contate o suporte para reativar")).toBeInTheDocument();

    screen.getByRole("button", { name: "Salvar preferências" }).click();
    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith("/notifications/preferences", expect.objectContaining({ emailEnabled: false }), { expectedVersion: 1 }),
    );
  });

  it("shows the e-mail checkbox checked when emailEnabled is true", async () => {
    getMock.mockResolvedValue({ preferences: basePreferences({ emailEnabled: true }) });
    renderScreen();

    await waitFor(() => expect(screen.getByLabelText("Ativado")).toBeChecked());
    expect(screen.getByText("Canal padrão da sua conta")).toBeInTheDocument();
  });

  it("shows the 'default preferences' notice only when consentSource is MIGRATED_DEFAULT", async () => {
    getMock.mockResolvedValue({ preferences: basePreferences({ consentSource: "MIGRATED_DEFAULT" }) });
    renderScreen();

    await waitFor(() => expect(screen.getByText("Estas são as preferências padrão — ainda não personalizadas.")).toBeInTheDocument());
  });

  it("does not show the 'default preferences' notice once preferences were saved (USER_SETTINGS)", async () => {
    getMock.mockResolvedValue({ preferences: basePreferences({ consentSource: "USER_SETTINGS" }) });
    renderScreen();

    await waitFor(() => expect(screen.getByLabelText(/^Idioma/)).toBeInTheDocument());
    expect(screen.queryByText("Estas são as preferências padrão — ainda não personalizadas.")).not.toBeInTheDocument();
  });

  it("pre-fills the quiet-hours fields and shows the consent source for e-mail", async () => {
    getMock.mockResolvedValue({
      preferences: basePreferences({
        consentSource: "ONBOARDING",
        createdAt: "2026-03-12T10:00:00.000Z",
        quietHours: { enabled: true, startLocal: "21:00", endLocal: "07:00", timeZone: "America/Sao_Paulo" },
      }),
    });
    renderScreen();

    await waitFor(() => expect(screen.getByLabelText(/^Das/)).toHaveValue("21:00"));
    expect(screen.getByLabelText(/^Até/)).toHaveValue("07:00");
    expect(screen.getByText(/Confirmado no cadastro em/)).toBeInTheDocument();
    expect(screen.getByText("Este intervalo atravessa a meia-noite.")).toBeInTheDocument();
  });

  it("blocks save with a field error when only one quiet-hours field is filled", async () => {
    getMock.mockResolvedValue({ preferences: basePreferences() });
    renderScreen();

    await waitFor(() => expect(screen.getByLabelText(/^Das/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^Das/), { target: { value: "21:00" } });

    await waitFor(() => expect(screen.getByText("Informe os dois horários do intervalo, ou deixe ambos em branco.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Salvar preferências" })).toBeDisabled();
    expect(putMock).not.toHaveBeenCalled();
  });

  it("blocks save with a field error when start equals end", async () => {
    getMock.mockResolvedValue({
      preferences: basePreferences({ quietHours: { enabled: true, startLocal: "21:00", endLocal: "21:00", timeZone: "America/Sao_Paulo" } }),
    });
    renderScreen();

    // Attached to BOTH fields (Codex review round 1 MÉDIO finding: the problem belongs to the
    // pair, not to one arbitrarily-chosen field).
    await waitFor(() => expect(screen.getAllByText("Intervalo precisa ter início e fim diferentes.")).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Salvar preferências" })).toBeDisabled();
  });

  it("saves the form and sends emailEnabled: true, the selected locale, and quietHours: null when both time fields are blank", async () => {
    getMock.mockResolvedValue({ preferences: basePreferences() });
    putMock.mockResolvedValue({ preferences: basePreferences() });
    renderScreen();

    await waitFor(() => expect(screen.getByLabelText(/^Idioma/)).toBeInTheDocument());
    screen.getByRole("button", { name: "Salvar preferências" }).click();

    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith("/notifications/preferences", { emailEnabled: true, locale: "pt-BR", quietHours: null }, { expectedVersion: 1 }),
    );
  });

  it("shows a transient 'Salvo' label after a successful save, then reverts", async () => {
    getMock.mockResolvedValue({ preferences: basePreferences() });
    putMock.mockResolvedValue({ preferences: basePreferences({ version: 2 }) });
    renderScreen();

    await waitFor(() => expect(screen.getByLabelText(/^Idioma/)).toBeInTheDocument());
    screen.getByRole("button", { name: "Salvar preferências" }).click();

    await waitFor(() => expect(screen.getByRole("button", { name: "Salvo" })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Salvar preferências" })).toBeInTheDocument(), { timeout: 3000 });
  });

  it("shows the OCC-conflict notice (never the generic error) on a version conflict", async () => {
    getMock.mockResolvedValue({ preferences: basePreferences() });
    putMock.mockRejectedValue(conflictError());
    renderScreen();

    await waitFor(() => expect(screen.getByLabelText(/^Idioma/)).toBeInTheDocument());
    screen.getByRole("button", { name: "Salvar preferências" }).click();

    await waitFor(() => expect(screen.getByText(/alteradas em outro lugar/)).toBeInTheDocument());
    expect(screen.queryByText("Não foi possível salvar suas preferências. Tente novamente.")).not.toBeInTheDocument();
  });

  // Codex review round 1 ALTO finding, corrected: a conflict used to leave Save re-clickable with
  // the SAME stale version, repeating the 409 forever. "Recarregar" now refetches and re-hydrates
  // the form from the fresh server value, and Save stays disabled until that happens.
  it("disables Save during a conflict, and 'Recarregar' re-hydrates the form and clears it", async () => {
    // First call is the initial load; every call after (the explicit "Recarregar" click, which
    // itself awaits a fresh `query.refetch()` - see NotificationPreferences.tsx's
    // handleReloadAfterConflict) gets the fresh value - using `mockResolvedValue` (not `Once`) for
    // the fallback avoids the mock queue running dry and returning `undefined`, which TanStack
    // Query treats as a hard query error.
    getMock
      .mockResolvedValueOnce({ preferences: basePreferences({ locale: "pt-BR", version: 1 }) })
      .mockResolvedValue({ preferences: basePreferences({ locale: "en-US", version: 2 }) });
    putMock.mockRejectedValue(conflictError());
    renderScreen();

    await waitFor(() => expect(screen.getByLabelText(/^Idioma/)).toHaveValue("pt-BR"));
    screen.getByRole("button", { name: "Salvar preferências" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Recarregar" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Salvar preferências" })).toBeDisabled();

    screen.getByRole("button", { name: "Recarregar" }).click();
    await waitFor(() => expect(screen.getByLabelText(/^Idioma/)).toHaveValue("en-US"));
    expect(screen.getByRole("button", { name: "Salvar preferências" })).not.toBeDisabled();
  });

  // Codex review round 2 (D-2xx) HIGH finding, corrected: a FAILED reload used to still clear the
  // conflict flag and hydrate from whatever `query.data` happened to hold (TanStack Query can
  // keep the stale previous value around on a failed refetch) - letting the very next save repeat
  // the same 409 forever, silently.
  it("keeps the conflict notice and Save disabled (never silently clears it) when 'Recarregar' itself fails", async () => {
    getMock
      .mockResolvedValueOnce({ preferences: basePreferences({ locale: "pt-BR", version: 1 }) })
      .mockRejectedValue(new Error("network down"));
    putMock.mockRejectedValue(conflictError());
    renderScreen();

    await waitFor(() => expect(screen.getByLabelText(/^Idioma/)).toHaveValue("pt-BR"));
    screen.getByRole("button", { name: "Salvar preferências" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Recarregar" })).toBeInTheDocument());

    screen.getByRole("button", { name: "Recarregar" }).click();
    await waitFor(() => expect(screen.getByText(/Não foi possível recarregar agora/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Salvar preferências" })).toBeDisabled();
    expect(screen.getByLabelText(/^Idioma/)).toHaveValue("pt-BR");
  });

  // Codex review round 2 MEDIUM finding, corrected: silently falling back to a fixed timezone
  // when detection fails would apply the WRONG timezone to a user outside it - this must block
  // save and say so instead of guessing.
  it("blocks save and shows a distinct notice when the browser's timezone cannot be detected for a NEW quiet-hours window", async () => {
    const originalDateTimeFormat = Intl.DateTimeFormat;
    // @ts-expect-error - intentionally breaking timezone resolution for this one test
    Intl.DateTimeFormat = () => {
      throw new Error("Intl unavailable");
    };
    try {
      getMock.mockResolvedValue({ preferences: basePreferences() });
      renderScreen();

      await waitFor(() => expect(screen.getByLabelText(/^Das/)).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText(/^Das/), { target: { value: "21:00" } });
      fireEvent.change(screen.getByLabelText(/^Até/), { target: { value: "07:00" } });
      screen.getByRole("button", { name: "Salvar preferências" }).click();

      await waitFor(() => expect(screen.getByText(/Não foi possível detectar seu fuso horário/)).toBeInTheDocument());
      expect(putMock).not.toHaveBeenCalled();
    } finally {
      Intl.DateTimeFormat = originalDateTimeFormat;
    }
  });

  it("shows a distinct 'unknown outcome' notice (never claiming failure) when the save's result is genuinely unknown", async () => {
    getMock.mockResolvedValue({ preferences: basePreferences() });
    putMock.mockRejectedValue(ApiError.unknownOutcome(new Error("timeout")));
    renderScreen();

    await waitFor(() => expect(screen.getByLabelText(/^Idioma/)).toBeInTheDocument());
    screen.getByRole("button", { name: "Salvar preferências" }).click();

    await waitFor(() => expect(screen.getByText(/Não sabemos se suas preferências foram salvas/)).toBeInTheDocument());
    expect(screen.queryByText("Não foi possível salvar suas preferências. Tente novamente.")).not.toBeInTheDocument();
  });

  // Deviation 3 (file header comment, Codex review round 1 ALTO finding): saving any OTHER field
  // must never silently move a saved quiet-hours window to the browser's current timezone or
  // re-enable a window the user had paused - both must be preserved verbatim.
  it("preserves the loaded quiet-hours enabled:false and original timeZone when only the locale changes", async () => {
    getMock.mockResolvedValue({
      preferences: basePreferences({ quietHours: { enabled: false, startLocal: "21:00", endLocal: "07:00", timeZone: "Europe/Lisbon" } }),
    });
    let putBody: unknown;
    putMock.mockImplementation((_path, body) => {
      putBody = body;
      return Promise.resolve({ preferences: basePreferences({ version: 2 }) });
    });
    renderScreen();

    await waitFor(() => expect(screen.getByLabelText(/^Das/)).toHaveValue("21:00"));
    fireEvent.change(screen.getByLabelText(/^Idioma/), { target: { value: "en-US" } });
    screen.getByRole("button", { name: "Salvar preferências" }).click();

    await waitFor(() =>
      expect(putBody).toEqual({ emailEnabled: true, locale: "en-US", quietHours: { enabled: false, startLocal: "21:00", endLocal: "07:00", timeZone: "Europe/Lisbon" } }),
    );
  });

  it("shows the generic error label/notice and preserves the form on a non-conflict save failure", async () => {
    getMock.mockResolvedValue({ preferences: basePreferences() });
    putMock.mockRejectedValue(new Error("network down"));
    renderScreen();

    await waitFor(() => expect(screen.getByLabelText(/^Idioma/)).toBeInTheDocument());
    screen.getByRole("button", { name: "Salvar preferências" }).click();

    await waitFor(() => expect(screen.getByRole("button", { name: "Falhou — tentar de novo" })).toBeInTheDocument());
    expect(screen.getByText("Não foi possível salvar suas preferências. Tente novamente.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Idioma/)).toHaveValue("pt-BR");
  });

  // Codex review round 1 (D-2xx) BLOQUEANTE finding, corrected: this screen used to keep its
  // local edit state across an organization switch (React Router reuses the SAME component
  // instance across a `:orgId` param change) - a stale field from the PREVIOUS organization could
  // be saved against the NEW organization's version. `key={organizationId}` on `PreferencesPanel`
  // forces a full remount (and therefore a fresh hydration) on every switch.
  it("resets all local edit state to the NEW organization's own values when the active organization switches", async () => {
    getMock.mockImplementation(() => Promise.resolve({ preferences: basePreferences({ locale: "pt-BR" }) }));
    const { switchOrg } = renderWithOrg("org-1");

    await waitFor(() => expect(screen.getByLabelText(/^Idioma/)).toHaveValue("pt-BR"));
    fireEvent.change(screen.getByLabelText(/^Idioma/), { target: { value: "en-US" } });
    expect(screen.getByLabelText(/^Idioma/)).toHaveValue("en-US");

    getMock.mockImplementation(() => Promise.resolve({ preferences: basePreferences({ locale: "pt-BR", version: 5 }) }));
    switchOrg("org-2");

    // The unsaved "en-US" edit for org-1 must be gone, replaced by org-2's own real value - never
    // carried over and silently saved against the new organization.
    await waitFor(() => expect(screen.getByLabelText(/^Idioma/)).toHaveValue("pt-BR"));
  });
});
