/**
 * A18 (Block 8, D-2xx) — Minhas preferências de notificação. `notification:configure`,
 * READ_ONLY_ROLES (every real role edits only their OWN preferences).
 *
 * OmniVence redesign regression (found while fixing e2e/block8-notification-preferences.spec.ts,
 * 2026-09-25): the screen had been rewritten from the prototype HTML with a plain in-memory
 * email checkbox (user-toggleable whenever `emailEnabled` was true, name "Receber lembretes por
 * e-mail") and a static "verificação ainda não disponível" placeholder instead of the real item
 * 26 WhatsApp phone-confirmation flow - dropping, in the process, every Codex-reviewed fix listed
 * below. Restored from the pre-redesign implementation (commit 4ef1fbcb / 496fb3d4's predecessor)
 * onto the new visual shell (`ov-notification-card`, `ov-email-row`, `ov-whatsapp`).
 *
 * Real, confirmed deviations from `A18-preferencias-notificacao.md` (the audited spec):
 *
 *  1. **The e-mail Switch reflects the REAL `emailEnabled` value, always disabled (no toggle
 *     control exists on this screen), and the save payload always echoes it back UNCHANGED.**
 *     `ses-callback-workflow.ts`'s `suppressEmailForRecipient()` sets `emailEnabled: false`
 *     PERMANENTLY after an SES complaint (spam report) - a real, deliberate safety mechanism.
 *     Sending anything other than the loaded truth on save would risk silently un-suppressing a
 *     complaining address, or silently suppressing an active one.
 *  2. **No in-app "unsaved changes" navigation guard beyond `UnsavedChangesGuard`'s own reach**
 *     (same primitive `CreateItem.tsx` uses) - `useBlocker`-based interception of every possible
 *     navigation is out of this single screen's scope.
 *  3. **Quiet hours preserves the loaded record's own `enabled`/`timeZone` verbatim**; this screen
 *     never flips `enabled` or re-detects the browser's timezone for an EXISTING window - only a
 *     brand-new window (nothing to preserve) detects the current browser's timezone.
 *  4. **REMOVED (2026-09-22, Marcelo): "Idioma dos lembretes" control** - no real localized
 *     content exists yet (`notification-router-workflow.ts` hard-codes `locale: "pt-BR"`).
 *     `FIXED_LOCALE` below is sent on every save so the backend's `required: ["emailEnabled",
 *     "locale"]` schema is still satisfied.
 *
 * **Item 26 — phone-ownership confirmation.** "Enviar código" (`requestWhatsAppPhoneConfirmation`)
 * sends a 6-digit code over WhatsApp, then a code field + "Confirmar"/"Reenviar código"
 * (`confirmWhatsAppPhoneConfirmation`) verifies it and only THEN records the opt-in server-side -
 * never a self-declared number with zero proof of possession. No GET endpoint exists for opt-in
 * status (create-once POST only), so this screen only shows an ephemeral confirmation right after
 * a successful submit in the same session, never a persisted "already opted in" state on reload.
 */
import { useEffect, useRef, useState } from "react";
import { Bell, Check, Mail, MessageCircle, Moon } from "lucide-react";
import { useNotificationPreferences } from "../hooks/useNotificationPreferences.js";
import { useUpdateNotificationPreferences } from "../hooks/useUpdateNotificationPreferences.js";
import { useRequestWhatsAppPhoneConfirmation, useConfirmWhatsAppPhoneConfirmation } from "../hooks/useWhatsAppPhoneConfirmation.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import { InitialLoading, ErrorState } from "../components/AsyncStates.js";
import { PageHeader } from "../components/ui/Layout.js";
import { InlineNotice } from "../components/ui/InlineNotice.js";
import { Switch } from "../components/ui/Switch.js";
import { Button } from "../components/ui/Button.js";
import { TextField } from "../components/forms/TextField.js";
import { UnsavedChangesGuard } from "../components/UnsavedChangesGuard.js";
import { ApiError, isConflict, isUnknownOutcome } from "../api/errors.js";
import { formatAbsoluteDate } from "../api/presentation.js";
import type { NotificationConsentSource, NotificationPreferences as Preferences, NotificationQuietHours } from "../api/types.js";
import "./NotificationPreferences.css";

/** Único idioma real de conteúdo hoje - ver nota 4 acima. */
const FIXED_LOCALE = "pt-BR";

/** `+5511999999999` shape, mirroring the backend's own validation pattern - a client-side
 * rejection and the real one never disagree about what counts as a valid number. */
const WHATSAPP_PHONE_PATTERN = /^\+[1-9]\d{1,14}$/;

// A genuinely undetectable timezone must block save, never silently substitute a guessed one
// (e.g. "America/Sao_Paulo") that would confidently apply the wrong zone to a user elsewhere.
function detectTimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && zone.length > 0 ? zone : undefined;
  } catch {
    return undefined;
  }
}

function consentCopy(consentSource: NotificationConsentSource, createdAt: string, updatedAt: string): string {
  switch (consentSource) {
    case "ONBOARDING":
      return `Confirmado no cadastro em ${formatAbsoluteDate(createdAt)}`;
    case "USER_SETTINGS":
      return `Definido por você em ${formatAbsoluteDate(updatedAt)}`;
    case "MIGRATED_DEFAULT":
      return "Padrão do sistema — ainda não personalizado";
  }
}

export function NotificationPreferences() {
  const { organizationId } = useActiveOrganization();
  useEffect(() => { document.title = "Notificações · OmniVence"; }, []);
  return <div className="notif-prefs ov-notifications">
    <PageHeader title="Notificações" above={<span className="ov-eyebrow">Preferências pessoais</span>} description="Escolha como você recebe lembretes. Estas preferências não alteram as de outras pessoas." />
    {/* Codex review round 1 BLOQUEANTE finding, corrected: this screen used to keep its local
        edit state across an organization switch (React Router reuses the component instance
        across a `:orgId` param change) - a stale field from the PREVIOUS organization could be
        saved against the NEW organization's version. Keying by `organizationId` forces a fresh
        remount on every switch. */}
    <PreferencesPanel key={organizationId ?? "none"} />
  </div>;
}

function PreferencesPanel() {
  const query = useNotificationPreferences();
  if (query.isPending) return <InitialLoading label="Carregando preferências…" />;
  // `&& !query.data`: a background refetch failing must never blow away an already-loaded form
  // and the user's in-progress edits - only a genuine "never loaded at all" failure shows the
  // full-page error state.
  if (!query.data) return <ErrorState message="Não foi possível carregar suas preferências." onRetry={() => void query.refetch()} />;
  return <PreferencesForm preferences={query.data.preferences} refetch={query.refetch} />;
}

interface Snapshot {
  quietStart: string;
  quietEnd: string;
}

type SaveState = "idle" | "saving" | "success" | "error" | "unknown-outcome" | "timezone-unavailable";

function PreferencesForm({ preferences, refetch }: { preferences: Preferences; refetch: ReturnType<typeof useNotificationPreferences>["refetch"] }) {
  const mutation = useUpdateNotificationPreferences();
  const requestConfirmation = useRequestWhatsAppPhoneConfirmation();
  const confirmPhone = useConfirmWhatsAppPhoneConfirmation();

  // Item 26: two-step flow, mirroring VerifyEmail.tsx's shape - "idle" (phone entry) ->
  // "code-sent" (code entry) -> confirmed (ephemeral success notice - see file header's "no GET
  // for opt-in status" gap).
  const [whatsAppStep, setWhatsAppStep] = useState<"idle" | "code-sent">("idle");
  const [whatsAppPhone, setWhatsAppPhone] = useState("");
  const [whatsAppCode, setWhatsAppCode] = useState("");
  const [whatsAppError, setWhatsAppError] = useState<string | undefined>();
  const [whatsAppCodeError, setWhatsAppCodeError] = useState<string | undefined>();
  const [whatsAppConfirmedPhone, setWhatsAppConfirmedPhone] = useState<string | undefined>();

  function handleRequestWhatsAppConfirmation() {
    const trimmed = whatsAppPhone.trim();
    if (!WHATSAPP_PHONE_PATTERN.test(trimmed)) {
      setWhatsAppError("Informe o telefone no formato internacional, ex.: +5511999999999.");
      return;
    }
    setWhatsAppError(undefined);
    requestConfirmation.mutate(trimmed, {
      onSuccess: () => { setWhatsAppPhone(trimmed); setWhatsAppStep("code-sent"); },
      onError: (err) => setWhatsAppError(err instanceof ApiError ? err.message : "Não foi possível enviar o código de confirmação pelo WhatsApp."),
    });
  }

  function handleConfirmWhatsAppPhone() {
    setWhatsAppCodeError(undefined);
    confirmPhone.mutate(
      { phoneE164: whatsAppPhone, code: whatsAppCode },
      {
        onSuccess: () => { setWhatsAppConfirmedPhone(whatsAppPhone); setWhatsAppStep("idle"); setWhatsAppPhone(""); setWhatsAppCode(""); },
        onError: (err) => setWhatsAppCodeError(err instanceof ApiError ? err.message : "Código inválido ou expirado."),
      },
    );
  }

  function handleResendWhatsAppCode() {
    setWhatsAppCodeError(undefined);
    requestConfirmation.mutate(whatsAppPhone, {
      onError: (err) => setWhatsAppCodeError(err instanceof ApiError ? err.message : "Não foi possível reenviar o código."),
    });
  }

  const [initialized, setInitialized] = useState(false);
  const [quietStart, setQuietStart] = useState("");
  const [quietEnd, setQuietEnd] = useState("");
  const [initialSnapshot, setInitialSnapshot] = useState<Snapshot>({ quietStart: "", quietEnd: "" });
  // The loaded record's own enabled/timeZone, preserved verbatim across saves that don't touch
  // the times at all.
  const [originalQuietMeta, setOriginalQuietMeta] = useState<{ enabled: boolean; timeZone: string } | undefined>(undefined);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [conflict, setConflict] = useState(false);
  const [reloadFailed, setReloadFailed] = useState(false);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function hydrateFrom(quietHours: NotificationQuietHours | null) {
    const start = quietHours?.startLocal ?? "";
    const end = quietHours?.endLocal ?? "";
    setQuietStart(start);
    setQuietEnd(end);
    setInitialSnapshot({ quietStart: start, quietEnd: end });
    setOriginalQuietMeta(quietHours ? { enabled: quietHours.enabled, timeZone: quietHours.timeZone } : undefined);
  }

  useEffect(() => {
    if (!initialized) {
      hydrateFrom(preferences.quietHours);
      setInitialized(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized]);

  useEffect(() => () => { if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current); }, []);

  const dirty = initialized && (quietStart !== initialSnapshot.quietStart || quietEnd !== initialSnapshot.quietEnd);

  const startSet = quietStart.trim() !== "";
  const endSet = quietEnd.trim() !== "";

  let startFieldError: string | undefined;
  let endFieldError: string | undefined;
  if (startSet !== endSet) {
    const message = "Informe os dois horários do intervalo, ou deixe ambos em branco.";
    if (!startSet) startFieldError = message; else endFieldError = message;
  } else if (startSet && endSet && quietStart === quietEnd) {
    const message = "Intervalo precisa ter início e fim diferentes.";
    startFieldError = message;
    endFieldError = message;
  }
  const quietHoursError = startFieldError ?? endFieldError;
  const crossesMidnight = startSet && endSet && !quietHoursError && quietStart > quietEnd;

  // `undefined` (distinct from `null`, "no window") means a NEW window was requested but this
  // browser's timezone genuinely could not be detected - `handleSave` blocks on this, never
  // silently substitutes a guessed timezone.
  function buildQuietHours(): NotificationQuietHours | null | undefined {
    if (!startSet || !endSet) return null;
    if (originalQuietMeta) return { enabled: originalQuietMeta.enabled, startLocal: quietStart, endLocal: quietEnd, timeZone: originalQuietMeta.timeZone };
    const timeZone = detectTimeZone();
    if (!timeZone) return undefined;
    return { enabled: true, startLocal: quietStart, endLocal: quietEnd, timeZone };
  }

  async function handleSave() {
    if (quietHoursError || conflict) return;
    const quietHours = buildQuietHours();
    if (quietHours === undefined) { setSaveState("timezone-unavailable"); return; }
    setSaveState("saving");
    try {
      // Deviation 1 (file header) - always echo the REAL loaded value, never force `true`.
      await mutation.mutateAsync({ emailEnabled: preferences.emailEnabled, locale: FIXED_LOCALE, quietHours, expectedVersion: preferences.version });
      setInitialSnapshot({ quietStart, quietEnd });
      setOriginalQuietMeta(quietHours ? { enabled: quietHours.enabled, timeZone: quietHours.timeZone } : undefined);
      setSaveState("success");
      successTimeoutRef.current = setTimeout(() => setSaveState("idle"), 2000);
    } catch (err) {
      if (isConflict(err)) { setConflict(true); setSaveState("idle"); return; }
      if (isUnknownOutcome(err)) { setSaveState("unknown-outcome"); return; }
      setSaveState("error");
    }
  }

  // A conflict must actually reload the current server value, never just warn - the next click
  // could otherwise resend the SAME stale version and conflict again indefinitely.
  async function handleReloadAfterConflict() {
    const result = await refetch();
    // TanStack Query can keep the PREVIOUS successful `data` around even when a refetch itself
    // fails - checking `data` alone would silently re-hydrate from the same stale value and
    // clear the conflict notice, letting the next save repeat the same 409 forever.
    if (result.isSuccess && result.data) {
      hydrateFrom(result.data.preferences.quietHours);
      setConflict(false);
      setReloadFailed(false);
    } else {
      setReloadFailed(true);
    }
  }

  const saving = saveState === "saving";
  const saveLabel =
    saveState === "saving" ? "Salvando…" :
    saveState === "success" ? "Salvo" :
    saveState === "error" ? "Falhou — tentar de novo" :
    saveState === "unknown-outcome" || saveState === "timezone-unavailable" ? "Verificar antes de tentar de novo" :
    "Salvar preferências";

  return (
    <form onSubmit={(event) => { event.preventDefault(); void handleSave(); }} noValidate>
      <UnsavedChangesGuard dirty={dirty} />
      {preferences.consentSource === "MIGRATED_DEFAULT" && (
        <InlineNotice tone="neutral">Estas são as preferências padrão — ainda não personalizadas.</InlineNotice>
      )}
      <div className="notif-prefs__grid">
        <section className="ov-notification-card" aria-labelledby="notif-channels">
          <header><span><Bell size={20} aria-hidden="true" /></span><div><h2 id="notif-channels">Canais de notificação</h2><p>Controle os canais pelos quais você quer ser avisado.</p></div></header>
          <div className="ov-email-row">
            <Mail size={19} aria-hidden="true" />
            <div>
              <h3>E-mail</h3>
              <p>{preferences.emailEnabled ? "Canal padrão da sua conta" : "Desativado — contate o suporte para reativar"}</p>
              <p>{consentCopy(preferences.consentSource, preferences.createdAt, preferences.updatedAt)}</p>
            </div>
            {/* No real toggle here (e-mail is the mandatory channel) - the Switch always mirrors
                the REAL server value and is always disabled (deviation 1, file header). */}
            <Switch label="Ativado" checked={preferences.emailEnabled} onChange={() => {}} disabled />
          </div>
          <div className="ov-whatsapp">
            <MessageCircle size={19} aria-hidden="true" />
            <div>
              <h3>WhatsApp</h3>
              {whatsAppConfirmedPhone ? (
                <InlineNotice tone="success" announce="status">Número {whatsAppConfirmedPhone} confirmado. Você será avisado quando o WhatsApp estiver disponível.</InlineNotice>
              ) : whatsAppStep === "code-sent" ? (
                <>
                  <p>Enviamos um código para {whatsAppPhone} pelo WhatsApp.</p>
                  <TextField id="whatsapp-code" label="Código de confirmação" hideLabel value={whatsAppCode} onChange={setWhatsAppCode} error={whatsAppCodeError} placeholder="000000" autoComplete="one-time-code" />
                  <Button variant="secondary" size="sm" pending={confirmPhone.isPending} onClick={handleConfirmWhatsAppPhone}>{confirmPhone.isPending ? "Confirmando…" : "Confirmar"}</Button>
                  <Button variant="tertiary" size="sm" pending={requestConfirmation.isPending} onClick={handleResendWhatsAppCode}>{requestConfirmation.isPending ? "Reenviando…" : "Reenviar código"}</Button>
                </>
              ) : (
                <>
                  <p>Cadastre e verifique um número para receber avisos quando este canal estiver disponível.</p>
                  <TextField id="whatsapp-phone" label="Telefone" hideLabel value={whatsAppPhone} onChange={setWhatsAppPhone} error={whatsAppError} placeholder="+5511999999999" />
                  <Button variant="secondary" size="sm" pending={requestConfirmation.isPending} onClick={handleRequestWhatsAppConfirmation}>{requestConfirmation.isPending ? "Enviando…" : "Enviar código"}</Button>
                </>
              )}
            </div>
          </div>
        </section>
        <section className="ov-notification-card" aria-labelledby="quiet-hours">
          <header><span><Moon size={20} aria-hidden="true" /></span><div><h2 id="quiet-hours">Horário silencioso</h2><p>Defina um período sem envio de lembretes.</p></div></header>
          <div className="ov-quiet-illustration"><Moon size={27} aria-hidden="true" /><strong>Um intervalo para você se concentrar.</strong><p>Fora desse horário, os lembretes seguem suas preferências de canal.</p></div>
          <fieldset className="notif-prefs__quiet-hours-fields">
            <legend className="u-visually-hidden">Horário silencioso</legend>
            <TextField id="quiet-hours-start" label="Das" type="time" value={quietStart} onChange={(value) => { setQuietStart(value); setSaveState("idle"); }} error={startFieldError} />
            <span aria-hidden="true">até</span>
            <TextField id="quiet-hours-end" label="Até" type="time" value={quietEnd} onChange={(value) => { setQuietEnd(value); setSaveState("idle"); }} error={endFieldError} />
          </fieldset>
          <p className="ov-notification-help">Preencha os dois horários para ativar o intervalo. Um período que atravessa a meia-noite também é aceito.</p>
          {crossesMidnight && <p className="ov-notification-help">Este intervalo atravessa a meia-noite.</p>}
          {preferences.quietHours && !preferences.quietHours.enabled && <p className="ov-notification-help">O intervalo salvo está pausado.</p>}
        </section>
      </div>

      {conflict ? (
        <InlineNotice tone="warning" announce="alert" actions={<Button size="sm" variant="secondary" onClick={() => void handleReloadAfterConflict()}>Recarregar</Button>}>
          Suas preferências foram alteradas em outro lugar enquanto você editava. Recarregue para ver os valores atuais antes de salvar novamente.
          {reloadFailed ? " Não foi possível recarregar agora — tente novamente." : ""}
        </InlineNotice>
      ) : saveState === "unknown-outcome" ? (
        <InlineNotice tone="warning" announce="alert">Não sabemos se suas preferências foram salvas — verifique antes de tentar novamente.</InlineNotice>
      ) : saveState === "timezone-unavailable" ? (
        <InlineNotice tone="warning" announce="alert">Não foi possível detectar seu fuso horário automaticamente — não é seguro salvar o horário silencioso agora. Tente novamente ou recarregue a página.</InlineNotice>
      ) : saveState === "error" ? (
        <InlineNotice tone="critical" announce="alert">Não foi possível salvar suas preferências. Tente novamente.</InlineNotice>
      ) : null}

      <div className="notif-prefs__footer">
        <div><strong>Preferências pessoais</strong><p>Alterações feitas aqui se aplicam somente à sua conta.</p></div>
        <Button type="submit" variant="primary" icon={Check} pending={saving} disabled={Boolean(quietHoursError) || conflict}>{saveLabel}</Button>
      </div>
    </form>
  );
}
