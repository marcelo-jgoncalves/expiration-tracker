/**
 * Settings (Wave B2B-10 "settings" scope item) - Organization displayName/timezone, the one
 * writer this wave adds to the backend (`update-organization-settings.ts`, OWNER-only). Replaces
 * the honest `NotImplementedPlaceholder` this route previously rendered.
 */
import { useEffect, useState, type FormEvent } from "react";
import { useOrganizationsList } from "../hooks/useOrganizationsList.js";
import { useActiveOrganization } from "../auth/ActiveOrganizationContext.js";
import { useCurrentMembershipRole } from "../hooks/useCurrentMembershipRole.js";
import { useUpdateOrganizationSettings } from "../hooks/useUpdateOrganizationSettings.js";
import { useLeaveOrganization } from "../hooks/useLeaveOrganization.js";
import { useCloseOrganization } from "../hooks/useCloseOrganization.js";
import { ApiError, isConflict, isLastOwnerError, isResponsibilityReassignmentRequiredError } from "../api/errors.js";
import { CollectionSkeleton, ErrorState } from "../components/AsyncStates.js";
import { InlineNotice } from "../components/ui/InlineNotice.js";
import { PageHeader, Panel, Section } from "../components/ui/Layout.js";
import { Button } from "../components/ui/Button.js";
import { TextField } from "../components/forms/TextField.js";

/** Wave B2B-14 (D-120) - `handleLeaveOrganization` has been fully wired end-to-end (Lambda,
 * API Gateway route, proxy allowlist) since Wave B2B-8/D-099, but no frontend call site ever
 * existed. Visible to every role (not gated like the displayName form below, which is
 * OWNER-only) - the backend's own last-owner guard is the real authority on when leaving is
 * actually allowed, never re-implemented here. */
function LeaveOrganizationSection() {
  const leave = useLeaveOrganization();

  // D-122/D-125: minimal error-message parity for ResponsibilityReassignmentRequiredError, same
  // small polish D-120 did for LastOwnerError - no reassignment UI here (out of scope).
  const errorMessage = leave.isError
    ? isLastOwnerError(leave.error)
      ? "Você é o único Owner desta organização - promova outra pessoa a Owner antes de sair."
      : isResponsibilityReassignmentRequiredError(leave.error)
        ? "Você ainda é responsável por itens de vencimento ativos - reatribua-os antes de sair."
        : "Não foi possível sair da organização. Tente novamente."
    : undefined;

  return (
    <Section heading="Sair da organização" headingId="leave-organization">
      <Panel>
        <p>Você perderá o acesso a esta organização imediatamente.</p>
        <Button variant="danger" onClick={() => leave.mutate()} pending={leave.isPending}>
          {leave.isPending ? "Saindo…" : "Sair da organização"}
        </Button>
        {errorMessage ? (
          <InlineNotice tone="critical" announce="alert">
            {errorMessage}
          </InlineNotice>
        ) : null}
      </Panel>
    </Section>
  );
}

/**
 * W3-07 (D-124). Closing the organization starts a physical, irreversible purge of every piece of
 * tenant data - by far the most destructive action in the product, and unlike "leave", nothing
 * about it can be undone by an administrator afterwards.
 *
 * Confirmation shape (the one piece D-121 Rodada 1 explicitly left to UI judgment rather than the
 * protocol): type-to-confirm the organization id, not a two-step dialog. A dialog's second click
 * is muscle memory; typing the identifier requires the person to actually read WHICH organization
 * they are destroying, which is the failure mode that matters most here now that a user can belong
 * to several. The same token is re-validated server-side against the resolved organization
 * (`organization-lifecycle-handlers.ts`), so this is a real precondition and not UI theatre.
 *
 * OWNER-only visibility is a convenience, never the control: `organization:close` is OWNER_ROLES
 * in the authorization matrix and that check runs inside the service regardless of what the client
 * chooses to render - same posture as the displayName form below.
 */
function CloseOrganizationSection({ organizationId }: { organizationId: string }) {
  const close = useCloseOrganization();
  const [confirmation, setConfirmation] = useState("");
  const confirmed = confirmation.trim() === organizationId;

  if (close.isSuccess) {
    return (
      <Section heading="Encerrar organização" headingId="close-organization">
        <Panel>
          <InlineNotice tone="success" announce="status">
            Encerramento iniciado. Os dados desta organização serão apagados em definitivo; o acesso já foi encerrado.
          </InlineNotice>
        </Panel>
      </Section>
    );
  }

  return (
    <Section heading="Encerrar organização" headingId="close-organization">
      <Panel>
        <p>
          Esta ação apaga em definitivo todos os dados desta organização - vencimentos, documentos e histórico. Não há como desfazer nem recuperar depois.
        </p>
        <p>
          Para confirmar, digite o identificador da organização: <code>{organizationId}</code>
        </p>
        <TextField label="Identificador da organização" value={confirmation} onChange={setConfirmation} />
        <Button variant="danger" onClick={() => close.mutate(organizationId)} pending={close.isPending} disabled={!confirmed || close.isPending}>
          {close.isPending ? "Encerrando…" : "Encerrar organização definitivamente"}
        </Button>
        {close.isError ? (
          <InlineNotice tone="critical" announce="alert">
            {isConflict(close.error)
              ? "Esta organização já está sendo encerrada, já foi encerrada, ou está bloqueada - entre em contato com o suporte."
              : "Não foi possível encerrar a organização. Tente novamente."}
          </InlineNotice>
        ) : null}
      </Panel>
    </Section>
  );
}

export function Settings() {
  const { organizationId } = useActiveOrganization();
  const organizationsQuery = useOrganizationsList();
  const role = useCurrentMembershipRole();
  const update = useUpdateOrganizationSettings();

  const activeOrganization = organizationsQuery.data?.organizations.find((org) => org.organizationId === organizationId);
  const [displayName, setDisplayName] = useState("");

  // Rehydrates the form whenever the underlying organization data changes (initial load, or a
  // successful save elsewhere) - never overwrites in-progress typing on every render, only when
  // the SOURCE value itself changes. `exhaustive-deps` proposes `[activeOrganization]`, which
  // would re-run (and clobber in-progress typing) on every refetch even when displayName itself
  // is unchanged, since `organizationsQuery.data` is a fresh object reference each time.
  useEffect(() => {
    if (activeOrganization) setDisplayName(activeOrganization.displayName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrganization?.displayName]);

  const header = <PageHeader title="Configurações" description="Nome da sua organização." />;

  if (organizationsQuery.isPending) {
    return (
      <>
        {header}
        <Panel>
          <CollectionSkeleton label="Carregando configurações…" />
        </Panel>
      </>
    );
  }

  if (organizationsQuery.isError || !activeOrganization) {
    const message = organizationsQuery.error instanceof ApiError ? organizationsQuery.error.message : "Não foi possível carregar as configurações.";
    return (
      <>
        {header}
        <ErrorState message={message} onRetry={() => void organizationsQuery.refetch()} />
      </>
    );
  }

  if (role !== "OWNER") {
    return (
      <>
        {header}
        <Panel>
          <p>
            Organização: <strong>{activeOrganization.displayName}</strong>
          </p>
          <p>Somente o Owner da organização pode alterar essas configurações.</p>
        </Panel>
        <LeaveOrganizationSection />
      </>
    );
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!activeOrganization) return;
    // A version already returned by a previous successful save in THIS session takes
    // precedence over the list's (now stale) value - avoids a guaranteed OCC conflict on a
    // second consecutive save without a full page reload in between.
    const expectedVersion = update.data?.version ?? activeOrganization.version;
    update.mutate({ displayName, expectedVersion });
  }

  return (
    <>
      {header}
      <Panel>
        <form onSubmit={handleSubmit}>
          <TextField label="Nome da organização" value={displayName} onChange={setDisplayName} required />
          <Button type="submit" variant="primary" pending={update.isPending}>
            {update.isPending ? "Salvando…" : "Salvar"}
          </Button>
          {update.isSuccess ? (
            <InlineNotice tone="success" announce="status">
              Configurações atualizadas.
            </InlineNotice>
          ) : null}
          {update.isError ? (
            <InlineNotice tone="critical" announce="alert">
              {isConflict(update.error) ? "Alguém mais alterou a organização - recarregue a página e tente novamente." : "Não foi possível salvar as configurações."}
            </InlineNotice>
          ) : null}
        </form>
      </Panel>
      <LeaveOrganizationSection />
      <CloseOrganizationSection organizationId={activeOrganization.organizationId} />
    </>
  );
}
