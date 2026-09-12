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
import { InlineNotice } from "../components/ui/InlineNotice.js";
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

function MembersTable({ members, canManage, actorRole }: { members: Member[]; canManage: boolean; actorRole: MembershipRole | undefined }) {
  const changeRole = useChangeMemberRole();
  const removeMember = useRemoveMember();
  // Backend tier (authorization.ts comment on `membership:role-change`, OwnerTierChangeRequiresOwnerError):
  // ADMIN_ROLES may change roles in general, but ONLY an OWNER actor may promote a member TO OWNER or
  // demote a member FROM OWNER - the "OWNER, exceto quando o alvo/novo role é OWNER" carve-out that
  // isn't expressible in the generic authorize() matrix. An ADMIN actor gets the OWNER option filtered
  // out of the dropdown entirely (never a control they can even click, matching the read-only tab
  // treatment elsewhere) rather than a submit that predictably 409/403s against the backend check.
  const isOwnerActor = actorRole === "OWNER";
  function optionsFor(member: Member): typeof ROLE_OPTIONS {
    if (isOwnerActor) return ROLE_OPTIONS;
    if (member.role === "OWNER") return ROLE_OPTIONS.filter((option) => option.value === "OWNER");
    return ROLE_OPTIONS.filter((option) => option.value !== "OWNER");
  }

  const columns: DataTableColumn<Member>[] = [
    { key: "userId", header: "Usuário", primary: true, render: (m) => m.userId },
    {
      key: "role",
      header: "Papel",
      render: (m) =>
        canManage && (isOwnerActor || m.role !== "OWNER") ? (
          <SelectField
            label={`Papel de ${m.userId}`}
            value={m.role}
            options={optionsFor(m)}
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

  // Holistic frontend review finding: role-change/removal mutations had no error rendering at
  // all - a failed request (network, OCC conflict, backend authorization) previously disappeared
  // silently, with no distinct feedback that the action didn't take effect.
  const changeRoleError = changeRole.isError ? (changeRole.error instanceof ApiError ? changeRole.error.message : "Não foi possível alterar o papel deste membro.") : undefined;
  const removeMemberError = removeMember.isError ? (removeMember.error instanceof ApiError ? removeMember.error.message : "Não foi possível remover este membro.") : undefined;

  return (
    <>
      <DataTable caption="Membros ativos" columns={columns} rows={members} rowKey={(m) => m.userId} />
      {changeRoleError ? (
        <InlineNotice tone="critical" announce="alert">
          {changeRoleError}
        </InlineNotice>
      ) : null}
      {removeMemberError ? (
        <InlineNotice tone="critical" announce="alert">
          {removeMemberError}
        </InlineNotice>
      ) : null}
    </>
  );
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
        {members.length === 0 ? <EmptyState kind="true-empty" message="Nenhum membro ainda." /> : <MembersTable members={members} canManage={manage} actorRole={role} />}
      </Panel>
      {manage ? (
        <Section heading="Convites pendentes" headingId="pending-invitations">
          {/* Holistic frontend review finding: loading, error, and genuine-empty were all
              collapsed into "render nothing" (`invitationsQuery.data && ...length > 0`) - an
              admin who hit a load failure had no way to distinguish it from "no invitations". */}
          {invitationsQuery.isPending ? (
            <Panel>
              <CollectionSkeleton label="Carregando convites…" />
            </Panel>
          ) : invitationsQuery.isError ? (
            <Panel>
              <ErrorState
                message={invitationsQuery.error instanceof ApiError ? invitationsQuery.error.message : "Não foi possível carregar os convites pendentes."}
                onRetry={() => void invitationsQuery.refetch()}
              />
            </Panel>
          ) : invitationsQuery.data.invitations.length === 0 ? (
            <Panel>
              <EmptyState kind="true-empty" message="Nenhum convite pendente." />
            </Panel>
          ) : (
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
              {/* Holistic frontend review finding: revocation had no error rendering at all. */}
              {revokeInvitation.isError ? (
                <InlineNotice tone="critical" announce="alert">
                  {revokeInvitation.error instanceof ApiError ? revokeInvitation.error.message : "Não foi possível revogar este convite."}
                </InlineNotice>
              ) : null}
            </Panel>
          )}
        </Section>
      ) : null}
    </>
  );
}
