import { useEffect, useState, type FormEvent } from "react";
import { Bell, Mail, MessageCircle, Moon, Settings2 } from "lucide-react";
import { useNotificationPreferences } from "../hooks/useNotificationPreferences.js";
import { useUpdateNotificationPreferences } from "../hooks/useUpdateNotificationPreferences.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import { InitialLoading, ErrorState } from "../components/AsyncStates.js";
import { PageHeader } from "../components/ui/Layout.js";
import { InlineNotice } from "../components/ui/InlineNotice.js";
import { Button } from "../components/ui/Button.js";
import { TextField } from "../components/forms/TextField.js";
import { UnsavedChangesGuard } from "../components/UnsavedChangesGuard.js";
import { ApiError, isConflict, isUnknownOutcome } from "../api/errors.js";
import type { NotificationPreferences as Preferences } from "../api/types.js";
import "./NotificationPreferences.css";

export function NotificationPreferences() {
  const { organizationId } = useActiveOrganization();
  useEffect(() => { document.title = "Notifica??es ? OmniVence"; }, []);
  return <div className="notif-prefs ov-notifications">
    <PageHeader title="Notifica??es" above={<span className="ov-eyebrow">Prefer?ncias pessoais</span>} description="Escolha como voc? recebe lembretes. Estas prefer?ncias n?o alteram as de outras pessoas." />
    <PreferencesPanel key={organizationId ?? "none"} />
  </div>;
}

function PreferencesPanel() {
  const query = useNotificationPreferences();
  if (query.isPending) return <InitialLoading label="Carregando prefer?ncias?" />;
  if (!query.data) return <ErrorState message="N?o foi poss?vel carregar suas prefer?ncias." onRetry={() => void query.refetch()} />;
  return <PreferencesForm initial={query.data.preferences} reload={async () => {
    const response = await query.refetch();
    if (!response.isSuccess) throw new Error("N?o foi poss?vel recarregar.");
    return response.data.preferences;
  }} />;
}

function PreferencesForm({ initial, reload }: { initial: Preferences; reload: () => Promise<Preferences> }) {
  const mutation = useUpdateNotificationPreferences();
  const [base, setBase] = useState(initial);
  const [email, setEmail] = useState(initial.emailEnabled);
  const [start, setStart] = useState(initial.quietHours?.startLocal ?? "");
  const [end, setEnd] = useState(initial.quietHours?.endLocal ?? "");
  const [failure, setFailure] = useState("");
  const [fieldError, setFieldError] = useState<"start" | "end">();
  const [conflict, setConflict] = useState(false);
  const [success, setSuccess] = useState(false);
  const timeZone = base.quietHours?.timeZone ?? "America/Sao_Paulo";
  const dirty = email !== base.emailEnabled || start !== (base.quietHours?.startLocal ?? "") || end !== (base.quietHours?.endLocal ?? "");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mutation.isPending || conflict) return;
    setSuccess(false); setFailure(""); setFieldError(undefined);
    if (Boolean(start) !== Boolean(end)) {
      setFailure("Preencha os dois hor?rios para definir o per?odo silencioso.");
      setFieldError(start ? "end" : "start");
      document.getElementById(start ? "quiet-hours-end" : "quiet-hours-start")?.focus();
      return;
    }
    if (start && start === end) {
      setFailure("Escolha hor?rios diferentes para o in?cio e o fim.");
      setFieldError("end"); document.getElementById("quiet-hours-end")?.focus(); return;
    }
    try {
      const result = await mutation.mutateAsync({ emailEnabled: email, locale: base.locale, expectedVersion: base.version,
        quietHours: start && end ? { enabled: start === base.quietHours?.startLocal && end === base.quietHours?.endLocal ? base.quietHours.enabled : true, startLocal: start, endLocal: end, timeZone } : null });
      setBase(result.preferences); setSuccess(true);
    } catch (error) {
      if (isConflict(error)) { setConflict(true); setFailure("Suas prefer?ncias mudaram em outra sess?o. Recarregue antes de salvar novamente."); }
      else setFailure(isUnknownOutcome(error) ? "N?o sabemos se suas prefer?ncias foram salvas. Verifique antes de tentar novamente." : error instanceof ApiError && error.category === "NETWORK" ? "N?o foi poss?vel conectar. Verifique sua conex?o e tente novamente." : "N?o foi poss?vel salvar as prefer?ncias agora. Tente novamente em alguns instantes.");
    }
  }
  async function reloadValues() {
    try {
      const fresh = await reload();
      setBase(fresh); setEmail(fresh.emailEnabled); setStart(fresh.quietHours?.startLocal ?? ""); setEnd(fresh.quietHours?.endLocal ?? "");
      setConflict(false); setFailure(""); setSuccess(false);
    } catch { setFailure("N?o foi poss?vel recarregar. Tente novamente."); }
  }
  return <form onSubmit={event => void submit(event)} noValidate>
    <UnsavedChangesGuard dirty={dirty} />
    <div className="ov-notification-notice"><Settings2 size={20} aria-hidden="true" /><div><strong>Suas prefer?ncias atuais</strong><p>{base.consentSource === "MIGRATED_DEFAULT" || base.consentSource === "ONBOARDING" ? "Voc? est? usando as configura??es padr?o. Personalize os canais e hor?rios abaixo." : "Estas s?o as prefer?ncias salvas para a sua conta."}</p></div></div>
    <div className="notif-prefs__grid">
      <section className="ov-notification-card" aria-labelledby="notif-channels">
        <header><span><Bell size={20} aria-hidden="true" /></span><div><h2 id="notif-channels">Canais de notifica??o</h2><p>Controle os canais pelos quais voc? quer ser avisado.</p></div></header>
        <div className="ov-email-row"><Mail size={19} aria-hidden="true" /><div><h3>E-mail</h3><p>Enviado ao endere?o associado ? sua conta.</p><span>{email ? "Ativado" : "Desativado"}</span></div>
          <label className="ov-email-switch"><input type="checkbox" aria-label="Receber lembretes por e-mail" checked={email} disabled={!base.emailEnabled || mutation.isPending} onChange={e => { setEmail(e.target.checked); setSuccess(false); }} /><span aria-hidden="true" /></label>
        </div>
        {!base.emailEnabled && <p className="ov-notification-help">Para reativar o e-mail, contate o suporte.</p>}
        <div className="ov-whatsapp"><MessageCircle size={19} aria-hidden="true" /><div><h3>WhatsApp</h3><p>Cadastre e verifique um n?mero para receber avisos quando este canal estiver dispon?vel.</p><p className="ov-notification-help">A verifica??o de n?mero ainda n?o est? dispon?vel para uso nesta tela.</p></div></div>
      </section>
      <section className="ov-notification-card" aria-labelledby="quiet-hours">
        <header><span><Moon size={20} aria-hidden="true" /></span><div><h2 id="quiet-hours">Hor?rio silencioso</h2><p>Defina um per?odo sem envio de lembretes.</p></div></header>
        <div className="ov-quiet-illustration"><Moon size={27} aria-hidden="true" /><strong>Um intervalo para voc? se concentrar.</strong><p>Fora desse hor?rio, os lembretes seguem suas prefer?ncias de canal.</p></div>
        <div className="notif-prefs__quiet-hours-fields">
          <TextField id="quiet-hours-start" label="Das" type="time" value={start} onChange={value => { setStart(value); setFieldError(undefined); setSuccess(false); }} error={fieldError === "start" ? failure : undefined} />
          <span aria-hidden="true">at?</span>
          <TextField id="quiet-hours-end" label="At?" type="time" value={end} onChange={value => { setEnd(value); setFieldError(undefined); setSuccess(false); }} error={fieldError === "end" ? failure : undefined} />
        </div>
        <p className="ov-notification-help">Preencha os dois hor?rios para ativar o intervalo. Um per?odo que atravessa a meia-noite tamb?m ? aceito.</p>
        <p className="ov-notification-help">Fuso hor?rio: {timeZone}</p>
        {base.quietHours && !base.quietHours.enabled && <p className="ov-notification-help">O intervalo salvo est? pausado.</p>}
      </section>
    </div>
    {failure && <InlineNotice tone="critical" announce="alert">{failure}{conflict && <Button onClick={() => void reloadValues()}>Recarregar</Button>}</InlineNotice>}
    {success && <InlineNotice tone="success" announce="status">Prefer?ncias salvas.</InlineNotice>}
    <div className="notif-prefs__footer"><div><strong>Prefer?ncias pessoais</strong><p>Altera??es feitas aqui se aplicam somente ? sua conta.</p></div><Button type="submit" variant="primary" pending={mutation.isPending} disabled={conflict}>{mutation.isPending ? "Salvando?" : "Salvar prefer?ncias"}</Button></div>
  </form>;
}
