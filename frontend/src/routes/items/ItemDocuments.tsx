/**
 * A07 — Generic Document/OCR attachment (Block 2, D-2xx). Per-item file attachments, scoped
 * narrower than the full audited spec (`A07-arquivos-vencimento.md`) for this first landing:
 * covers the two CRITICAL audit fixes in full (RBAC — `document:delete` is ADMIN_ROLES, never
 * MEMBER; the genuinely two-phase upload model — reserve vs. byte transfer, `PENDING_UPLOAD` is
 * NOT "done") plus every real lifecycle state the backend can return. OCR extraction fields
 * (`extraction:confirm`, SUGGESTED vs CONFIRMED) are out of scope for this landing — recorded
 * as pending follow-up (decisions-log D-2xx), not fabricated here.
 *
 * `document:read` is READ_ONLY_ROLES (authorization.ts:279, verified directly - NOT the same
 * tier as the spec's looser prose grouping it with `reserve-upload`) - every role can see this
 * screen and its file list; only WRITE_ROLES can upload, only ADMIN_ROLES can delete.
 */
import { useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useOrgPath } from "../../routing/useOrgPath.js";
import { useItem } from "../../hooks/useItem.js";
import { useDocuments } from "../../hooks/useDocuments.js";
import { useUploadDocument } from "../../hooks/useUploadDocument.js";
import { useDeleteDocument } from "../../hooks/useDeleteDocument.js";
import { useCurrentMembershipRole } from "../../hooks/useCurrentMembershipRole.js";
import { presentDocumentStatus, formatAbsoluteDate } from "../../api/presentation.js";
import { InitialLoading, CollectionSkeleton, ErrorState, EmptyState } from "../../components/AsyncStates.js";
import { ApiError } from "../../api/errors.js";
import { PageHeader, Section, Panel } from "../../components/ui/Layout.js";
import { Button } from "../../components/ui/Button.js";
import { StatusBadge } from "../../components/ui/StatusBadge.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";
import type { ItemDocument, MembershipRole } from "../../api/types.js";
import "./ItemDocuments.css";

const WRITE_ROLES: ReadonlySet<MembershipRole> = new Set(["OWNER", "ADMIN", "MEMBER"]);
const ADMIN_ROLES: ReadonlySet<MembershipRole> = new Set(["OWNER", "ADMIN"]);
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // upload-validation.ts's real ceiling, mirrored client-side only as a fast-fail UX check - the backend re-validates independently either way.

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function UploadForm({ itemId }: { itemId: string }) {
  const mutation = useUploadDocument(itemId);
  const [validationError, setValidationError] = useState<string | undefined>();
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setValidationError("Selecione um arquivo.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setValidationError("Arquivo excede o tamanho máximo permitido (20 MB).");
      return;
    }
    setValidationError(undefined);
    try {
      await mutation.mutateAsync({ itemId, file });
      mutation.newIntent();
      if (inputRef.current) inputRef.current.value = "";
    } catch {
      // Surfaced below via mutation.isError - no separate local state needed.
    }
  }

  return (
    <form className="ui-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
      {validationError ? (
        <InlineNotice tone="critical" announce="alert">
          <p>{validationError}</p>
        </InlineNotice>
      ) : null}
      {mutation.isError ? (
        <InlineNotice tone="critical" announce="alert">
          <p>{mutation.error instanceof ApiError ? mutation.error.message : "Não foi possível enviar o arquivo."}</p>
        </InlineNotice>
      ) : null}
      <div className="ui-form__row">
        <input ref={inputRef} type="file" aria-label="Selecionar arquivo" accept="application/pdf,image/jpeg,image/png" disabled={mutation.isPending} />
        <Button type="submit" variant="primary" pending={mutation.isPending}>
          {mutation.isPending ? "Enviando…" : "Anexar arquivo"}
        </Button>
      </div>
    </form>
  );
}

function DocumentRow({ document, itemId, canDelete }: { document: ItemDocument; itemId: string; canDelete: boolean }) {
  const presentation = presentDocumentStatus(document.status);
  const deleteMutation = useDeleteDocument(itemId);
  const [confirming, setConfirming] = useState(false);

  if (document.status === "DELETED") return null;

  return (
    <li className="ui-list-row">
      <div>
        <p>
          <strong>{document.fileName}</strong>
        </p>
        <p className="u-text-secondary">
          {formatBytes(document.contentLength)} · Anexado em {formatAbsoluteDate(document.createdAt)}
        </p>
      </div>
      <StatusBadge presentation={presentation} srPrefix="Status do arquivo" />
      {canDelete ? (
        confirming ? (
          <span className="ui-form__row">
            <Button variant="danger" size="sm" pending={deleteMutation.isPending} onClick={() => deleteMutation.mutate({ documentId: document.documentId })}>
              Confirmar exclusão
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirming(false)} disabled={deleteMutation.isPending}>
              Cancelar
            </Button>
          </span>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
            Excluir
          </Button>
        )
      ) : null}
    </li>
  );
}

export function ItemDocuments() {
  const { itemId } = useParams<{ itemId: string }>();
  const orgPath = useOrgPath();
  const role = useCurrentMembershipRole();
  const itemQuery = useItem(itemId ?? "");
  const documentsQuery = useDocuments(itemId ?? "");

  if (!itemId) {
    return <EmptyState kind="unavailable" message="Vencimento não identificado." />;
  }

  if (itemQuery.isPending) {
    return <InitialLoading label="Carregando vencimento…" />;
  }
  if (itemQuery.isError) {
    if (itemQuery.error instanceof ApiError && itemQuery.error.category === "AUTHORIZATION") {
      return <EmptyState kind="permission-limited" />;
    }
    const message = itemQuery.error instanceof ApiError ? itemQuery.error.message : "Não foi possível carregar este vencimento.";
    return <ErrorState message={message} onRetry={() => void itemQuery.refetch()} />;
  }

  const item = itemQuery.data.item;
  const canUpload = role !== undefined && WRITE_ROLES.has(role);
  const canDelete = role !== undefined && ADMIN_ROLES.has(role);

  return (
    <div>
      <PageHeader above={<Link to={orgPath(`/items/${item.itemId}`)}>← Voltar para {item.name}</Link>} title="Arquivos" description={item.name} />
      {canUpload ? (
        <Section heading="Anexar novo arquivo" headingId="documents-upload">
          <Panel padded>
            <UploadForm itemId={itemId} />
          </Panel>
        </Section>
      ) : null}
      <Section heading="Arquivos anexados" headingId="documents-list">
        {documentsQuery.isPending ? (
          <CollectionSkeleton rows={3} label="Carregando arquivos…" />
        ) : documentsQuery.isError ? (
          <ErrorState
            message={documentsQuery.error instanceof ApiError ? documentsQuery.error.message : "Não foi possível carregar os arquivos."}
            onRetry={() => void documentsQuery.refetch()}
          />
        ) : documentsQuery.data.documents.filter((document) => document.status !== "DELETED").length === 0 ? (
          <EmptyState kind="true-empty" message="Nenhum arquivo anexado ainda." />
        ) : (
          <ul className="ui-list">
            {documentsQuery.data.documents.map((document) => (
              <DocumentRow key={document.documentId} document={document} itemId={itemId} canDelete={canDelete} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
