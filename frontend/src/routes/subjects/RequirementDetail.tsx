/**
 * Requisito - Detalhe (Marcelo, 2026-09-21, protótipo "04 - Requisito Detalhe"). Genuinely NEW
 * screen (achado real, sessão anterior: não existia rota nem tela de detalhe de requisito -
 * tudo era inline na tabela de RequirementsCollection.tsx). Construída só com dados/endpoints
 * já reais, nenhuma peça inventada:
 *
 *  - Não existe `GET` de um requisito único - resolvido buscando a lista do fornecedor
 *    (`useRequirementsForSubject`, já usada por SubjectHub/RequirementsCollection) e filtrando
 *    pelo id na URL, mesmo padrão implícito que RequirementsCollection.tsx já fazia.
 *  - "Solicitações enviadas" do protótipo é real: `DocumentRequest.requirementId` já existe no
 *    contrato (SubjectRequests.tsx nunca filtrava por ele, só listava tudo do fornecedor) -
 *    filtrado aqui client-side via `useDocumentRequestsForSubject`.
 *  - Chip de status de cada solicitação usa `presentGuestLinkState` (texto simples), o MESMO
 *    tratamento que SubjectRequests.tsx já usa pra essa coluna - nunca um StatusBadge decorativo
 *    novo só pra bater com o chip do protótipo, que aqui quebraria a convenção já aprovada.
 *  - "Nova solicitação" é uma versão reduzida do `CreateAvulsoDialog` de SubjectRequests.tsx -
 *    aqui o requisito já é fixo (vem da URL), então o formulário pede só o e-mail do
 *    destinatário, nunca reconstrói o Combobox de seleção de requisito que não faz sentido aqui.
 */
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useOrgPath } from "../../routing/useOrgPath.js";
import { useRequirementsForSubject } from "../../hooks/useRequirementsForSubject.js";
import { useDocumentRequestsForSubject } from "../../hooks/useDocumentRequestsForSubject.js";
import { useCreateDocumentRequest } from "../../hooks/useCreateDocumentRequest.js";
import { useCurrentMembershipRole } from "../../hooks/useCurrentMembershipRole.js";
import { InitialLoading, ErrorState, EmptyState } from "../../components/AsyncStates.js";
import { PageHeader, Section, Panel } from "../../components/ui/Layout.js";
import { Button } from "../../components/ui/Button.js";
import { StatusBadge } from "../../components/ui/StatusBadge.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";
import { Dialog } from "../../components/ui/Dialog.js";
import { TextField } from "../../components/forms/TextField.js";
import { FormErrorSummary } from "../../components/forms/FormErrorSummary.js";
import { ApiError } from "../../api/errors.js";
import { presentRequirementDocStatus, presentGuestLinkState, formatAbsoluteDate } from "../../api/presentation.js";
import type { MembershipRole } from "../../api/types.js";
import "./RequirementDetail.css";

const WRITE_ROLES: ReadonlySet<MembershipRole> = new Set(["OWNER", "ADMIN", "MEMBER"]);

function NewRequestDialog({ subjectId, requirementId, onClose }: { subjectId: string; requirementId: string; onClose: () => void }) {
  const mutation = useCreateDocumentRequest(subjectId);
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) {
      setErrors(["Informe o e-mail do destinatário."]);
      return;
    }
    setErrors([]);
    try {
      await mutation.mutateAsync({ subjectId, requirementId, recipientEmail: email.trim() });
      onClose();
    } catch (err) {
      setErrors([err instanceof ApiError ? err.message : "Não foi possível criar a solicitação."]);
    }
  }

  return (
    <Dialog title="Nova solicitação" onClose={onClose}>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <FormErrorSummary errors={errors} />
        <TextField id="new-request-email" label="Destinatário" type="text" value={email} onChange={setEmail} required hint="E-mail que receberá o link de convidado." />
        <InlineNotice tone="neutral">
          Um link de convidado sem login será gerado e enviado a este e-mail. O envio é confirmado apenas como aceito pelo provedor — não como recebido.
        </InlineNotice>
        <Button type="submit" variant="primary" pending={mutation.isPending}>
          {mutation.isPending ? "Criando…" : "Criar solicitação"}
        </Button>{" "}
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
      </form>
    </Dialog>
  );
}

export function RequirementDetail() {
  const { subjectId, requirementId } = useParams<{ subjectId: string; requirementId: string }>();
  const orgPath = useOrgPath();
  const role = useCurrentMembershipRole();
  const canWrite = role !== undefined && WRITE_ROLES.has(role);
  const [showNewRequest, setShowNewRequest] = useState(false);

  const requirementsQuery = useRequirementsForSubject(subjectId ?? "");
  const requestsQuery = useDocumentRequestsForSubject(subjectId ?? "");

  if (!subjectId || !requirementId) return null; // unreachable - the route always supplies both

  if (requirementsQuery.isPending) {
    return <InitialLoading label="Carregando requisito…" />;
  }
  if (requirementsQuery.isError) {
    const message = requirementsQuery.error instanceof ApiError ? requirementsQuery.error.message : "Não foi possível carregar este requisito.";
    return <ErrorState message={message} onRetry={() => void requirementsQuery.refetch()} />;
  }

  const requirement = requirementsQuery.data.requirements.find((r) => r.requirementId === requirementId);
  if (!requirement) {
    return <EmptyState kind="unavailable" message="Este requisito não foi encontrado." action={<Link to={orgPath(`/subjects/${subjectId}`)}>Voltar para o fornecedor</Link>} />;
  }

  const requests = (requestsQuery.data?.documentRequests ?? []).filter((r) => r.requirementId === requirementId);
  const now = new Date();

  return (
    <div>
      <PageHeader
        above={<Link to={orgPath(`/subjects/${subjectId}`)}>← Voltar para o fornecedor</Link>}
        title={requirement.name}
        description={<StatusBadge presentation={presentRequirementDocStatus(requirement.status)} />}
        actions={
          canWrite ? (
            <Button variant="primary" onClick={() => setShowNewRequest(true)}>
              Nova solicitação
            </Button>
          ) : undefined
        }
      />
      {!requirement.evidenceVersionId ? <InlineNotice tone="warning">Ainda não há documento vinculado a este requisito.</InlineNotice> : null}
      {showNewRequest ? <NewRequestDialog subjectId={subjectId} requirementId={requirementId} onClose={() => setShowNewRequest(false)} /> : null}

      <Section heading="Solicitações enviadas" headingId="requirement-requests">
        <Panel padded>
          {requestsQuery.isPending ? (
            <p className="u-text-secondary">Carregando…</p>
          ) : requestsQuery.isError ? (
            <InlineNotice tone="warning" actions={<Button size="sm" variant="secondary" onClick={() => void requestsQuery.refetch()}>Tentar novamente</Button>}>
              Não foi possível carregar as solicitações enviadas.
            </InlineNotice>
          ) : requests.length === 0 ? (
            <EmptyState kind="true-empty" message="Nenhuma solicitação enviada ainda." />
          ) : (
            <ul className="ui-list">
              {requests.map((request) => (
                <li key={request.documentRequestId} className="ui-list-row">
                  <div className="ui-list-row__body">
                    <p>
                      <strong>Enviada em {formatAbsoluteDate(request.createdAt)}</strong>
                    </p>
                  </div>
                  <span className="u-text-secondary">{presentGuestLinkState(request, now)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </Section>
    </div>
  );
}
