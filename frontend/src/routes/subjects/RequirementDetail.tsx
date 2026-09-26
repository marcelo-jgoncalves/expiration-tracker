/**
 * Requisito - Detalhe (Marcelo, 2026-09-21, protótipo "04 - Requisito Detalhe"). Genuinely NEW
 * screen (achado real, sessão anterior: não existia rota nem tela de detalhe de requisito -
 * tudo era inline na tabela de RequirementsCollection.tsx). Construída só com dados/endpoints
 * já reais, nenhuma peça inventada:
 *
 *  - Não existe `GET` de um requisito único - resolvido buscando a lista do fornecedor
 *    (`useRequirementsForSubject`, já usada por SubjectLayout/RequirementsCollection) e filtrando
 *    pelo id na URL, mesmo padrão implícito que RequirementsCollection.tsx já fazia.
 *  - "Solicitações enviadas" do protótipo é real: `DocumentRequest.requirementId` já existe no
 *    contrato (SubjectRequests.tsx nunca filtrava por ele, só listava tudo do fornecedor) -
 *    filtrado aqui client-side via `useDocumentRequestsForSubject`.
 *  - Chip de status de cada solicitação usa `presentGuestLinkState` (texto simples), o MESMO
 *    tratamento que SubjectRequests.tsx já usa pra essa coluna - nunca um StatusBadge decorativo
 *    novo só pra bater com o chip do protótipo, que aqui quebraria a convenção já aprovada.
 *  - "Nova solicitação" pede só o e-mail do destinatário (o requisito já é fixo, vem de props).
 *
 * Modal conversion (2026-09-25): single entry point (RequirementsCollection's "Ver" row action),
 * no deep-link need of its own - reuses the existing `Dialog`. The "Nova solicitação" form used
 * to be a second, nested `Dialog` on top of this whole screen's own `Dialog` - now that the
 * screen itself IS a Dialog, that would stack two `role="dialog"` panels, so the form collapses
 * into an inline section on the same surface instead (`showNewRequestForm`), never a second
 * overlay.
 */
import { useState } from "react";
import { DeliveryModeFields, useCreateDocumentRequestForm } from "./DocumentRequestDeliveryForm.js";
import { useRequirementsForSubject } from "../../hooks/useRequirementsForSubject.js";
import { useDocumentRequestsForSubject } from "../../hooks/useDocumentRequestsForSubject.js";
import { useCurrentMembershipRole } from "../../hooks/useCurrentMembershipRole.js";
import { InitialLoading, ErrorState, EmptyState } from "../../components/AsyncStates.js";
import { Section, Panel } from "../../components/ui/Layout.js";
import { Button } from "../../components/ui/Button.js";
import { StatusBadge } from "../../components/ui/StatusBadge.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";
import { Dialog } from "../../components/ui/Dialog.js";
import { FormErrorSummary } from "../../components/forms/FormErrorSummary.js";
import { ApiError } from "../../api/errors.js";
import { presentRequirementDocStatus, presentGuestLinkState, formatAbsoluteDate } from "../../api/presentation.js";
import type { MembershipRole } from "../../api/types.js";
import "./RequirementDetail.css";

const WRITE_ROLES: ReadonlySet<MembershipRole> = new Set(["OWNER", "ADMIN", "MEMBER"]);

/** D-339 achado 4: adota o MESMO contrato comportamental de `CreateAvulsoDialog`
 * (`SubjectRequests.tsx`) - antes desta correção, exigia e-mail incondicionalmente e nunca
 * enviava `initialInviteDelivery`, prometendo um envio automático que o modo efetivo `MANUAL`
 * (padrão do tenant) não sustentava. O requisito aqui é sempre fixo (vem de props), nunca
 * selecionável - a única diferença real em relação a `CreateAvulsoDialog`. */
function NewRequestForm({ subjectId, requirementId, onDone }: { subjectId: string; requirementId: string; onDone: () => void }) {
  const { email, setEmail, deliveryMode, setDeliveryMode, errors, submit, mutation } = useCreateDocumentRequestForm(subjectId, requirementId, onDone);

  return (
    <Panel padded>
      <Section heading="Nova solicitação" headingId="requirement-new-request">
        <form onSubmit={(event) => void submit(event)} noValidate>
          <FormErrorSummary errors={errors} />
          <DeliveryModeFields idPrefix="requirement-detail-request" email={email} onEmailChange={setEmail} deliveryMode={deliveryMode} onDeliveryModeChange={setDeliveryMode} />
          <Button type="submit" variant="primary" pending={mutation.isPending}>
            {mutation.isPending ? "Criando…" : "Criar solicitação"}
          </Button>{" "}
          <Button type="button" variant="secondary" onClick={onDone}>
            Cancelar
          </Button>
        </form>
      </Section>
    </Panel>
  );
}

export function RequirementDetail({ subjectId, requirementId, onClose }: { subjectId: string; requirementId: string; onClose: () => void }) {
  const role = useCurrentMembershipRole();
  const canWrite = role !== undefined && WRITE_ROLES.has(role);
  const [showNewRequestForm, setShowNewRequestForm] = useState(false);

  const requirementsQuery = useRequirementsForSubject(subjectId);
  const requestsQuery = useDocumentRequestsForSubject(subjectId);

  if (requirementsQuery.isPending) {
    return (
      <Dialog title="Requisito" onClose={onClose}>
        <InitialLoading label="Carregando requisito…" />
      </Dialog>
    );
  }
  if (requirementsQuery.isError) {
    const message = requirementsQuery.error instanceof ApiError ? requirementsQuery.error.message : "Não foi possível carregar este requisito.";
    return (
      <Dialog title="Requisito" onClose={onClose}>
        <ErrorState message={message} onRetry={() => void requirementsQuery.refetch()} />
      </Dialog>
    );
  }

  const requirement = requirementsQuery.data.requirements.find((r) => r.requirementId === requirementId);
  if (!requirement) {
    return (
      <Dialog title="Requisito" onClose={onClose}>
        <EmptyState kind="unavailable" message="Este requisito não foi encontrado." />
      </Dialog>
    );
  }

  const requests = (requestsQuery.data?.documentRequests ?? []).filter((r) => r.requirementId === requirementId);
  const now = new Date();

  return (
    <Dialog title={requirement.name} onClose={onClose}>
      <p>
        <StatusBadge presentation={presentRequirementDocStatus(requirement.status)} />
      </p>
      {!requirement.evidenceVersionId ? <InlineNotice tone="warning">Ainda não há documento vinculado a este requisito.</InlineNotice> : null}
      {canWrite && !showNewRequestForm ? (
        <p>
          <Button variant="primary" onClick={() => setShowNewRequestForm(true)}>
            Nova solicitação
          </Button>
        </p>
      ) : null}
      {showNewRequestForm ? <NewRequestForm subjectId={subjectId} requirementId={requirementId} onDone={() => setShowNewRequestForm(false)} /> : null}

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
    </Dialog>
  );
}
