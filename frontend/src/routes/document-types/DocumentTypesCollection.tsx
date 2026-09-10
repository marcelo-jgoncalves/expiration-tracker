/**
 * A20 — Catálogo de tipos de documento (Block 4, D-2xx). Catalog half of the two-route spec
 * (`docs/frontend/prototype-screen-specs/A20-catalogo-tipos-documento.md`, post-audit): the
 * field editor lives in `DocumentTypeEditor.tsx`.
 *
 * `docarchive:documenttype-read` is READ_ONLY_ROLES — every role browses this table; the
 * editor link is available to every role too (it opens read-only for MEMBER/VIEWER). Only
 * "Novo tipo", "Descontinuar"/"Reativar" are ADMIN_ROLES and the whole "Ações" column is
 * ABSENT (not merely disabled) for non-admins, per the audited spec.
 *
 * Named gap (graceful degradation, same precedent as A11's CSV-export omission): the spec's
 * "Ainda referenciado por N documento(s) existente(s)" count on a deprecated type has no
 * backend route (no `documentTypeId`-filtered Document search is exposed to the frontend
 * anywhere in `proxy-allowlist.ts`) — the field editor shows a status-only neutral notice
 * instead of a fabricated count, never inventing a number the backend cannot produce.
 */
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useOrgPath } from "../../routing/useOrgPath.js";
import { useDocumentTypes } from "../../hooks/useDocumentTypes.js";
import { useCreateDocumentType } from "../../hooks/useCreateDocumentType.js";
import { useDeprecateDocumentType } from "../../hooks/useDeprecateDocumentType.js";
import { useReactivateDocumentType } from "../../hooks/useReactivateDocumentType.js";
import { useCurrentMembershipRole } from "../../hooks/useCurrentMembershipRole.js";
import { InitialLoading, ErrorState, EmptyState } from "../../components/AsyncStates.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";
import { DataTable } from "../../components/ui/DataTable.js";
import { StatusBadge } from "../../components/ui/StatusBadge.js";
import { PageHeader } from "../../components/ui/Layout.js";
import { Button, ButtonLink } from "../../components/ui/Button.js";
import { TextField } from "../../components/forms/TextField.js";
import { FormErrorSummary } from "../../components/forms/FormErrorSummary.js";
import { ApiError } from "../../api/errors.js";
import { presentDocumentTypeStatus } from "../../api/presentation.js";
import type { DocumentType } from "../../api/types.js";

export function DocumentTypesCollection() {
  const orgPath = useOrgPath();
  const role = useCurrentMembershipRole();
  const isAdmin = role === "OWNER" || role === "ADMIN";
  const [showCreate, setShowCreate] = useState(false);

  const activeQuery = useDocumentTypes("ACTIVE");
  const deprecatedQuery = useDocumentTypes("DEPRECATED");
  const queries = [activeQuery, deprecatedQuery];
  const isPending = queries.some((q) => q.isPending);
  const isFullyError = queries.every((q) => q.isError);
  const failedCount = queries.filter((q) => q.isError).length;

  if (isPending) {
    return <InitialLoading label="Carregando catálogo de tipos de documento…" />;
  }
  if (isFullyError) {
    const first = queries[0];
    const message = first?.error instanceof ApiError ? first.error.message : "Não foi possível carregar o catálogo.";
    return <ErrorState message={message} onRetry={() => queries.forEach((q) => void q.refetch())} />;
  }

  const documentTypes = [...(activeQuery.data?.documentTypes ?? []), ...(deprecatedQuery.data?.documentTypes ?? [])];

  return (
    <div>
      <PageHeader
        title="Tipos de documento"
        description="Catálogo compartilhado, com campos de metadados customizados."
        actions={isAdmin ? <Button variant="primary" onClick={() => setShowCreate((v) => !v)}>Novo tipo</Button> : undefined}
      />
      {failedCount > 0 && !isFullyError ? (
        <InlineNotice tone="warning" announce="status">
          Não foi possível carregar {failedCount} de {queries.length} categorias de status — a lista abaixo está incompleta.
        </InlineNotice>
      ) : null}
      {showCreate ? <CreateDocumentTypeForm onClose={() => setShowCreate(false)} /> : null}
      {documentTypes.length === 0 ? (
        <EmptyState kind="true-empty" message="Nenhum tipo de documento cadastrado ainda." />
      ) : (
        <DataTable
          caption="Catálogo de tipos de documento"
          rowKey={(t: DocumentType) => t.documentTypeId}
          rows={documentTypes}
          columns={[
            {
              key: "name",
              header: "Tipo de documento",
              primary: true,
              render: (t) => <Link to={orgPath(`/settings/document-types/${t.documentTypeId}`)}>{t.displayName}</Link>,
            },
            {
              key: "fields",
              header: "Campos de metadados",
              render: (t) => (t.metadataFields && t.metadataFields.length > 0 ? `${t.metadataFields.length} campos` : "Sem campos"),
            },
            { key: "status", header: "Status", render: (t) => <StatusBadge presentation={presentDocumentTypeStatus(t.status)} /> },
            {
              key: "guestVisible",
              header: "Visível para convidados",
              render: (t) => (t.status === "ACTIVE" ? "Sim" : "Não (descontinuado)"),
            },
            ...(isAdmin
              ? [
                  {
                    key: "actions",
                    header: "Ações",
                    actions: true,
                    render: (t: DocumentType) => <RowActions documentType={t} />,
                  },
                ]
              : []),
          ]}
        />
      )}
    </div>
  );
}

function RowActions({ documentType }: { documentType: DocumentType }) {
  const orgPath = useOrgPath();
  const deprecateMutation = useDeprecateDocumentType(documentType.documentTypeId);
  const reactivateMutation = useReactivateDocumentType(documentType.documentTypeId);
  const [error, setError] = useState<string | undefined>();
  const mutation = documentType.status === "ACTIVE" ? deprecateMutation : reactivateMutation;

  async function handleToggle() {
    setError(undefined);
    try {
      await mutation.mutateAsync({ expectedVersion: documentType.version });
    } catch (err) {
      if (mutation.isConflict) return;
      setError(err instanceof ApiError ? err.message : "Não foi possível atualizar este tipo.");
    }
  }

  return (
    <>
      {/* `ButtonLink`, not a bare `<Link>` (WCAG 2.5.8 target size, 24x24 CSS px minimum) - a
          bare text link inherits no min-height/padding and measured 19px tall in the E2E
          keyboard-path probe, a real defect the probe caught, not a test artifact. `ghost`
          keeps the "text-link" visual the spec asks for while `.ui-button` still supplies an
          adequate touch target. */}
      <ButtonLink to={orgPath(`/settings/document-types/${documentType.documentTypeId}`)} variant="ghost" size="sm">
        Editar
      </ButtonLink>{" "}
      <Button size="sm" variant="ghost" pending={mutation.isPending} onClick={() => void handleToggle()}>
        {documentType.status === "ACTIVE" ? "Descontinuar" : "Reativar"}
      </Button>
      {mutation.isConflict ? <span role="alert"> Este tipo foi alterado por outra pessoa — recarregue antes de tentar de novo.</span> : null}
      {error ? <span role="alert"> {error}</span> : null}
    </>
  );
}

function CreateDocumentTypeForm({ onClose }: { onClose: () => void }) {
  const mutation = useCreateDocumentType();
  const [displayName, setDisplayName] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!displayName.trim()) {
      setErrors(["Informe o nome do tipo de documento."]);
      return;
    }
    setErrors([]);
    try {
      await mutation.mutateAsync({ displayName: displayName.trim() });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.category === "CONFLICT") {
        setErrors(["Já existe um tipo com este nome."]);
        return;
      }
      setErrors([err instanceof ApiError ? err.message : "Não foi possível criar este tipo de documento."]);
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate>
      <FormErrorSummary errors={errors} />
      <TextField id="doctype-name" label="Nome do tipo de documento" value={displayName} onChange={setDisplayName} required />
      <Button type="submit" variant="primary" pending={mutation.isPending}>
        {mutation.isPending ? "Criando…" : "Criar tipo"}
      </Button>{" "}
      <Button type="button" variant="secondary" onClick={onClose}>
        Cancelar
      </Button>
    </form>
  );
}
