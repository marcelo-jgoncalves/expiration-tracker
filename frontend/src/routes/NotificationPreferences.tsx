/**
 * A18 (Block 8, D-2xx) — Minhas preferências de notificação. `notification:configure`,
 * READ_ONLY_ROLES (every real role edits only their OWN preferences — this is not workspace
 * administration, distinct from A06's per-item/per-org Reminder Policy).
 *
 * Real, confirmed deviations from `A18-preferencias-notificacao.md` (the audited spec),
 * investigated directly against the backend/router before deciding how to adapt, never silently
 * (Codex review round 1, D-2xx, found and corrected two earlier, WRONG versions of deviations
 * 1 and the quiet-hours handling below — see each item's own note):
 *
 *  1. **The e-mail checkbox reflects the REAL `emailEnabled` value, always disabled (no toggle
 *     control exists on this screen), and the save payload always echoes it back UNCHANGED.**
 *     Codex review round 1 finding, corrected: an earlier version of this screen hard-coded the
 *     checkbox to checked and the payload to `emailEnabled: true` unconditionally, reasoning that
 *     e-mail is "the only mandatory channel." That reasoning missed a real backend behavior:
 *     `ses-callback-workflow.ts`'s `suppressEmailForRecipient()` sets `emailEnabled: false`
 *     PERMANENTLY after an SES complaint (spam report) - a real, deliberate safety mechanism.
 *     Hard-coding `true` on every save (even one that only changes locale) would silently
 *     UN-suppress a complaining address on the next save, risking sender reputation/SES
 *     throttling. This screen offers no control to change the value either way, but it must
 *     never assert or send something other than the truth it was given.
 *  2. **No in-app "unsaved changes" navigation guard.** The spec asks for a `ConfirmDialog` when
 *     navigating away with pending edits. This app's router (`App.tsx`) uses plain
 *     `<BrowserRouter>`/`<Routes>` (declarative mode) — `useBlocker` (the only way to intercept an
 *     in-app `<Link>` navigation) requires a data router (`createBrowserRouter`), a
 *     router-wide migration far outside this single-screen block's scope. What IS implemented:
 *     a `beforeunload` guard, covering the real subset achievable today (tab close/refresh/
 *     leaving the site) — named here as a real, scoped gap, not silently dropped, and recorded as
 *     a real pendency in `decisions-log.md` (D-268), not just this comment.
 *  3. **Quiet hours preserves the loaded record's own `enabled`/`timeZone` verbatim; this screen
 *     never flips `enabled` or re-detects the browser's timezone for an EXISTING window.**
 *     Codex review round 1 finding, corrected: an earlier version discarded `enabled`/`timeZone`
 *     on load and always sent `enabled: true` + the CURRENT browser's detected timezone on save -
 *     so saving any other field (e.g. just the locale) while travelling could silently move a
 *     saved `21:00–07:00` window to a different timezone, or silently re-enable a window the user
 *     had paused (`enabled: false`) without touching the times. The browser's timezone is
 *     detected (with a fallback if `Intl` throws) ONLY when the user fills in a window from
 *     genuinely empty (there is nothing prior to preserve).
 *  4. **REMOVED (2026-09-22, Marcelo): "Idioma dos lembretes" control.** It used to be shown with
 *     an explicit note that it did not affect delivered content yet — `notification-router-
 *     workflow.ts` hard-codes `locale: "pt-BR"` on every render command regardless of this
 *     preference, and `email-templates.ts`'s own header comment confirms only pt-BR templates
 *     exist today. Rather than keep offering a choice with zero real effect, the control was
 *     removed outright; `FIXED_LOCALE` below is sent on every save so the backend's own
 *     `required: ["emailEnabled", "locale"]` schema is still satisfied. Reinstate the picker only
 *     once real localized templates exist.
 *
 * **G5 CLOSED (2026-09-22, Marcelo)**: `POST /notifications/whatsapp-opt-in` shipped in D-286
 * (`preferences-handlers.ts`'s own doc comment confirms the route, allowlisted in
 * `proxy-allowlist.ts`) — this comment previously said "no HTTP route yet", which had gone stale.
 * The real remaining gap was purely this screen never calling it. Now wired: a phone field
 * (E.164, same pattern the backend schema validates) + "Ativar WhatsApp" button. Safe to expose
 * ahead of the legal prerequisite (E-019) — a separate kill-switch (`whatsappChannelEnabled`,
 * `notification-router.ts`) keeps every WhatsApp send inert regardless of opt-in state until that
 * flag flips, so recording consent now creates no real delivery risk. **Named, accepted gap**: no
 * GET endpoint exists for opt-in status (create-once POST only) — this screen cannot show
 * "already opted in" on load/reload, only an ephemeral confirmation right after a successful
 * submit in the same session. Never claims a persisted "ativado" state it cannot actually read.
 *
 * **Real backend gap, not implemented**: tenant-level channel entitlements
 * (`notification/domain/notification-entitlements.ts`) are never exposed via any HTTP route — the
 * spec's "Indisponibilidade por tenant vs. pessoal" section describes a UI state this screen has
 * no data to render. Since a tenant-level e-mail kill-switch is a real possibility this screen
 * cannot detect, its copy deliberately avoids an unconditional "always available" claim (says
 * "Canal padrão da sua conta" instead) rather than asserting something that could be false.
 *
 * **Known, accepted deviation from the spec's `aria-live="polite"` request**: quiet-hours field
 * errors use `TextField`'s existing `error` prop, which renders `role="alert"` (assertive) — the
 * shared primitive's own established behavior across every other screen that uses it. Changing
 * that convention ripples across every existing consumer and is out of this single block's scope;
 * assertive is a conservative (more, not less, noticeable) substitution for polite, not a broken
 * experience.
 *
 * **FIXED (2026-09-14, live `dev` bug report)**: the gap named here previously — `AppShell.tsx`'s
 * `NavLink` for "Configurações" had no `end` prop, so this nested settings route (and A20/A21/A22
 * before it) kept the parent "Configurações" item's `aria-current="page"` active even after
 * navigating to a DIFFERENT nested settings screen, clearing only once the user left the whole
 * `/settings/*` prefix entirely (e.g. via "Atividade") - never on first navigating away from THIS
 * screen to some plain sibling. Fixed at the root in `navigation.ts`/`AppShell.tsx`: `NavItem` now
 * carries an optional `end` flag, set `true` only for the top-level "settings" entry (the one
 * whose own path is a literal prefix of four other real nav items' paths) - this screen's own nav
 * highlighting is unaffected, it was never the item with the bug.
 */
import { useEffect, useRef, useState } from "react";
import { Bell, Check, Clock } from "lucide-react";
import { useNotificationPreferences } from "../hooks/useNotificationPreferences.js";
import { useUpdateNotificationPreferences } from "../hooks/useUpdateNotificationPreferences.js";
import { useWhatsAppOptIn } from "../hooks/useWhatsAppOptIn.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import { InitialLoading, ErrorState } from "../components/AsyncStates.js";
import { PageHeader, Panel, Section } from "../components/ui/Layout.js";
import { InlineNotice } from "../components/ui/InlineNotice.js";
import { Switch } from "../components/ui/Switch.js";
import { Button } from "../components/ui/Button.js";
import { TextField } from "../components/forms/TextField.js";
import { ApiError, isConflict, isAuthError, isUnknownOutcome } from "../api/errors.js";
import { formatAbsoluteDate } from "../api/presentation.js";
import type { NotificationConsentSource, NotificationQuietHours } from "../api/types.js";
import "./NotificationPreferences.css";

/** Único idioma real de conteúdo hoje (`email-templates.ts` só tem templates pt-BR,
 * `notification-router-workflow.ts` hard-codes `locale: "pt-BR"` em todo render command) —
 * removido o controle "Idioma dos lembretes" que antes oferecia uma escolha sem efeito real. */
const FIXED_LOCALE = "pt-BR";

// Codex review round 2 (D-2xx) MEDIUM finding, corrected: silently falling back to a fixed
// timezone (e.g. "America/Sao_Paulo") when detection fails would be WORSE than the failure it
// papers over - it would confidently apply the wrong timezone to a user elsewhere in the world.
// `undefined` here means "genuinely could not detect" and the caller must block save and say so,
// never guess.
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

type SaveState = "idle" | "saving" | "success" | "error" | "unknown-outcome" | "timezone-unavailable";

export function NotificationPreferences() {
  // Codex review round 1 (D-2xx) BLOQUEANTE finding, corrected: this screen used to keep its
  // local edit state across an organization switch (React Router reuses the component instance
  // across a `:orgId` param change) - a stale field from the PREVIOUS organization could be saved
  // against the NEW organization's version. Keying the panel by `organizationId` forces a full
  // remount (and therefore a fresh hydration from that organization's own query) on every switch.
  const { organizationId } = useActiveOrganization();
  return (
    <div className="notif-prefs">
      <PageHeader title="Notificações" description="Como você, pessoalmente, recebe lembretes. Não afeta outros usuários." />
      <PreferencesPanel key={organizationId ?? "none"} />
    </div>
  );
}

interface Snapshot {
  quietStart: string;
  quietEnd: string;
}

/** `+5511999999999` shape - mirrors `whatsapp-opt-in-request.v1.json`'s own pattern exactly
 * (`^\+[1-9]\d{1,14}$`), so a client-side rejection and the backend's real validation never
 * disagree about what counts as a valid number. */
const WHATSAPP_PHONE_PATTERN = /^\+[1-9]\d{1,14}$/;

function PreferencesPanel() {
  const query = useNotificationPreferences();
  const mutation = useUpdateNotificationPreferences();
  const whatsAppOptIn = useWhatsAppOptIn();

  const [whatsAppPhone, setWhatsAppPhone] = useState("");
  const [whatsAppError, setWhatsAppError] = useState<string | undefined>();
  const [whatsAppConfirmedPhone, setWhatsAppConfirmedPhone] = useState<string | undefined>();

  function handleWhatsAppOptIn() {
    const trimmed = whatsAppPhone.trim();
    if (!WHATSAPP_PHONE_PATTERN.test(trimmed)) {
      setWhatsAppError("Informe o telefone no formato internacional, ex.: +5511999999999.");
      return;
    }
    setWhatsAppError(undefined);
    whatsAppOptIn.mutate(trimmed, {
      onSuccess: () => {
        setWhatsAppConfirmedPhone(trimmed);
        setWhatsAppPhone("");
      },
      onError: (err) => {
        setWhatsAppError(err instanceof ApiError ? err.message : "Não foi possível ativar o WhatsApp com este número.");
      },
    });
  }

  const [initialized, setInitialized] = useState(false);
  const [quietStart, setQuietStart] = useState("");
  const [quietEnd, setQuietEnd] = useState("");
  const [initialSnapshot, setInitialSnapshot] = useState<Snapshot>({ quietStart: "", quietEnd: "" });
  // Deviation 3 (file header) - the loaded record's own enabled/timeZone, preserved verbatim
  // across saves that don't touch the times at all.
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
    if (!initialized && query.data) {
      hydrateFrom(query.data.preferences.quietHours);
      setInitialized(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized, query.data]);

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    };
  }, []);

  const dirty = initialized && (quietStart !== initialSnapshot.quietStart || quietEnd !== initialSnapshot.quietEnd);

  // Deviation 2 (file header) — the achievable subset of "warn before leaving with unsaved
  // changes" without a router migration: tab close/refresh/leaving the site entirely.
  useEffect(() => {
    function handler(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  if (query.isPending) return <InitialLoading label="Carregando preferências…" />;
  // `&& !query.data`: a background refetch failing (e.g. the automatic one this screen triggers
  // on an OCC conflict, see handleSave below) must never blow away an already-loaded form and the
  // user's in-progress edits - only a genuine "never loaded at all" failure shows the full-page
  // error state.
  if (query.isError && !query.data) return <ErrorState message="Não foi possível carregar suas preferências." onRetry={() => void query.refetch()} />;

  const preferences = query.data.preferences;
  const startSet = quietStart.trim() !== "";
  const endSet = quietEnd.trim() !== "";

  // Codex review round 1 MÉDIO finding, corrected: the validation message used to be attached
  // only to the "Até" field, even when "Das" was the one actually missing/at fault - now
  // attached to whichever field(s) the problem actually belongs to.
  let startFieldError: string | undefined;
  let endFieldError: string | undefined;
  if (startSet !== endSet) {
    const message = "Informe os dois horários do intervalo, ou deixe ambos em branco.";
    if (!startSet) startFieldError = message;
    else endFieldError = message;
  } else if (startSet && endSet && quietStart === quietEnd) {
    const message = "Intervalo precisa ter início e fim diferentes.";
    startFieldError = message;
    endFieldError = message;
  }
  const quietHoursError = startFieldError ?? endFieldError;
  const crossesMidnight = startSet && endSet && !quietHoursError && quietStart > quietEnd;

  // `undefined` (distinct from `null`, "no window") means a NEW window was requested but this
  // browser's timezone genuinely could not be detected - `handleSave` must block on this, never
  // silently substitute a guessed timezone (Codex review round 2 MEDIUM finding).
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
    if (quietHours === undefined) {
      setSaveState("timezone-unavailable");
      return;
    }
    setSaveState("saving");
    try {
      // Deviation 1 (file header) - always echo the REAL loaded value, never force `true`.
      const { preferences: saved } = await mutation.mutateAsync({ emailEnabled: preferences.emailEnabled, locale: FIXED_LOCALE, quietHours, expectedVersion: preferences.version });
      setInitialSnapshot({ quietStart, quietEnd });
      setOriginalQuietMeta(quietHours ? { enabled: quietHours.enabled, timeZone: quietHours.timeZone } : undefined);
      void saved; // cache already updated by the mutation hook itself (setQueryData, not just invalidate).
      setSaveState("success");
      successTimeoutRef.current = setTimeout(() => setSaveState("idle"), 2000);
    } catch (err) {
      if (isConflict(err)) {
        setConflict(true);
        setSaveState("idle");
        return;
      }
      if (isAuthError(err)) {
        setSaveState("error");
        return;
      }
      if (isUnknownOutcome(err)) {
        setSaveState("unknown-outcome");
        return;
      }
      setSaveState("error");
    }
  }

  // Codex review round 1 ALTO finding, corrected: a conflict used to only show a warning, never
  // actually reload the current server value - the next click could resend the SAME stale
  // version and conflict again indefinitely. This explicitly awaits a FRESH refetch (never trusts
  // whatever `query.data` happens to already hold, which could still be the stale pre-conflict
  // value if nothing else triggered a background refetch yet) before re-hydrating the form -
  // never silently overwrites the user's in-progress edits, only on this explicit action.
  async function handleReloadAfterConflict() {
    const result = await query.refetch();
    // Codex review round 2 HIGH finding, corrected: TanStack Query can keep the PREVIOUS
    // successful `data` around even when a refetch itself fails (`result.isError`) - checking
    // `result.data` alone would silently re-hydrate from the SAME stale value and clear the
    // conflict notice, letting the next save repeat the same 409 forever. Only a genuinely fresh,
    // successful result may clear the conflict state.
    if (result.isSuccess) {
      hydrateFrom(result.data.preferences.quietHours);
      setConflict(false);
      setReloadFailed(false);
    } else {
      setReloadFailed(true);
    }
  }

  const saving = saveState === "saving";
  // Codex review round 2 MEDIUM finding, corrected: "unknown-outcome" used to share the "Falhou —
  // tentar de novo" label with a genuine failure - falsely claiming certainty the app doesn't
  // have (the PUT may well have succeeded) and inviting a blind retry. Its own label asks the
  // user to check first instead of asserting failure.
  const saveLabel =
    saveState === "saving"
      ? "Salvando…"
      : saveState === "success"
        ? "Salvo"
        : saveState === "error"
          ? "Falhou — tentar de novo"
          : saveState === "unknown-outcome" || saveState === "timezone-unavailable"
            ? "Verificar antes de tentar de novo"
            : "Salvar preferências";

  return (
    <>
    {preferences.consentSource === "MIGRATED_DEFAULT" ? (
      <InlineNotice tone="neutral">Estas são as preferências padrão — ainda não personalizadas.</InlineNotice>
    ) : null}

    {/* 2026-09-23 (Marcelo): duas colunas lado a lado - Canais à esquerda, Horário silencioso à
        direita - em vez da coluna única que deixava a tela espremida contra um vazio enorme à
        direita do Panel (mesmo achado real de `SubjectForm.css`/`CreateItem.css`). */}
    <div className="notif-prefs__grid">
      <Section heading="Canais de notificação" headingId="notif-channels" icon={Bell}>
        <Panel padded>
          <div className="notif-prefs__row">
            <div className="notif-prefs__row-label">
              <h3>E-mail</h3>
              <p className="u-text-secondary">{preferences.emailEnabled ? "Canal padrão da sua conta" : "Desativado — contate o suporte para reativar"}</p>
            </div>
            <div className="notif-prefs__row-control">
              {/* Deviation 1 (file header) - still no real toggle here (e-mail is the mandatory
                  channel, A18 spec), only visually upgraded from Checkbox to the same Switch
                  component used for real toggles elsewhere (ItemReminderPolicy.tsx) for consistency. */}
              <Switch label="Ativado" checked={preferences.emailEnabled} onChange={() => {}} disabled />
              <p className="u-text-secondary">{consentCopy(preferences.consentSource, preferences.createdAt, preferences.updatedAt)}</p>
            </div>
          </div>

          <div className="notif-prefs__row">
            <div className="notif-prefs__row-label">
              <h3>WhatsApp</h3>
              <p className="u-text-secondary">Em breve. Cadastre seu número agora para ser avisado assim que o canal for liberado.</p>
            </div>
            <div className="notif-prefs__row-control">
              {whatsAppConfirmedPhone ? (
                <div className="notif-prefs__whatsapp-confirmed">
                  <InlineNotice tone="success" announce="status">
                    Número {whatsAppConfirmedPhone} registrado. Você será avisado quando o WhatsApp estiver disponível.
                  </InlineNotice>
                </div>
              ) : (
                <>
                  <div className="notif-prefs__whatsapp-phone">
                    <TextField
                      id="whatsapp-phone"
                      label="Telefone"
                      hideLabel
                      value={whatsAppPhone}
                      onChange={setWhatsAppPhone}
                      error={whatsAppError}
                      placeholder="+5511999999999"
                    />
                  </div>
                  <Button variant="secondary" size="sm" pending={whatsAppOptIn.isPending} onClick={handleWhatsAppOptIn}>
                    {whatsAppOptIn.isPending ? "Ativando…" : "Ativar WhatsApp"}
                  </Button>
                </>
              )}
            </div>
          </div>
        </Panel>
      </Section>

      <Section heading="Horário silencioso" headingId="quiet-hours" icon={Clock}>
        <Panel padded>
          <div className="notif-prefs__row">
            <div className="notif-prefs__row-label">
              <p className="u-text-secondary">Nenhum lembrete enviado neste intervalo.</p>
            </div>
            <div className="notif-prefs__row-control">
              <fieldset className="notif-prefs__quiet-hours-fields">
                <legend className="u-visually-hidden">Horário silencioso</legend>
                <TextField id="quiet-hours-start" label="Das" type="time" value={quietStart} onChange={setQuietStart} error={startFieldError} />
                <TextField id="quiet-hours-end" label="Até" type="time" value={quietEnd} onChange={setQuietEnd} error={endFieldError} />
              </fieldset>
              {crossesMidnight ? <p className="u-text-secondary">Este intervalo atravessa a meia-noite.</p> : null}
            </div>
          </div>
        </Panel>
      </Section>
    </div>

    {conflict ? (
      <InlineNotice
        tone="warning"
        announce="alert"
        actions={
          <Button size="sm" variant="secondary" onClick={() => void handleReloadAfterConflict()}>
            Recarregar
          </Button>
        }
      >
        Suas preferências foram alteradas em outro lugar enquanto você editava. Recarregue para ver os valores atuais antes de salvar novamente.
        {reloadFailed ? " Não foi possível recarregar agora — tente novamente." : ""}
      </InlineNotice>
    ) : saveState === "unknown-outcome" ? (
      <InlineNotice tone="warning" announce="alert">
        Não sabemos se suas preferências foram salvas — verifique antes de tentar novamente.
      </InlineNotice>
    ) : saveState === "timezone-unavailable" ? (
      <InlineNotice tone="warning" announce="alert">
        Não foi possível detectar seu fuso horário automaticamente — não é seguro salvar o horário silencioso agora. Tente novamente ou recarregue a página.
      </InlineNotice>
    ) : saveState === "error" ? (
      <InlineNotice tone="critical" announce="alert">
        Não foi possível salvar suas preferências. Tente novamente.
      </InlineNotice>
    ) : null}

    {/* Codex review round 2 MEDIUM finding, corrected: `position: sticky` on an element inside
        `Panel` never actually stuck - `.ui-panel` sets `overflow: hidden`, which makes the PANEL
        itself (not the page) the relevant scrolling ancestor, and the panel only ever grows to
        fit its own content. Rendering the footer as Panel's OWN SIBLING lets it stick against the
        real page scroll, matching the spec's "rodapé... permanece fixo/reachable" requirement. */}
      <div className="notif-prefs__footer">
        <Button variant="primary" icon={Check} pending={saving} disabled={Boolean(quietHoursError) || conflict} onClick={() => void handleSave()}>
          {saveLabel}
        </Button>
      </div>
    </>
  );
}
