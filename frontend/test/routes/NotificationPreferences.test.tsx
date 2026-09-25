import { MemoryRouter } from "react-router-dom";
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
        <MemoryRouter><NotificationPreferences /></MemoryRouter>
      </ActiveOrganizationContext.Provider>
    </QueryClientProvider>,
  );
  return {
    ...utils,
    switchOrg: (nextOrganizationId: string) =>
      utils.rerender(
        <QueryClientProvider client={queryClient}>
          <ActiveOrganizationContext.Provider value={activeOrgValue(nextOrganizationId)}>
            <MemoryRouter><NotificationPreferences /></MemoryRouter>
          </ActiveOrganizationContext.Provider>
        </QueryClientProvider>,
      ),
  };
}

const { getMock, putMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), putMock: vi.fn(), postMock: vi.fn() }));
vi.mock("../../src/api/apiClient.js", () => ({
  apiClient: { get: getMock, put: putMock, post: postMock, delete: vi.fn() },
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
  postMock.mockReset();
});

describe("NotificationPreferences (A18, Block 8)", () => {
  // Mutation: silencing an initial read failure would fail this case.
  it("shows an error state with retry when the initial GET fails", async () => {
    getMock.mockRejectedValue(new Error("down"));
    renderScreen();

    await waitFor(() => expect(screen.getByText("Não foi possível carregar suas preferências.")).toBeInTheDocument());
  });

  // Mutation: offering implicit WhatsApp consent would fail this case.
  it("loads and displays the current preferences", async () => {
    getMock.mockResolvedValue({ preferences: basePreferences() });
    renderScreen();

    await waitFor(() => expect(screen.getByRole("switch", { name: "Receber lembretes por e-mail" })).toBeChecked());
    // Item 26 (Marcelo, 2026-09-23): WhatsApp shows a real phone confirmation form now,
    // never the old permanent "Indisponível" badge.
    expect(screen.queryByLabelText(/^Telefone/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enviar código" })).not.toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  // Deviation 1 (file header comment, Codex review round 1 BLOQUEANTE finding): the switch is
  // always disabled (no toggle control on this screen), but it must reflect the REAL value - an
  // SES-complaint suppression (`emailEnabled: false`) must never be shown/sent as re-enabled.
  // Mutation: re-enabling a suppressed email preference would fail this case.
  it("shows the e-mail switch off (never forced on) when the backend reports emailEnabled: false, and preserves it on save", async () => {
    getMock.mockResolvedValue({ preferences: basePreferences({ emailEnabled: false }) });
    putMock.mockResolvedValue({ preferences: basePreferences({ emailEnabled: false, version: 2 }) });
    renderScreen();

    await waitFor(() => expect(screen.getByRole("switch", { name: "Receber lembretes por e-mail" })).not.toBeChecked());
    expect(screen.getByRole("switch", { name: "Receber lembretes por e-mail" })).toBeDisabled();
    expect(screen.getByText("Para reativar o e-mail, contate o suporte.")).toBeInTheDocument();

    screen.getByRole("button", { name: "Salvar preferências" }).click();
    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith("/notifications/preferences", expect.objectContaining({ emailEnabled: false }), { expectedVersion: 1 }),
    );
  });

  // Mutation: displaying an enabled channel as disabled would fail this case.
  it("shows the e-mail switch on when emailEnabled is true", async () => {
    getMock.mockResolvedValue({ preferences: basePreferences({ emailEnabled: true }) });
    renderScreen();

    await waitFor(() => expect(screen.getByRole("switch", { name: "Receber lembretes por e-mail" })).toBeChecked());
    expect(screen.getByText("Enviado ao endereço associado à sua conta.")).toBeInTheDocument();
  });

  // Mutation: hiding the service-reported default state would fail this case.
  it("shows the 'default preferences' notice only when consentSource is MIGRATED_DEFAULT", async () => {
    getMock.mockResolvedValue({ preferences: basePreferences({ consentSource: "MIGRATED_DEFAULT" }) });
    renderScreen();

    await waitFor(() => expect(screen.getByText("Você está usando as configurações padrão. Personalize os canais e horários abaixo.")).toBeInTheDocument());
  });

  // Mutation: inventing a default state after customization would fail this case.
  it("does not show the 'default preferences' notice once preferences were saved (USER_SETTINGS)", async () => {
    getMock.mockResolvedValue({ preferences: basePreferences({ consentSource: "USER_SETTINGS" }) });
    renderScreen();

    await waitFor(() => expect(screen.getByRole("switch", { name: "Receber lembretes por e-mail" })).toBeInTheDocument());
    expect(screen.queryByText("Você está usando as configurações padrão. Personalize os canais e horários abaixo.")).not.toBeInTheDocument();
  });

  // Mutation: discarding the saved quiet-hours values would fail this case.
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
    expect(screen.getByText(/Fuso horário: America\/Sao_Paulo/)).toBeInTheDocument();
    expect(screen.getByText("Preencha os dois horários para ativar o intervalo. Um período que atravessa a meia-noite também é aceito.")).toBeInTheDocument();
  });

  // Mutation: sending an incomplete quiet-hours window would fail this case.
  it("blocks save with a field error when only one quiet-hours field is filled", async () => {
    getMock.mockResolvedValue({ preferences: basePreferences() });
    renderScreen();

    await waitFor(() => expect(screen.getByLabelText(/^Das/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/^Das/), { target: { value: "21:00" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar preferências" }));
    await waitFor(() => expect(screen.getByLabelText(/^Até/)).toHaveFocus());
    expect(screen.getByLabelText(/^Até/)).toHaveAttribute("aria-invalid", "true");
    expect(putMock).not.toHaveBeenCalled();
  });

  // Mutation: sending equal start and end times would fail this case.
  it("blocks save with a field error when start equals end", async () => {
    getMock.mockResolvedValue({
      preferences: basePreferences({ quietHours: { enabled: true, startLocal: "21:00", endLocal: "21:00", timeZone: "America/Sao_Paulo" } }),
    });
    renderScreen();

    // Attached to BOTH fields (Codex review round 1 MÉDIO finding: the problem belongs to the
    // pair, not to one arbitrarily-chosen field).
    await screen.findByLabelText(/^Até/);
    fireEvent.click(screen.getByRole("button", { name: "Salvar preferências" }));
    expect(screen.getByLabelText(/^Até/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/^Até/)).toHaveFocus();
    expect(putMock).not.toHaveBeenCalled();
  });

  // Mutation: sending a non-null blank interval would fail this case.
  it("saves the form and sends emailEnabled: true, the fixed locale, and quietHours: null when both time fields are blank", async () => {
    getMock.mockResolvedValue({ preferences: basePreferences() });
    putMock.mockResolvedValue({ preferences: basePreferences() });
    renderScreen();

    await waitFor(() => expect(screen.getByRole("switch", { name: "Receber lembretes por e-mail" })).toBeInTheDocument());
    screen.getByRole("button", { name: "Salvar preferências" }).click();

    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith("/notifications/preferences", { emailEnabled: true, locale: "pt-BR", quietHours: null }, { expectedVersion: 1 }),
    );
  });

  // Mutation: announcing success before a save resolves would fail this case.
  it("confirms a successful save while keeping the primary action available", async () => {
    getMock.mockResolvedValue({ preferences: basePreferences() });
    putMock.mockResolvedValue({ preferences: basePreferences({ version: 2 }) });
    renderScreen();

    await waitFor(() => expect(screen.getByRole("switch", { name: "Receber lembretes por e-mail" })).toBeInTheDocument());
    screen.getByRole("button", { name: "Salvar preferências" }).click();

    await waitFor(() => expect(screen.getByText("Preferências salvas.")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Salvar preferências" })).toBeInTheDocument(), { timeout: 3000 });
  });

  // Mutation: hiding the version conflict would fail this case.
  it("shows the OCC-conflict notice (never the generic error) on a version conflict", async () => {
    getMock.mockResolvedValue({ preferences: basePreferences() });
    putMock.mockRejectedValue(conflictError());
    renderScreen();

    await waitFor(() => expect(screen.getByRole("switch", { name: "Receber lembretes por e-mail" })).toBeInTheDocument());
    screen.getByRole("button", { name: "Salvar preferências" }).click();

    await waitFor(() => expect(screen.getByText(/mudaram em outra sessão/)).toBeInTheDocument());
    expect(screen.queryByText("Não foi possível salvar suas preferências. Tente novamente.")).not.toBeInTheDocument();
  });

  // Codex review round 1 ALTO finding, corrected: a conflict used to leave Save re-clickable with
  // the SAME stale version, repeating the 409 forever. "Recarregar" now refetches and re-hydrates
  // the form from the fresh server value, and Save stays disabled until that happens.
  // Mutation: saving repeatedly with a stale version would fail this case.
  it("disables Save during a conflict, and 'Recarregar' re-hydrates the form and clears it", async () => {
    // First call is the initial load; every call after (the explicit "Recarregar" click, which
    // itself awaits a fresh `query.refetch()` - see NotificationPreferences.tsx's
    // handleReloadAfterConflict) gets the fresh value - using `mockResolvedValue` (not `Once`) for
    // the fallback avoids the mock queue running dry and returning `undefined`, which TanStack
    // Query treats as a hard query error.
    getMock
      .mockResolvedValueOnce({ preferences: basePreferences({ version: 1 }) })
      .mockResolvedValue({
        preferences: basePreferences({ version: 2, quietHours: { enabled: true, startLocal: "21:00", endLocal: "07:00", timeZone: "America/Sao_Paulo" } }),
      });
    putMock.mockRejectedValue(conflictError());
    renderScreen();

    await waitFor(() => expect(screen.getByRole("switch", { name: "Receber lembretes por e-mail" })).toBeInTheDocument());
    screen.getByRole("button", { name: "Salvar preferências" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Recarregar" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Salvar preferências" })).toBeDisabled();

    screen.getByRole("button", { name: "Recarregar" }).click();
    await waitFor(() => expect(screen.getByLabelText(/^Das/)).toHaveValue("21:00"));
    expect(screen.getByRole("button", { name: "Salvar preferências" })).not.toBeDisabled();
  });

  // Codex review round 2 (D-2xx) HIGH finding, corrected: a FAILED reload used to still clear the
  // conflict flag and hydrate from whatever `query.data` happened to hold (TanStack Query can
  // keep the stale previous value around on a failed refetch) - letting the very next save repeat
  // the same 409 forever, silently.
  // Mutation: clearing conflict after a failed reload would fail this case.
  it("keeps the conflict notice and Save disabled (never silently clears it) when 'Recarregar' itself fails", async () => {
    getMock
      .mockResolvedValueOnce({ preferences: basePreferences({ version: 1 }) })
      .mockRejectedValue(new Error("network down"));
    putMock.mockRejectedValue(conflictError());
    renderScreen();

    await waitFor(() => expect(screen.getByRole("switch", { name: "Receber lembretes por e-mail" })).toBeInTheDocument());
    screen.getByRole("button", { name: "Salvar preferências" }).click();
    await waitFor(() => expect(screen.getByRole("button", { name: "Recarregar" })).toBeInTheDocument());

    screen.getByRole("button", { name: "Recarregar" }).click();
    await waitFor(() => expect(screen.getByText(/Não foi possível recarregar\./)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Salvar preferências" })).toBeDisabled();
  });

  // Mutation: inferring a browser timezone would override the displayed fallback required by the specification.
  // Mutation: using an undisclosed browser timezone would fail this case.
  it("uses the displayed Sao Paulo fallback for a new quiet-hours window", async () => {
    getMock.mockResolvedValue({ preferences: basePreferences() });
    putMock.mockResolvedValue({ preferences: basePreferences({ version: 2 }) });
    renderScreen();
    fireEvent.change(await screen.findByLabelText(/^Das/), { target: { value: "21:00" } });
    fireEvent.change(screen.getByLabelText(/^Até/), { target: { value: "07:00" } });
    expect(screen.getByText("Fuso horário: America/Sao_Paulo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Salvar preferências" }));
    await waitFor(() => expect(putMock).toHaveBeenCalledWith("/notifications/preferences", expect.objectContaining({ quietHours: { enabled: true, startLocal: "21:00", endLocal: "07:00", timeZone: "America/Sao_Paulo" } }), { expectedVersion: 1 }));
  });

  // Mutation: claiming a timeout definitively failed would fail this case.
  it("shows a distinct 'unknown outcome' notice (never claiming failure) when the save's result is genuinely unknown", async () => {
    getMock.mockResolvedValue({ preferences: basePreferences() });
    putMock.mockRejectedValue(ApiError.unknownOutcome(new Error("timeout")));
    renderScreen();

    await waitFor(() => expect(screen.getByRole("switch", { name: "Receber lembretes por e-mail" })).toBeInTheDocument());
    screen.getByRole("button", { name: "Salvar preferências" }).click();

    await waitFor(() => expect(screen.getByText(/Não sabemos se suas preferências foram salvas/)).toBeInTheDocument());
    expect(screen.queryByText("Não foi possível salvar suas preferências. Tente novamente.")).not.toBeInTheDocument();
  });

  // Deviation 3 (file header comment, Codex review round 1 ALTO finding): saving must never
  // silently move a saved quiet-hours window to the browser's current timezone or re-enable a
  // window the user had paused - both must be preserved verbatim even on an unrelated save.
  // Mutation: re-enabling paused quiet hours or changing its timezone would fail this case.
  it("preserves the loaded quiet-hours enabled:false and original timeZone on save", async () => {
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
    screen.getByRole("button", { name: "Salvar preferências" }).click();

    await waitFor(() =>
      expect(putBody).toEqual({ emailEnabled: true, locale: "pt-BR", quietHours: { enabled: false, startLocal: "21:00", endLocal: "07:00", timeZone: "Europe/Lisbon" } }),
    );
  });

  // Mutation: discarding inputs after a save failure would fail this case.
  it("shows the generic error label/notice and preserves the form on a non-conflict save failure", async () => {
    getMock.mockResolvedValue({ preferences: basePreferences() });
    putMock.mockRejectedValue(new Error("network down"));
    renderScreen();

    await waitFor(() => expect(screen.getByRole("switch", { name: "Receber lembretes por e-mail" })).toBeInTheDocument());
    screen.getByRole("button", { name: "Salvar preferências" }).click();

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível salvar as preferências agora."));
    expect(screen.getByRole("switch", { name: "Receber lembretes por e-mail" })).toBeChecked();
  });

  // Codex review round 1 (D-2xx) BLOQUEANTE finding, corrected: this screen used to keep its
  // local edit state across an organization switch (React Router reuses the SAME component
  // instance across a `:orgId` param change) - a stale field from the PREVIOUS organization could
  // be saved against the NEW organization's version. `key={organizationId}` on `PreferencesPanel`
  // forces a full remount (and therefore a fresh hydration) on every switch.
  // Mutation: carrying local edits into another organization would fail this case.
  it("resets all local edit state to the NEW organization's own values when the active organization switches", async () => {
    getMock.mockImplementation(() => Promise.resolve({ preferences: basePreferences() }));
    const { switchOrg } = renderWithOrg("org-1");

    await waitFor(() => expect(screen.getByLabelText(/^Das/)).toHaveValue(""));
    fireEvent.change(screen.getByLabelText(/^Das/), { target: { value: "21:00" } });
    expect(screen.getByLabelText(/^Das/)).toHaveValue("21:00");

    getMock.mockImplementation(() => Promise.resolve({ preferences: basePreferences({ version: 5 }) }));
    switchOrg("org-2");

    // The unsaved "21:00" edit for org-1 must be gone, replaced by org-2's own real value - never
    // carried over and silently saved against the new organization.
    await waitFor(() => expect(screen.getByLabelText(/^Das/)).toHaveValue(""));
  });

  // Mutation: invoking phone verification here would also grant delivery consent with the current service.
  // Mutation: offering implicit delivery consent would fail this case.
  it("does not offer verification while it implicitly opts into delivery", async () => {
    getMock.mockResolvedValue({ preferences: basePreferences() });
    renderScreen();
    await screen.findByText("A verificação de número ainda não está disponível para uso nesta tela.");
    expect(screen.queryByRole("button", { name: "Enviar código" })).not.toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });
});
