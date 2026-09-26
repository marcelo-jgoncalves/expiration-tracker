import { useEffect, useState, type FormEvent } from "react";
import { Building2, HardDrive, IdCard, LogOut, Trash2 } from "lucide-react";
import { useOrganizationsList } from "../hooks/useOrganizationsList.js";
import { useMembers } from "../hooks/useMembers.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import { useUpdateOrganizationSettings } from "../hooks/useUpdateOrganizationSettings.js";
import { useLeaveOrganization } from "../hooks/useLeaveOrganization.js";
import { useCloseOrganization } from "../hooks/useCloseOrganization.js";
import { useStorageQuota } from "../hooks/useStorageQuota.js";
import { ApiError, isConflict, isLastOwnerError, isResponsibilityReassignmentRequiredError } from "../api/errors.js";
import { CollectionSkeleton, ErrorState } from "../components/AsyncStates.js";
import { InlineNotice } from "../components/ui/InlineNotice.js";
import { PageHeader, Panel, Section } from "../components/ui/Layout.js";
import { Button } from "../components/ui/Button.js";
import { TextField } from "../components/forms/TextField.js";
import { Dialog } from "../components/ui/Dialog.js";
import { UnsavedChangesGuard } from "../components/UnsavedChangesGuard.js";
import type { UsableOrganization } from "../api/session.js";
import { FALLBACK_DEFAULT_LOCAL_TIME } from "../lib/reminderDefaults.js";
import "./Settings.css";

export function formatStorageBytes(bytes: number): string {
  if (bytes < 1024) return bytes.toLocaleString("pt-BR") + " B";
  const units = ["KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1);
  return (bytes / 1024 ** (index + 1)).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + " " + units[index];
}

function StorageSection() {
  const query = useStorageQuota();
  const usage = query.data?.usage;
  const used = usage ? usage.usedBytes + usage.reservedBytes : 0;
  const finiteQuota = usage && Number.isFinite(usage.limitBytes) && usage.limitBytes > 0;
  const percent = finiteQuota ? used / usage.limitBytes * 100 : undefined;
  return <Section heading="Armazenamento" headingId="storage-usage" description="Acompanhe o espaço usado pelos arquivos da organização." icon={HardDrive}>
    <Panel padded>
      {query.isPending ? <CollectionSkeleton rows={1} label="Carregando uso de armazenamento…" /> : query.isError || !usage ? <ErrorState message="Não foi possível carregar o uso de armazenamento." onRetry={() => void query.refetch()} /> :
        <><div className="ov-storage-summary"><strong>{formatStorageBytes(used)}{finiteQuota ? " de " + formatStorageBytes(usage.limitBytes) : ""} utilizados</strong>{percent !== undefined && <span>{percent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% utilizado</span>}</div>
          {percent !== undefined && <progress value={Math.max(0, Math.min(percent, 100))} max={100} aria-label="Percentual de armazenamento utilizado" />}
          <p>{finiteQuota ? formatStorageBytes(Math.max(0, usage.limitBytes - used)) + " disponíveis" : "Limite de armazenamento não disponível."}</p>
          {usage.warningLevel === "OVER" && <InlineNotice tone="critical">Novos uploads bloqueados até liberar espaço — arquivos existentes não são afetados.</InlineNotice>}
        </>}
    </Panel>
  </Section>;
}

function OrganizationActions({ organization }: { organization: UsableOrganization }) {
  const leave = useLeaveOrganization();
  const close = useCloseOrganization();
  const members = useMembers();
  const [action, setAction] = useState<"leave" | "close">();
  const [confirmation, setConfirmation] = useState("");
  const pending = leave.isPending || close.isPending;
  const lastOwner = organization.role === "OWNER" && members.data?.members.filter(member => member.status === "ACTIVE" && member.role === "OWNER").length === 1;
  const error = action === "leave" ? leave.error : close.error;
  const message = isLastOwnerError(error) ? "Você é o único Owner desta organização. Promova outra pessoa a Owner antes de sair." : isResponsibilityReassignmentRequiredError(error) ? "Você ainda é responsável por vencimentos ativos. Reatribua-os antes de sair." : isConflict(error) ? "A organização foi alterada ou já está em encerramento. Recarregue antes de continuar." : "Não foi possível concluir a operação. Tente novamente.";
  return <section className="ov-organization-actions" aria-labelledby="important-actions">
    <span className="ov-eyebrow">Gerenciamento da organização</span><h2 id="important-actions">Ações importantes</h2><p>Confira os efeitos antes de alterar seu acesso ou encerrar a organização.</p>
    <div className="ov-organization-action-grid">
      <article><LogOut aria-hidden="true" /><h3>Sair da organização</h3><p>Você perderá o acesso a esta organização. Os dados e demais membros permanecerão nela.</p>{lastOwner && <p>Você é o único Owner. Promova outra pessoa a Owner antes de sair.</p>}<Button variant="secondary" disabled={lastOwner} onClick={() => setAction("leave")}>Sair da organização</Button></article>
      {organization.role === "OWNER" && <article><Trash2 aria-hidden="true" /><h3>Encerrar organização</h3><p>O acesso será bloqueado e os dados ficarão em recuperação por 30 dias. Após esse prazo, a exclusão definitiva será iniciada. Para solicitar recuperação durante o prazo, contate o suporte.</p><Button variant="secondary" onClick={() => { setConfirmation(""); setAction("close"); }}>Encerrar organização</Button></article>}
    </div>
    {action && <Dialog title={action === "leave" ? "Sair da organização?" : "Encerrar organização?"} onClose={() => { if (!pending) setAction(undefined); }}>
      <Button disabled={pending} onClick={() => setAction(undefined)}>Cancelar</Button>
      <p>{action === "leave" ? `Você perderá o acesso à organização “${organization.displayName}”. Os dados e demais membros permanecerão nela.` : `O acesso de todos os membros de “${organization.displayName}” será bloqueado. Os dados serão mantidos por 30 dias para recuperação e depois entrarão em exclusão definitiva.`}</p>
      {action === "close" && <><p>Identificador: <code>{organization.organizationId}</code></p><TextField label="Identificador da organização" value={confirmation} onChange={setConfirmation} required /></>}
      {Boolean(error) && <InlineNotice tone="critical" announce="alert">{message}</InlineNotice>}
      {close.isSuccess && <InlineNotice tone="success" announce="status">Encerramento solicitado. O processo de recuperação e exclusão foi iniciado.</InlineNotice>}
      <Button variant="danger" pending={pending} disabled={action === "close" && (confirmation !== organization.organizationId || close.isSuccess)} onClick={() => { if (pending) return; if (action === "leave") leave.mutate(); else close.mutate(organization.organizationId); }}>{pending ? "Processando…" : action === "leave" ? "Sair da organização" : "Encerrar organização"}</Button>
    </Dialog>}
  </section>;
}

function OrganizationForm({ organization, reload }: { organization: UsableOrganization; reload: () => void }) {
  const update = useUpdateOrganizationSettings();
  const [base, setBase] = useState(organization);
  const [name, setName] = useState(organization.displayName);
  // Item 11 adversarial review (2026-09-25) real finding: an empty string here failed the
  // HH:mm validation below, blocking ANY save (even an unrelated displayName edit) for an
  // organization created before this feature existed (`defaultReminderLocalTime` absent) -
  // the same fallback the rest of the app already uses for that case, not a real default.
  const [time, setTime] = useState(organization.defaultReminderLocalTime ?? FALLBACK_DEFAULT_LOCAL_TIME);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const dirty = name !== base.displayName || time !== (base.defaultReminderLocalTime ?? FALLBACK_DEFAULT_LOCAL_TIME);
  const editable = organization.role === "OWNER";
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (update.isPending || !editable) return;
    const errors: Record<string, string> = {};
    if (!name.trim()) errors["name"] = "Informe o nome da organização.";
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) errors["time"] = "Selecione um horário válido para os novos lembretes.";
    setFieldErrors(errors);
    if (Object.keys(errors).length) { document.getElementById(errors["name"] ? "organization-name" : "organization-time")?.focus(); return; }
    try {
      const saved = await update.mutateAsync({ displayName: name.trim(), defaultReminderLocalTime: time, expectedVersion: base.version });
      setBase({ ...base, ...saved }); setName(saved.displayName); setTime(saved.defaultReminderLocalTime ?? time);
    } catch { /* The mutation exposes the failure without discarding local values. */ }
  }
  return <>
    <UnsavedChangesGuard dirty={dirty} />
    <div className="ov-organization-context"><Building2 aria-hidden="true" /><div><strong>{base.displayName}</strong><span>Organização atual</span></div></div>
    <Section heading="Dados da organização" headingId="organization-settings" description="Informações que identificam seu espaço de trabalho." icon={IdCard}>
      <Panel>
        {editable ? <form onSubmit={event => void submit(event)} noValidate>
          <div className="ov-settings-fields"><TextField id="organization-name" label="Nome da organização" value={name} onChange={setName} required hint="Este nome aparece para os membros da organização." error={fieldErrors["name"]} maxLength={200} />
            <TextField id="organization-time" type="time" label="Horário padrão de novos lembretes" value={time} onChange={setTime} required hint="Usado ao criar um lembrete, salvo quando outro horário for escolhido." error={fieldErrors["time"]} /></div>
          <div className="ov-settings-save"><p>As alterações se aplicam à sua organização.</p><Button type="submit" variant="primary" pending={update.isPending}>{update.isPending ? "Salvando…" : "Salvar alterações"}</Button></div>
          {update.isSuccess && !dirty && <InlineNotice tone="success" announce="status">Configurações salvas.</InlineNotice>}
          {update.isError && <InlineNotice tone="critical" announce="alert">{isConflict(update.error) ? "As configurações mudaram em outra sessão. Recarregue para revisar os valores atuais." : update.error instanceof ApiError && update.error.category === "NETWORK" ? "Não foi possível conectar. Verifique sua conexão e tente novamente." : "Não foi possível salvar as configurações agora. Tente novamente em alguns instantes."}{isConflict(update.error) && <Button onClick={reload}>Recarregar</Button>}</InlineNotice>}
        </form> : <div className="ov-settings-fields"><div><strong>Nome da organização</strong><p>{base.displayName}</p></div><div><strong>Horário padrão de novos lembretes</strong><p>{base.defaultReminderLocalTime ?? "Não configurado"}</p></div><p>Somente o Owner da organização pode alterar essas configurações.</p></div>}
      </Panel>
    </Section>
  </>;
}

export function Settings() {
  const { organizationId } = useActiveOrganization();
  const organizations = useOrganizationsList();
  const active = organizations.data?.organizations.find(org => org.organizationId === organizationId);
  const [revision, setRevision] = useState(0);
  useEffect(() => { document.title = "Configurações · OmniVence"; }, []);
  return <div className="ov-settings">
    <PageHeader title="Configurações" above={<span className="ov-eyebrow">Administração</span>} description="Gerencie os dados, os lembretes e o armazenamento da sua organização." />
    {organizations.isPending ? <CollectionSkeleton label="Carregando configurações…" /> : !active ? <ErrorState message="Não foi possível carregar as configurações." onRetry={() => void organizations.refetch()} /> : <>
      <OrganizationForm key={organizationId + ":" + revision} organization={active} reload={() => { void organizations.refetch().then(result => { if (result.isSuccess) setRevision(value => value + 1); }); }} />
      <StorageSection /><OrganizationActions key={organizationId} organization={active} />
    </>}
  </div>;
}
