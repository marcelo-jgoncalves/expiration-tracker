/**
 * Members (Wave B2B-10 "members"/"invitation"/"permission UX" scope items) - lists active
 * members and (ADMIN/OWNER only, matching the backend's `membership:list-invitations` tier)
 * pending invitations, with invite/role-change/remove actions gated by the current user's own
 * role. Frontend gating is convenience only - every mutation is independently re-checked by
 * the backend's `authorize()` (see `useCurrentMembershipRole.ts`'s doc comment).
 */
import { useState, type FormEvent } from "react";
import { useMembers } from "../hooks/useMembers.js";
import { useInvitations } from "../hooks/useInvitations.js";
import { useInviteMember } from "../hooks/useInviteMember.js";
import { useRevokeInvitation } from "../hooks/useRevokeInvitation.js";
import { useChangeMemberRole } from "../hooks/useChangeMemberRole.js";
import { useRemoveMember } from "../hooks/useRemoveMember.js";
import { useCurrentMembershipRole } from "../hooks/useCurrentMembershipRole.js";
import { ApiError } from "../api/errors.js";
import { isValidationError } from "../api/validation.js";
import type { Member, MembershipRole } from "../api/types.js";
import { CollectionSkeleton, ErrorState, EmptyState } from "../components/AsyncStates.js";
import { PageHeader, Panel, Section } from "../components/ui/Layout.js";
import { Button } from "../components/ui/Button.js";
import { DataTable, type DataTableColumn } from "../components/ui/DataTable.js";
import { TextField } from "../components/forms/TextField.js";
import { SelectField } from "../components/forms/SelectField.js";

const ROLE_OPTIONS: { value: MembershipRole; label: string }[] = [
  { value: "VIEWER", label: "Viewer" },
  { value: "MEMBER", label: "Member" },
  { value: "ADMIN", label: "Admin" },
  { value: "OWNER", label: "Owner" },
];

/** ADMIN/OWNER manage members - mirrors the backend's ADMIN_ROLES tier for
 * membership:invite/role-change/remove (Wave B2B-8). */
function canManageMembers(role: MembershipRole | undefined): boolean {
  return role === "ADMIN" || role === "OWNER";
}

function InviteForm() {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MembershipRole>("MEMBER");
  const invite = useInviteMember();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    invite.mutate({ email, role }, { onSuccess: () => setEmail("") });
  }

  const errorMessage = invite.isError
    ? invite.error instanceof ApiError && isValidationError(invite.error)
      ? "Verifique o e-mail informado."
      : invite.error instanceof ApiError
        ? invite.error.message
        : "Não foi possível enviar o convite."
    : undefined;

  return (
    <form onSubmit={handleSubmit}>
      <TextField label="E-mail" value={email} onChange={setEmail} required type="text" autoComplete="email" error={errorMessage} />
      <SelectField label="Papel" value={role} onChange={(value) => setRole(value as MembershipRole)} options={ROLE_OPTIONS} required />
      <Button type="submit" variant="primary" pending={invite.isPending}>
        {invite.isPending ? "Enviando…" : "Convidar"}
      </Button>
    </form>
  );
}

function MembersTable({ members, canManage }: { members: Member[]; canManage: boolean }) {
  const changeRole = useChangeMemberRole();
  const removeMember = useRemoveMember();

  const columns: DataTableColumn<Member>[] = [
    { key: "userId", header: "Usuário", primary: true, render: (m) => m.userId },
    {
      key: "role",
      header: "Papel",
      render: (m) =>
        canManage ? (
          <SelectField
            label={`Papel de ${m.userId}`}
            value={m.role}
            options={ROLE_OPTIONS}
            onChange={(value) => changeRole.mutate({ userId: m.userId, role: value as MembershipRole, expectedVersion: m.version })}
          />
        ) : (
          m.role
        ),
    },
    { key: "status", header: "Status", render: (m) => m.status },
    {
      key: "actions",
      header: "Ações",
      render: (m) =>
        canManage ? (
          <Button variant="danger" size="sm" onClick={() => removeMember.mutate({ userId: m.userId, expectedVersion: m.version })} pending={removeMember.isPending}>
            Remover
          </Button>
        ) : null,
    },
  ];

  return <DataTable caption="Membros ativos" columns={columns} rows={members} rowKey={(m) => m.userId} />;
}

export function Members() {
  const membersQuery = useMembers();
  const invitationsQuery = useInvitations();
  const role = useCurrentMembershipRole();
  const manage = canManageMembers(role);
  const revokeInvitation = useRevokeInvitation();

  const header = <PageHeader title="Membros" description="Pessoas com acesso a esta organização." />;

  if (membersQuery.isPending) {
    return (
      <>
        {header}
        <Panel>
          <CollectionSkeleton label="Carregando membros…" />
        </Panel>
      </>
    );
  }

  if (membersQuery.isError) {
    const message = membersQuery.error instanceof ApiError ? membersQuery.error.message : "Não foi possível carregar os membros.";
    return (
      <>
        {header}
        <ErrorState message={message} onRetry={() => void membersQuery.refetch()} />
      </>
    );
  }

  const members = membersQuery.data.members;

  return (
    <>
      {header}
      {manage ? (
        <Section heading="Convidar novo membro" headingId="invite-member">
          <Panel>
            <InviteForm />
          </Panel>
        </Section>
      ) : null}
      <Panel>
        {members.length === 0 ? <EmptyState kind="true-empty" message="Nenhum membro ainda." /> : <MembersTable members={members} canManage={manage} />}
      </Panel>
      {manage && invitationsQuery.data && invitationsQuery.data.invitations.length > 0 ? (
        <Section heading="Convites pendentes" headingId="pending-invitations">
          <Panel>
            <DataTable
              caption="Convites pendentes"
              columns={[
                { key: "email", header: "E-mail", primary: true, render: (i) => i.emailNormalized },
                { key: "role", header: "Papel", render: (i) => i.role },
                { key: "status", header: "Status", render: (i) => i.status },
                {
                  key: "actions",
                  header: "Ações",
                  render: (i) => (
                    <Button variant="tertiary" size="sm" onClick={() => revokeInvitation.mutate(i.invitationId)} pending={revokeInvitation.isPending}>
                      Revogar
                    </Button>
                  ),
                },
              ]}
              rows={invitationsQuery.data.invitations}
              rowKey={(i) => i.invitationId}
            />
          </Panel>
        </Section>
      ) : null}
    </>
  );
}
