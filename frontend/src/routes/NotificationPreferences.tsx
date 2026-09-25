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
  useEffect(() => { document.title = "Notificações · OmniVence"; }, []);
  return <div className="notif-prefs ov-notifications">
    <PageHeader title="Notificações" above={<span className="ov-eyebrow">Preferências pessoais</span>} description="Escolha como você recebe lembretes. Estas preferências não alteram as de outras pessoas." />
    <PreferencesPanel key={organizationId ?? "none"} />
  </div>;
}

function PreferencesPanel() {
  const query = useNotificationPreferences();
  if (query.isPending) return <InitialLoading label="Carregando preferências…" />;
  if (!query.data) return <ErrorState message="Não foi possível carregar suas preferências." onRetry={() => void query.refetch()} />;
  return <PreferencesForm initial={query.data.preferences} reload={async () => {
    const response = await query.refetch();
    if (!response.isSuccess) throw new Error("Não foi possível recarregar.");
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
      setFailure("Preencha os dois horários para definir o período silencioso.");
      setFieldError(start ? "end" : "start");
      document.getElementById(start ? "quiet-hours-end" : "quiet-hours-start")?.focus();
      return;
    }
    if (start && start === end) {
      setFailure("Escolha horários diferentes para o início e o fim.");
      setFieldError("end"); document.getElementById("quiet-hours-end")?.focus(); return;
    }
    try {
      const result = await mutation.mutateAsync({ emailEnabled: email, locale: base.locale, expectedVersion: base.version,
        quietHours: start && end ? { enabled: start === base.quietHours?.startLocal && end === base.quietHours?.endLocal ? base.quietHours.enabled : true, startLocal: start, endLocal: end, timeZone } : null });
      setBase(result.preferences); setSuccess(true);
    } catch (error) {
      if (isConflict(error)) { setConflict(true); setFailure("Suas preferências mudaram em outra sessão. Recarregue antes de salvar novamente."); }
      else setFailure(isUnknownOutcome(error) ? "Não sabemos se suas preferências foram salvas. Verifique antes de tentar novamente." : error instanceof ApiError && error.category === "NETWORK" ? "Não foi possível conectar. Verifique sua conexão e tente novamente." : "Não foi possível salvar as preferências agora. Tente novamente em alguns instantes.");
    }
  }
  async function reloadValues() {
    try {
      const fresh = await reload();
      setBase(fresh); setEmail(fresh.emailEnabled); setStart(fresh.quietHours?.startLocal ?? ""); setEnd(fresh.quietHours?.endLocal ?? "");
      setConflict(false); setFailure(""); setSuccess(false);
    } catch { setFailure("Não foi possível recarregar. Tente novamente."); }
  }
  return <form onSubmit={event => void submit(event)} noValidate>
    <UnsavedChangesGuard dirty={dirty} />
    <div className="ov-notification-notice"><Settings2 size={20} aria-hidden="true" /><div><strong>Suas preferências atuais</strong><p>{base.consentSource === "MIGRATED_DEFAULT" || base.consentSource === "ONBOARDING" ? "Você está usando as configurações padrão. Personalize os canais e horários abaixo." : "Estas são as preferências salvas para a sua conta."}</p></div></div>
    <div className="notif-prefs__grid">
      <section className="ov-notification-card" aria-labelledby="notif-channels">
        <header><span><Bell size={20} aria-hidden="true" /></span><div><h2 id="notif-channels">Canais de notificação</h2><p>Controle os canais pelos quais você quer ser avisado.</p></div></header>
        <div className="ov-email-row"><Mail size={19} aria-hidden="true" /><div><h3>E-mail</h3><p>Enviado ao endereço associado à sua conta.</p><span>{email ? "Ativado" : "Desativado"}</span></div>
          <label className="ov-email-switch"><input type="checkbox" role="switch" aria-label="Receber lembretes por e-mail" checked={email} disabled={!base.emailEnabled || mutation.isPending} onChange={e => { setEmail(e.target.checked); setSuccess(false); }} /><span aria-hidden="true" /></label>
        </div>
        {!base.emailEnabled && <p className="ov-notification-help">Para reativar o e-mail, contate o suporte.</p>}
        <div className="ov-whatsapp"><MessageCircle size={19} aria-hidden="true" /><div><h3>WhatsApp</h3><p>Cadastre e verifique um número para receber avisos quando este canal estiver disponível.</p><p className="ov-notification-help">A verificação de número ainda não está disponível para uso nesta tela.</p></div></div>
      </section>
      <section className="ov-notification-card" aria-labelledby="quiet-hours">
        <header><span><Moon size={20} aria-hidden="true" /></span><div><h2 id="quiet-hours">Horário silencioso</h2><p>Defina um período sem envio de lembretes.</p></div></header>
        <div className="ov-quiet-illustration"><Moon size={27} aria-hidden="true" /><strong>Um intervalo para você se concentrar.</strong><p>Fora desse horário, os lembretes seguem suas preferências de canal.</p></div>
        <div className="notif-prefs__quiet-hours-fields">
          <TextField id="quiet-hours-start" label="Das" type="time" value={start} onChange={value => { setStart(value); setFieldError(undefined); setSuccess(false); }} error={fieldError === "start" ? failure : undefined} />
          <span aria-hidden="true">até</span>
          <TextField id="quiet-hours-end" label="Até" type="time" value={end} onChange={value => { setEnd(value); setFieldError(undefined); setSuccess(false); }} error={fieldError === "end" ? failure : undefined} />
        </div>
        <p className="ov-notification-help">Preencha os dois horários para ativar o intervalo. Um período que atravessa a meia-noite também é aceito.</p>
        <p className="ov-notification-help">Fuso horário: {timeZone}</p>
        {base.quietHours && !base.quietHours.enabled && <p className="ov-notification-help">O intervalo salvo está pausado.</p>}
      </section>
    </div>
    {failure && <InlineNotice tone="critical" announce="alert">{failure}{conflict && <Button onClick={() => void reloadValues()}>Recarregar</Button>}</InlineNotice>}
    {success && <InlineNotice tone="success" announce="status">Preferências salvas.</InlineNotice>}
    <div className="notif-prefs__footer"><div><strong>Preferências pessoais</strong><p>Alterações feitas aqui se aplicam somente à sua conta.</p></div><Button type="submit" variant="primary" pending={mutation.isPending} disabled={conflict}>{mutation.isPending ? "Salvando…" : "Salvar preferências"}</Button></div>
  </form>;
}
