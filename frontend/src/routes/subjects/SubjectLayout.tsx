/**
 * D-339 (redesenho do fluxo de detalhe de Fornecedor, item 35) — casca persistente que substitui
 * o antigo "hub de cards" (`SubjectHub.tsx`, aposentado por este arquivo). Identidade do
 * fornecedor (nome/tipo/ações) e a navegação local (Requisitos/Solicitações) nunca desmontam ao
 * trocar de seção - mesmo mecanismo `<Outlet>` já usado por `AppShell.tsx`, um nível mais fundo.
 * Conformidade deixa de ser uma seção própria (2 cliques para ver qualquer conteúdo real) e vira
 * um resumo compacto sempre visível acima da seção ativa.
 *
 * "Exportar dossiê" continua sendo uma AÇÃO com rota própria, nunca uma seção da navegação local
 * (D-339 fechamento, Rodada 2/3): `DossierExport.tsx` usa `runId` na própria URL para retomar
 * geração após sair/recarregar - migrar para dentro desta casca exigiria uma reconciliação
 * própria dessa propriedade, fora de escopo aqui.
 *
 * Item 37 (2026-09-26, novo protótipo+spec `OmniVence-fornecedor-detalhe-*`): reconciliado contra
 * este arquivo antes de implementar, por pedido direto de Marcelo - a spec pede `role=tablist`
 * para Requisitos/Solicitações, mas isso reverteria a decisão do D-339 (3 rodadas de protocolo,
 * WAI-ARIA APG citado) de usar rota real (`Link`+`Outlet`) porque essas são views navegáveis/
 * bookmarkable, não um painel de abas client-side - Marcelo confirmou manter a rota. A spec também
 * descreve Solicitações como lista somente-leitura, mas a tela real (`SubjectRequests.tsx`, A14)
 * já tem séries recorrentes/avulso/materialização aprovados antes deste protótipo existir -
 * Marcelo confirmou manter A14 como está. Gaps reais adotados desta rodada: selo "HUB DO
 * FORNECEDOR", `<title>` dinâmico, texto exato do card de conformidade.
 */
import { Link, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { useOrgPath } from "../../routing/useOrgPath.js";
import { useSubject } from "../../hooks/useSubject.js";
import { useSubjectCompliance } from "../../hooks/useSubjectCompliance.js";
import { useDeleteSubject } from "../../hooks/useDeleteSubject.js";
import { useCurrentMembershipRole } from "../../hooks/useCurrentMembershipRole.js";
import { InitialLoading, ErrorState } from "../../components/AsyncStates.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";
import { PageHeader, Section, Panel } from "../../components/ui/Layout.js";
import { Button, ButtonLink } from "../../components/ui/Button.js";
import { StatusBadge } from "../../components/ui/StatusBadge.js";
import { ApiError, isConflict } from "../../api/errors.js";
import { presentSubjectType } from "../../api/presentation.js";
import { SubjectFormDialog } from "./SubjectForm.js";
import "./SubjectHub.css";

function isRequirementsSectionActive(pathname: string, basePath: string): boolean {
  return pathname === basePath || pathname.startsWith(`${basePath}/requirements`);
}

export function SubjectLayout() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const orgPath = useOrgPath();
  const navigate = useNavigate();
  const location = useLocation();
  const role = useCurrentMembershipRole();
  const canWrite = role === "OWNER" || role === "ADMIN" || role === "MEMBER";
  const canAdmin = role === "OWNER" || role === "ADMIN";

  const subjectQuery = useSubject(subjectId ?? "");
  const deleteMutation = useDeleteSubject(subjectId ?? "");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>();
  const [showEdit, setShowEdit] = useState(false);

  // Item 37 (spec §3): título da aba segue o nome real assim que carregado, nunca um nome fixo -
  // roda antes dos `return`s condicionais abaixo (Rules of Hooks), usando `subjectQuery.data`
  // diretamente (a variável `subject` desestruturada só existe depois deles).
  useEffect(() => {
    document.title = subjectQuery.data ? `${subjectQuery.data.subject.displayName} · OmniVence` : "Fornecedor · OmniVence";
  }, [subjectQuery.data]);

  if (!subjectId) return null; // unreachable - the route always supplies :subjectId

  if (subjectQuery.isPending) {
    return <InitialLoading label="Carregando fornecedor…" />;
  }
  if (subjectQuery.isError) {
    const error = subjectQuery.error;
    if (error instanceof ApiError && error.category === "NOT_FOUND") {
      return <EmptyStateNotFound orgPath={orgPath} />;
    }
    const message = error instanceof ApiError ? error.message : "Não foi possível carregar este fornecedor.";
    return <ErrorState message={message} onRetry={() => void subjectQuery.refetch()} />;
  }

  const subject = subjectQuery.data.subject;
  const identifierLabel = subject.type === "COMPANY" || subject.type === "VENDOR" ? "CNPJ" : "Identificador";

  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync({ expectedVersion: subject.version });
      navigate(orgPath("/subjects"));
    } catch (err) {
      if (isConflict(err)) return;
      setDeleteError(err instanceof ApiError ? err.message : "Não foi possível excluir este fornecedor.");
    }
  }

  return (
    <div>
      <PageHeader
        above={
          <>
            <ButtonLink variant="secondary" size="sm" to={orgPath("/subjects")}>← Voltar para Fornecedores</ButtonLink>
            <span className="ov-eyebrow subject-layout__eyebrow">Hub do fornecedor</span>
          </>
        }
        title={subject.displayName}
        description={`${presentSubjectType(subject.type)}${subject.externalId ? ` · ${identifierLabel} ${subject.externalId}` : ""}`}
        actions={
          <>
            {canWrite ? <Button variant="secondary" onClick={() => setShowEdit(true)}>Editar fornecedor</Button> : null}{" "}
            {canAdmin ? <ButtonLink variant="secondary" to={orgPath(`/subjects/${subjectId}/dossier`)}>Exportar dossiê</ButtonLink> : null}{" "}
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
      {showEdit ? <SubjectFormDialog subjectId={subjectId} onClose={() => setShowEdit(false)} /> : null}
      {confirmingDelete ? (
        <DeleteConfirmDialog
          subjectName={subject.displayName}
          deleteError={deleteError}
          isConflict={deleteMutation.isConflict}
          pending={deleteMutation.isPending}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => void handleDelete()}
        />
      ) : null}

      <CompliancePanel subjectId={subjectId} />

      {/* D-339: navegação local, nunca desmonta ao trocar de seção - identidade/ações acima
          ficam fixas. "Requisitos" (index) é a seção padrão de entrada, fechando o clique
          intermediário que o hub de cards antigo exigia. Cálculo manual de "ativo" (em vez de
          `NavLink`'s `end`) porque a rota de detalhe de requisito
          (`/requirements/:requirementId`) é uma IRMÃ do índice, não uma filha dele - "Requisitos"
          precisa continuar destacado nela também (Codex, Rodada 3: "permanece visualmente ativo
          durante a navegação para um requisito específico"). */}
      <nav className="subject-layout__nav" aria-label={`Seções de ${subject.displayName}`}>
        <Link
          to={orgPath(`/subjects/${subjectId}`)}
          className="subject-layout__nav-link"
          aria-current={isRequirementsSectionActive(location.pathname, orgPath(`/subjects/${subjectId}`)) ? "page" : undefined}
        >
          Requisitos
        </Link>
        <Link
          to={orgPath(`/subjects/${subjectId}/requests`)}
          className="subject-layout__nav-link"
          aria-current={location.pathname.startsWith(orgPath(`/subjects/${subjectId}/requests`)) ? "page" : undefined}
        >
          Solicitações
        </Link>
      </nav>

      <Outlet />
    </div>
  );
}

function EmptyStateNotFound({ orgPath }: { orgPath: (path: string) => string }) {
  return (
    <Panel padded>
      {/* Item 37 (spec §3/§10): texto exato "Fornecedor não encontrado". */}
      <p>Fornecedor não encontrado.</p>
      <Link to={orgPath("/subjects")}>← Voltar para Fornecedores</Link>
    </Panel>
  );
}

/** Design system §48 - a destructive confirmation names the resource and the consequence, and
 * initial focus lands on Cancel (never the destructive action). */
function DeleteConfirmDialog({
  subjectName,
  deleteError,
  isConflict,
  pending,
  onCancel,
  onConfirm,
}: {
  subjectName: string;
  deleteError: string | undefined;
  isConflict: boolean;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div role="alertdialog" aria-label={`Excluir ${subjectName}`}>
      <p>Excluir &quot;{subjectName}&quot; permanentemente? Esta ação não pode ser desfeita, se concluída. Se houver requisitos ativos vinculados, a exclusão pode ser recusada pelo servidor.</p>
      {isConflict ? <p role="alert">Este fornecedor foi alterado por outra pessoa — feche e reabra este diálogo para ver o estado atual antes de tentar excluir de novo.</p> : null}
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
  // Item 37 (spec §3/§5.6/§11): sem denominador (nenhum requisito aplicável), nunca mostrar
  // "0 de 0 requisitos satisfeitos" - o texto/anúncio precisa dizer explicitamente que não há
  // base de cálculo, não sugerir uma avaliação real que deu zero.
  const hasDenominator = compliancePercent !== null;

  return (
    <Section heading="Conformidade documental" headingId="compliance-heading" description="Panorama dos requisitos aplicáveis.">
      <Panel padded>
        <div className="ui-compliance">
          <div className="ui-compliance__stat">
            <span
              className="ui-compliance__percent"
              aria-label={hasDenominator ? `${compliancePercent}% - ${satisfiedCount} de ${totalRequirements} requisitos aplicáveis satisfeitos` : "Conformidade não calculada: nenhum requisito aplicável cadastrado"}
            >
              {hasDenominator ? `${compliancePercent}%` : "—"}
            </span>
            <span className="u-text-secondary" aria-hidden="true">
              {hasDenominator ? `${satisfiedCount} de ${totalRequirements} requisitos satisfeitos` : "Nenhum requisito aplicável cadastrado"}
            </span>
          </div>
          <ul className="ui-compliance__breakdown">
            <li>
              <StatusBadge presentation={{ label: `${satisfiedCount} satisfeito(s)`, tone: "neutral" }} />
            </li>
            <li>
              <StatusBadge presentation={{ label: `${expiringSoonCount} vencendo em breve`, tone: "warning" }} />
            </li>
            <li>
              <StatusBadge presentation={{ label: `${missingCount} em falta`, tone: "danger" }} />
            </li>
          </ul>
        </div>
        <p className="subject-layout__compliance-note u-text-secondary">A conformidade é calculada a partir dos requisitos aplicáveis deste fornecedor.</p>
      </Panel>
    </Section>
  );
}
