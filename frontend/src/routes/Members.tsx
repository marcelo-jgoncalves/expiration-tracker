import { useEffect, useRef, useState, type FormEvent } from "react";
import { Users, UserPlus } from "lucide-react";
import { useMembers } from "../hooks/useMembers.js";
import { useInvitations } from "../hooks/useInvitations.js";
import { useInviteMember } from "../hooks/useInviteMember.js";
import { useRevokeInvitation } from "../hooks/useRevokeInvitation.js";
import { useChangeMemberRole } from "../hooks/useChangeMemberRole.js";
import { useRemoveMember } from "../hooks/useRemoveMember.js";
import { useCurrentMembershipRole } from "../hooks/useCurrentMembershipRole.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import { ApiError, isConflict, isResponsibilityReassignmentRequiredError } from "../api/errors.js";
import type { Member, MembershipRole, Invitation } from "../api/types.js";
import { presentMembershipRole } from "../api/presentation.js";
import { CollectionSkeleton, ErrorState } from "../components/AsyncStates.js";
import { InlineNotice } from "../components/ui/InlineNotice.js";
import { PageHeader } from "../components/ui/Layout.js";
import { Button } from "../components/ui/Button.js";
import { TextField } from "../components/forms/TextField.js";
import { SelectField } from "../components/forms/SelectField.js";
import { Dialog } from "../components/ui/Dialog.js";
import { OmniHero } from "../components/OmniHero.js";
import "./Members.css";

const ROLE_OPTIONS = (["MEMBER", "ADMIN", "VIEWER"] as MembershipRole[]).map(value => ({ value, label: presentMembershipRole(value) }));
function memberLabel(member: Member) { return member.displayName || member.email || "Membro sem nome disponível"; }

function InviteForm() {
  const invite = useInviteMember();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MembershipRole>("MEMBER");
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (invite.isPending) return;
    const input = formRef.current?.querySelector<HTMLInputElement>('input[type="email"]');
    if (input) input.value = email.trim();
    if (!email.trim() || !input?.validity.valid) { setError("Informe um e-mail válido."); input?.focus(); return; }
    setError(""); setSuccess("");
    const submittedEmail = email.trim();
    invite.mutate({ email: submittedEmail, role }, {
      onSuccess: () => { setSuccess("Convite criado para " + submittedEmail + "."); setEmail(""); },
      onError: failure => setError(failure instanceof ApiError && failure.category === "NETWORK" ? "Não foi possível conectar. Verifique sua conexão e tente novamente." : failure instanceof ApiError ? failure.message : "Não foi possível criar o convite. Tente novamente."),
    });
  }
  return <section className="ov-invite-card" aria-labelledby="invite-member">
    <span className="ov-members-icon"><UserPlus size={19} aria-hidden="true" /></span><h2 id="invite-member">Convidar novo membro</h2><p>Envie um convite para alguém colaborar nesta organização.</p>
    <form ref={formRef} onSubmit={submit} noValidate>
      <TextField label="E-mail" type="email" autoComplete="email" placeholder="nome@empresa.com.br" value={email} onChange={setEmail} error={error || undefined} required />
      <SelectField label="Papel" value={role} onChange={value => setRole(value as MembershipRole)} options={ROLE_OPTIONS} required />
      <p className="ov-members-help">O papel define o que a pessoa poderá fazer na organização.</p>
      <Button type="submit" variant="primary" pending={invite.isPending}>{invite.isPending ? "Enviando…" : "Enviar convite"}</Button>
      {success && <InlineNotice tone="success" announce="status">{success}</InlineNotice>}
    </form>
  </section>;
}

type MemberAction = { kind: "remove"; member: Member } | { kind: "role"; member: Member; next: MembershipRole };
function Roster({ members, canManage }: { members: Member[]; canManage: boolean }) {
  const { email } = useActiveOrganization();
  const changeRole = useChangeMemberRole();
  const remove = useRemoveMember();
  const [action, setAction] = useState<MemberAction>();
  const [failure, setFailure] = useState("");
  const pending = changeRole.isPending || remove.isPending;
  async function confirm() {
    if (!action || pending) return;
    setFailure("");
    try {
      if (action.kind === "role") await changeRole.mutateAsync({ userId: action.member.userId, role: action.next, expectedVersion: action.member.version });
      else await remove.mutateAsync({ userId: action.member.userId, expectedVersion: action.member.version });
      setAction(undefined);
      document.getElementById("active-members")?.focus();
    } catch (error) {
      setFailure(isResponsibilityReassignmentRequiredError(error) ? "Reatribua os vencimentos sob responsabilidade desta pessoa antes de removê-la." : isConflict(error) ? "Este membro foi alterado em outra sessão. Recarregue para revisar o papel atual." : "Não foi possível concluir a alteração. Tente novamente.");
    }
  }
  return <><ul className="ov-member-list">{members.map(member => {
    const current = Boolean(email && member.email?.toLowerCase() === email.toLowerCase());
    const editable = canManage && member.role !== "OWNER" && !current;
    const label = memberLabel(member);
    return <li key={member.userId}><span className="ov-member-avatar" aria-hidden="true">{label.slice(0, 1).toUpperCase()}</span>
      <div className="ov-member-identity"><strong>{member.email || label}</strong><span>{current ? "Você · acesso atual" : member.displayName || "Ativo"}</span></div>
      <div className="ov-member-role">{editable ? <select aria-label={"Papel de " + label} value={member.role} onChange={e => { setFailure(""); setAction({ kind: "role", member, next: e.target.value as MembershipRole }); }}>{ROLE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <strong>{presentMembershipRole(member.role)}</strong>}<span className="ov-member-status">Ativo</span></div>
      {editable && <Button variant="tertiary" size="sm" aria-label={"Remover " + label} onClick={() => { setFailure(""); setAction({ kind: "remove", member }); }}>Remover</Button>}
    </li>;
  })}</ul>
    {action && <Dialog title={action.kind === "role" ? "Alterar papel?" : "Remover membro?"} onClose={() => { if (!pending) setAction(undefined); }}>
      <Button disabled={pending} onClick={() => setAction(undefined)}>Cancelar</Button>
      <p>{action.kind === "remove" ? `“${memberLabel(action.member)}” perderá acesso a esta organização. Os dados da organização permanecerão nela.` : `O papel de “${memberLabel(action.member)}” mudará de ${presentMembershipRole(action.member.role)} para ${presentMembershipRole(action.next)}. As permissões de acesso serão atualizadas.`}</p>
      {failure && <InlineNotice tone="critical" announce="alert">{failure}</InlineNotice>}
      <Button variant={action.kind === "remove" ? "danger" : "primary"} pending={pending} onClick={() => void confirm()}>{action.kind === "remove" ? "Remover membro" : "Alterar papel"}</Button>
    </Dialog>}
  </>;
}

function PendingInvitations() {
  const query = useInvitations();
  const revoke = useRevokeInvitation();
  const [target, setTarget] = useState<Invitation>();
  const invitations = query.data?.invitations.filter(item => item.status === "PENDING") ?? [];
  return <section className="ov-pending-invitations" aria-labelledby="pending-invitations">
    <header className="ov-members-section-heading"><h2 id="pending-invitations" tabIndex={-1}>Convites pendentes {query.data && <span>{invitations.length}</span>}</h2><p>Acompanhe os convites que ainda não foram aceitos.</p></header>
    <div className="ov-members-list-card">
      {query.isPending ? <CollectionSkeleton label="Carregando convites…" /> : query.isError ? <ErrorState message="Não foi possível carregar os convites pendentes." onRetry={() => void query.refetch()} /> : !invitations.length ? <div className="ov-members-empty"><strong>Nenhum convite pendente</strong><p>Os próximos convites aparecerão aqui até serem aceitos.</p></div> :
        <ul className="ov-member-list">{invitations.map(invitation => <li key={invitation.invitationId}><span className="ov-member-avatar pending" aria-hidden="true">{invitation.emailNormalized.slice(0, 1).toUpperCase()}</span><div className="ov-member-identity"><strong>{invitation.emailNormalized}</strong><span>{presentMembershipRole(invitation.role)}</span></div><span className="ov-member-status pending">Pendente</span><Button size="sm" variant="tertiary" aria-label={"Cancelar convite para " + invitation.emailNormalized} onClick={() => { revoke.reset(); setTarget(invitation); }}>Cancelar convite</Button></li>)}</ul>}
    </div>
    {target && <Dialog title="Cancelar convite?" onClose={() => { if (!revoke.isPending) setTarget(undefined); }}>
      <Button disabled={revoke.isPending} onClick={() => setTarget(undefined)}>Cancelar</Button><p>O convite para “{target.emailNormalized}” deixará de poder ser aceito.</p>
      {revoke.isError && <InlineNotice tone="critical" announce="alert">Não foi possível cancelar o convite. Seu estado pode ter mudado; atualize a lista.</InlineNotice>}
      <Button variant="danger" pending={revoke.isPending} onClick={() => { if (!revoke.isPending) revoke.mutate(target.invitationId, { onSuccess: () => { setTarget(undefined); document.getElementById("pending-invitations")?.focus(); } }); }}>Cancelar convite</Button>
    </Dialog>}
  </section>;
}

function MembersContent() {
  const query = useMembers();
  const role = useCurrentMembershipRole();
  const manage = role === "OWNER" || role === "ADMIN";
  const members = [...(query.data?.members ?? [])].filter(member => member.status === "ACTIVE").sort((a, b) => memberLabel(a).localeCompare(memberLabel(b), "pt-BR") || a.userId.localeCompare(b.userId));
  return <>
    <OmniHero icon={Users} eyebrow="Seu espaço de trabalho" title="Acesso claro para cada pessoa da equipe." description="Convide membros, acompanhe pendências e revise permissões em um só lugar." summary={<><strong>{query.data ? members.length : "—"}</strong><span>{members.length === 1 ? "membro ativo" : "membros ativos"}</span></>} />
    <div className={manage ? "members__grid" : "ov-members-readonly"}>
      {manage && <InviteForm />}
      <div className="members__main">
        <section aria-labelledby="active-members"><header className="ov-members-section-heading"><h2 id="active-members" tabIndex={-1}>Membros ativos {query.data && <span>{members.length}</span>}</h2><p>Gerencie o acesso de quem já faz parte da organização.</p></header>
          <div className="ov-members-list-card">{query.isPending ? <CollectionSkeleton label="Carregando membros…" /> : query.isError ? <ErrorState message="Não foi possível carregar os membros." onRetry={() => void query.refetch()} /> : <Roster members={members} canManage={manage} />}</div>
        </section>
        {manage && <PendingInvitations />}
      </div>
    </div>
  </>;
}

export function Members() {
  const { organizationId } = useActiveOrganization();
  useEffect(() => { document.title = "Membros · OmniVence"; }, []);
  return <div className="ov-members"><PageHeader title="Membros" above={<span className="ov-eyebrow">Equipe e acessos</span>} description="Pessoas com acesso à sua organização e convites aguardando resposta." /><MembersContent key={organizationId} /></div>;
}
