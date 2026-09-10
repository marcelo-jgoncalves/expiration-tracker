/**
 * A09 — Hub do fornecedor (Block 3, D-2xx). Replaces the narrow BLOCKER-C `SubjectDetail`
 * (legacy `RequirementAssignment` review queue, A10's domain) with the full hub per the
 * post-audit spec: Compliance panel (SLF-01-adjacent composition, `MetricCardGrid` for the
 * destination-cards grid), `subject:delete` surface (was missing pre-audit), links to A11
 * (filtered), A12 documents (degrades to A11 until a dedicated Documents Collection exists -
 * same spec-named fallback), A14 requests, dossier export (`docarchive:dossier-export`,
 * ADMIN_ROLES exclusive, D-205 - no assignee exception), and A10's "Rastreamento legado" card.
 *
 * A10 (Legacy Tracked Requirements) has an audited SPEC but no implemented frontend screen yet
 * (Block 7 of the sequencing plan, not built in this block) - the legacy RequirementAssignment
 * review workflow the OLD SubjectDetail rendered inline has no route to land on today. Per the
 * spec's own instruction ("Se A10 ainda não estiver implementada, o card aparece com estado 'Em
 * breve' desabilitado, não removido"), the card here is disabled rather than linking to a route
 * that would 404 - this is the spec's own named fallback, not an improvised gap.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useOrgPath } from "../../routing/useOrgPath.js";
import { useSubject } from "../../hooks/useSubject.js";
import { useSubjectCompliance } from "../../hooks/useSubjectCompliance.js";
import { useRequirementsForSubject } from "../../hooks/useRequirementsForSubject.js";
import { useDeleteSubject } from "../../hooks/useDeleteSubject.js";
import { useCurrentMembershipRole } from "../../hooks/useCurrentMembershipRole.js";
import { InitialLoading, ErrorState, EmptyState } from "../../components/AsyncStates.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";
import { MetricCardGrid, type MetricCardData } from "../../components/MetricCardGrid.js";
import { PageHeader } from "../../components/ui/Layout.js";
import { Button, ButtonLink } from "../../components/ui/Button.js";
import { ApiError, isConflict } from "../../api/errors.js";
import { presentSubjectType } from "../../api/presentation.js";

export function SubjectHub() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const orgPath = useOrgPath();
  const navigate = useNavigate();
  const role = useCurrentMembershipRole();
  const canWrite = role === "OWNER" || role === "ADMIN" || role === "MEMBER";
  const canAdmin = role === "OWNER" || role === "ADMIN";

  const subjectQuery = useSubject(subjectId ?? "");
  const complianceQuery = useSubjectCompliance(subjectId ?? "");
  const requirementsQuery = useRequirementsForSubject(subjectId ?? "");
  const deleteMutation = useDeleteSubject(subjectId ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>();

  if (!subjectId) return null; // unreachable - the route always supplies :subjectId

  if (subjectQuery.isPending) {
    return <InitialLoading label="Carregando fornecedor…" />;
  }
  if (subjectQuery.isError) {
    const error = subjectQuery.error;
    if (error instanceof ApiError && error.category === "NOT_FOUND") {
      return <EmptyState kind="unavailable" message="Este fornecedor não foi encontrado." action={<Link to={orgPath("/subjects")}>Voltar para Fornecedores</Link>} />;
    }
    const message = error instanceof ApiError ? error.message : "Não foi possível carregar este fornecedor.";
    return <ErrorState message={message} onRetry={() => void subjectQuery.refetch()} />;
  }

  const subject = subjectQuery.data.subject;

  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync({ expectedVersion: subject.version });
      navigate(orgPath("/subjects"));
    } catch (err) {
      if (isConflict(err)) return;
      setDeleteError(err instanceof ApiError ? err.message : "Não foi possível excluir este fornecedor.");
    }
  }

  const identifierLabel = subject.type === "COMPANY" || subject.type === "VENDOR" ? "CNPJ" : "Identificador";

  const cards: MetricCardData[] = [
    {
      id: "requirements",
      label: "Requisitos documentais",
      to: orgPath(`/requirements?subjectId=${encodeURIComponent(subjectId)}`),
      srDescription: "Ver requisitos documentais deste fornecedor",
      critical: (complianceQuery.data?.compliance.missingCount ?? 0) > 0,
      status: requirementsQuery.isPending
        ? { kind: "loading" }
        : requirementsQuery.isError
          ? { kind: "error", message: "Indisponível no momento", onRetry: () => void requirementsQuery.refetch() }
          : { kind: "value", value: requirementsQuery.data.requirements.length },
    },
    {
      id: "documents",
      label: "Documentos",
      // A12's dedicated Documents Collection doesn't exist yet - degrades to the same
      // requirements list, filtered, per the spec's own named fallback.
      to: orgPath(`/requirements?subjectId=${encodeURIComponent(subjectId)}`),
      srDescription: "Ver documentos/evidências vinculados a este fornecedor",
      status: requirementsQuery.isPending
        ? { kind: "loading" }
        : requirementsQuery.isError
          ? { kind: "error", message: "Indisponível no momento", onRetry: () => void requirementsQuery.refetch() }
          : { kind: "value", value: requirementsQuery.data.requirements.filter((r) => r.evidenceVersionId).length },
    },
    {
      id: "legacy-tracking",
      label: "Rastreamento legado (requisitos acompanhados)",
      to: "#",
      srDescription: "Em breve - A10 ainda não implementada",
      status: { kind: "value", value: "Em breve" },
    },
    {
      id: "requests",
      label: "Solicitações e recorrência",
      // A14 (Block 6) doesn't exist yet either - same "Em breve" treatment as legacy-tracking,
      // never a link to a route that doesn't exist.
      to: "#",
      srDescription: "Em breve - A14 ainda não implementada",
      status: { kind: "value", value: "Em breve" },
    },
  ];

  return (
    <div>
      <PageHeader
        above={<ButtonLink variant="secondary" size="sm" to={orgPath("/subjects")}>← Voltar para Fornecedores</ButtonLink>}
        title={subject.displayName}
        description={`${presentSubjectType(subject.type)}${subject.externalId ? ` · ${identifierLabel} ${subject.externalId}` : ""}`}
        actions={
          <>
            {canWrite ? <ButtonLink variant="secondary" to={orgPath(`/subjects/${subjectId}/edit`)}>Editar fornecedor</ButtonLink> : null}{" "}
            {canAdmin ? (
              <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
                Excluir fornecedor
              </Button>
            ) : null}
          </>
        }
      />
      {subject.status === "ARCHIVED" ? (
        <InlineNotice tone="neutral">Este fornecedor está arquivado. Novas evidências não são solicitadas automaticamente.</InlineNotice>
      ) : null}
      {confirmingDelete ? <DeleteConfirmDialog subjectName={subject.displayName} deleteError={deleteError} pending={deleteMutation.isPending} onCancel={() => setConfirmingDelete(false)} onConfirm={() => void handleDelete()} /> : null}

      <CompliancePanel subjectId={subjectId} />

      <MetricCardGrid cards={cards} />
    </div>
  );
}

/** Design system §48 - a destructive confirmation names the resource and the consequence, and
 * initial focus lands on Cancel (never the destructive action) - done via a ref/effect rather
 * than the `autoFocus` prop (`jsx-a11y/no-autofocus` - the rule's own reasoning about screen
 * readers announcing focus jumps unexpectedly does not apply to a dialog that only exists
 * because the user just triggered it, but the codebase has no other precedent to follow yet, so
 * this stays the more conservative, lint-clean form). */
function DeleteConfirmDialog({ subjectName, deleteError, pending, onCancel, onConfirm }: { subjectName: string; deleteError: string | undefined; pending: boolean; onCancel: () => void; onConfirm: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div role="alertdialog" aria-label={`Excluir ${subjectName}`}>
      <p>Excluir &quot;{subjectName}&quot; permanentemente? Esta ação não pode ser desfeita e removerá o acesso a todos os requisitos vinculados a este fornecedor.</p>
      {deleteError ? <p role="alert">{deleteError}</p> : null}
      <button ref={cancelRef} type="button" className="ui-button ui-button--secondary" onClick={onCancel}>
        Cancelar
      </button>{" "}
      <Button variant="danger" pending={pending} onClick={onConfirm}>
        Confirmar exclusão
      </Button>
    </div>
  );
}

function CompliancePanel({ subjectId }: { subjectId: string }) {
  const complianceQuery = useSubjectCompliance(subjectId);

  if (complianceQuery.isPending) {
    return <InitialLoading label="Carregando conformidade…" />;
  }
  if (complianceQuery.isError) {
    return (
      <InlineNotice tone="warning" actions={<Button size="sm" variant="secondary" onClick={() => void complianceQuery.refetch()}>Tentar novamente</Button>}>
        Não foi possível carregar os dados de conformidade.
      </InlineNotice>
    );
  }

  const { totalRequirements, satisfiedCount, expiringSoonCount, missingCount, compliancePercent } = complianceQuery.data.compliance;

  return (
    <section aria-labelledby="compliance-heading">
      <h2 id="compliance-heading">Conformidade</h2>
      <p>
        <strong style={{ fontSize: "2rem" }}>{compliancePercent === null ? "—" : `${compliancePercent}%`}</strong>{" "}
        <span>
          {satisfiedCount} de {totalRequirements} requisitos satisfeitos
        </span>
      </p>
      <ul>
        <li>{satisfiedCount} satisfeito(s)</li>
        <li>{expiringSoonCount} vencendo em breve</li>
        <li>{missingCount} em falta</li>
      </ul>
    </section>
  );
}
