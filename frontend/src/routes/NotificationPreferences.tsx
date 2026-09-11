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
 *  4. **"Idioma dos lembretes" is shown with an explicit, honest note that it does not affect
 *     delivered content yet.** Codex review round 1 finding, confirmed real: `notification-
 *     router-workflow.ts` hard-codes `locale: "pt-BR"` on every render command regardless of this
 *     preference, and `email-templates.ts`'s own header comment confirms only pt-BR templates
 *     exist today. The control still exists (the spec asks for it, and the backend schema stores
 *     the value for whenever real localization ships) but this screen never implies it already
 *     changes what a user receives.
 *
 * **G5 (backend gap, non-blocking, named in the spec itself)**: `WhatsAppOptInService.recordOptIn()`
 * has no HTTP route yet (D-246) — WhatsApp is therefore never a working toggle here, only a
 * neutral `StatusBadge`. Reopen only once that route exists AND the legal prerequisites (E-019)
 * are resolved.
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
 * **Real, pre-existing gap, NOT introduced by this block**: `AppShell.tsx`'s `NavLink` has no
 * `end` prop, so a nested settings route (this one, and A20/A21/A22 before it) matches BOTH its
 * own nav item and the parent "Configurações" item's `aria-current="page"` simultaneously. Fixing
 * it means touching shared shell code affecting four existing screens at once - out of scope for
 * a single-screen block, named here rather than silently patched.
 */
import { useEffect, useRef, useState } from "react";
import { useNotificationPreferences } from "../hooks/useNotificationPreferences.js";
import { useUpdateNotificationPreferences } from "../hooks/useUpdateNotificationPreferences.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import { InitialLoading, ErrorState } from "../components/AsyncStates.js";
import { PageHeader, Panel } from "../components/ui/Layout.js";
import { InlineNotice } from "../components/ui/InlineNotice.js";
import { Checkbox } from "../components/ui/Checkbox.js";
import { StatusBadge } from "../components/ui/StatusBadge.js";
import { Button } from "../components/ui/Button.js";
import { SelectField } from "../components/forms/SelectField.js";
import { TextField } from "../components/forms/TextField.js";
import { isConflict, isAuthError, isUnknownOutcome } from "../api/errors.js";
import { formatAbsoluteDate } from "../api/presentation.js";
import type { NotificationConsentSource, NotificationQuietHours } from "../api/types.js";
import "./NotificationPreferences.css";

const LOCALE_OPTIONS = [
  { value: "pt-BR", label: "Português (Brasil)" },
  { value: "en-US", label: "English (US)" },
];

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
      <PageHeader title="Minhas preferências de notificação" description="Como você, pessoalmente, recebe lembretes. Não afeta outros usuários." />
      <PreferencesPanel key={organizationId ?? "none"} />
    </div>
  );
}

interface Snapshot {
  locale: string;
  quietStart: string;
  quietEnd: string;
}

function PreferencesPanel() {
  const query = useNotificationPreferences();
  const mutation = useUpdateNotificationPreferences();

  const [initialized, setInitialized] = useState(false);
  const [locale, setLocale] = useState("pt-BR");
  const [quietStart, setQuietStart] = useState("");
  const [quietEnd, setQuietEnd] = useState("");
  const [initialSnapshot, setInitialSnapshot] = useState<Snapshot>({ locale: "pt-BR", quietStart: "", quietEnd: "" });
  // Deviation 3 (file header) - the loaded record's own enabled/timeZone, preserved verbatim
  // across saves that don't touch the times at all.
  const [originalQuietMeta, setOriginalQuietMeta] = useState<{ enabled: boolean; timeZone: string } | undefined>(undefined);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [conflict, setConflict] = useState(false);
  const [reloadFailed, setReloadFailed] = useState(false);
  const successTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function hydrateFrom(quietHours: NotificationQuietHours | null, loadedLocale: string) {
    const start = quietHours?.startLocal ?? "";
    const end = quietHours?.endLocal ?? "";
    setLocale(loadedLocale);
    setQuietStart(start);
    setQuietEnd(end);
    setInitialSnapshot({ locale: loadedLocale, quietStart: start, quietEnd: end });
    setOriginalQuietMeta(quietHours ? { enabled: quietHours.enabled, timeZone: quietHours.timeZone } : undefined);
  }

  useEffect(() => {
    if (!initialized && query.data) {
      hydrateFrom(query.data.preferences.quietHours, query.data.preferences.locale);
      setInitialized(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialized, query.data]);

  useEffect(() => {
    return () => {
      if (successTimeoutRef.current) clearTimeout(successTimeoutRef.current);
    };
  }, []);

  const dirty = initialized && (locale !== initialSnapshot.locale || quietStart !== initialSnapshot.quietStart || quietEnd !== initialSnapshot.quietEnd);

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
      const { preferences: saved } = await mutation.mutateAsync({ emailEnabled: preferences.emailEnabled, locale, quietHours, expectedVersion: preferences.version });
      setInitialSnapshot({ locale, quietStart, quietEnd });
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
      hydrateFrom(result.data.preferences.quietHours, result.data.preferences.locale);
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
    <Panel padded>
      {preferences.consentSource === "MIGRATED_DEFAULT" ? (
        <InlineNotice tone="neutral">Estas são as preferências padrão — ainda não personalizadas.</InlineNotice>
      ) : null}

      <div className="notif-prefs__row">
        <div className="notif-prefs__row-label">
          <h3>E-mail</h3>
          <p className="u-text-secondary">{preferences.emailEnabled ? "Canal padrão da sua conta" : "Desativado — contate o suporte para reativar"}</p>
        </div>
        <div className="notif-prefs__row-control">
          <Checkbox label="Ativado" checked={preferences.emailEnabled} onChange={() => {}} disabled />
          <p className="u-text-secondary">{consentCopy(preferences.consentSource, preferences.createdAt, preferences.updatedAt)}</p>
        </div>
      </div>

      <div className="notif-prefs__row">
        <div className="notif-prefs__row-label">
          <h3>WhatsApp</h3>
          <p className="u-text-secondary">Indisponível no momento — sem rota de consentimento ainda</p>
        </div>
        <div className="notif-prefs__row-control">
          <StatusBadge presentation={{ label: "Indisponível", tone: "neutral" }} />
        </div>
      </div>

      <div className="notif-prefs__row">
        <div className="notif-prefs__row-label">
          <h3>Idioma dos lembretes</h3>
        </div>
        <div className="notif-prefs__row-control">
          <SelectField label="Idioma" value={locale} onChange={setLocale} options={LOCALE_OPTIONS} required />
          <p className="u-text-secondary">Ainda não afeta o conteúdo enviado — lembretes continuam em português.</p>
        </div>
      </div>

      <div className="notif-prefs__row">
        <div className="notif-prefs__row-label">
          <h3>Horário silencioso</h3>
          <p className="u-text-secondary">Nenhum lembrete enviado neste intervalo</p>
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
    </Panel>
    {/* Codex review round 2 MEDIUM finding, corrected: `position: sticky` on an element inside
        `Panel` never actually stuck - `.ui-panel` sets `overflow: hidden`, which makes the PANEL
        itself (not the page) the relevant scrolling ancestor, and the panel only ever grows to
        fit its own content. Rendering the footer as Panel's OWN SIBLING lets it stick against the
        real page scroll, matching the spec's "rodapé... permanece fixo/reachable" requirement. */}
      <div className="notif-prefs__footer">
        <Button variant="primary" pending={saving} disabled={Boolean(quietHoursError) || conflict} onClick={() => void handleSave()}>
          {saveLabel}
        </Button>
      </div>
    </>
  );
}
