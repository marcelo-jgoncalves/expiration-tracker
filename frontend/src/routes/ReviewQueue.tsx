/**
 * A13 — Fila de revisão (Block 5, D-2xx). Post-audit spec
 * (`docs/frontend/prototype-screen-specs/A13-fila-revisao.md`): route `/app/:orgId/reviews`,
 * two independent per-state queries (`GET .../reviews?state=RECEIVED|UNDER_REVIEW` — never a
 * merged "ALL" call, `listReviewQueue`'s own doc comment/D-247), one stacked list+detail layout
 * (not side-by-side, an audited local exception).
 *
 * RBAC: `docarchive:read` (READ_ONLY_ROLES — every role sees the queue and detail).
 * `docarchive:review` (WRITE_ROLES) gates Reivindicar/Aceitar/Rejeitar, FURTHER gated by the
 * service's own `assertReviewerOrAdmin` (`document-archive-service.ts:2710`): OWNER/ADMIN may
 * always decide any eligible item, claimed by someone else or not; a MEMBER may only decide an
 * item they claimed themselves or one nobody has claimed.
 *
 * Named limitation (real, not mechanical route-wiring): the BFF session
 * (`src/modules/bff/http/bff-handlers.ts`'s `handleGetSession`) deliberately carries no
 * `userId` (removed in Wave B2B-5, D-095/096) — this frontend has no way to compare
 * `version.reviewerId` against "me" across a page reload. The backend's `assertReviewerOrAdmin`
 * is the real, always-correct enforcement (frontend gating is UX convenience only, never a
 * security boundary — same posture `useCurrentMembershipRole`'s own doc comment states). This
 * screen approximates "claimed by me" with an in-memory set populated the instant THIS session's
 * own claim succeeds; a claim made in a previous session/tab reads as "claimed by another
 * reviewer" here until released, which only affects a MEMBER's UI (an OWNER/ADMIN's action bar
 * is never affected, per the rule above). Recorded for a future slice that threads a real
 * `userId` through the session, not fixed here.
 *
 * "Abrir documento" (→ A12, Document Detail/Version History) is OMITTED — A12 does not exist in
 * this codebase yet (this session's explicit scope is A13 only) — same "omit rather than link to
 * a screen that doesn't exist" precedent `RequirementsCollection`'s own doc comment establishes
 * for CSV export.
 */
import { useEffect, useRef, useState } from "react";
import { useOrgPath } from "../routing/useOrgPath.js";
import { useReviewQueue } from "../hooks/useReviewQueue.js";
import { useClaimReview } from "../hooks/useClaimReview.js";
import { useAcceptVersion } from "../hooks/useAcceptVersion.js";
import { useRejectVersion } from "../hooks/useRejectVersion.js";
import { useCurrentMembershipRole } from "../hooks/useCurrentMembershipRole.js";
import { InitialLoading, ErrorState, EmptyState } from "../components/AsyncStates.js";
import { InlineNotice } from "../components/ui/InlineNotice.js";
import { DataTable, CellSecondary } from "../components/ui/DataTable.js";
import { StatusBadge } from "../components/ui/StatusBadge.js";
import { PageHeader, Toolbar, Section, Panel } from "../components/ui/Layout.js";
import { Button } from "../components/ui/Button.js";
import { SelectField } from "../components/forms/SelectField.js";
import { ApiError, isConflict } from "../api/errors.js";
import { formatAbsoluteDate } from "../api/presentation.js";
import type { ReviewQueueHit, ReviewQueueState, RejectionReason } from "../api/types.js";

const TABS: { value: ReviewQueueState; label: string }[] = [
  { value: "RECEIVED", label: "Recebidas" },
  { value: "UNDER_REVIEW", label: "Em revisão" },
];

const ORIGIN_LABEL: Record<string, string> = {
  MANUAL_UPLOAD: "Upload manual",
  GUEST_UPLOAD: "Solicitação (guest)",
  REQUEST_RESPONSE: "Resposta a solicitação",
  IMPORT: "Importação",
  AUTOMATED_CAPTURE: "Captura automatizada",
};

const REJECTION_REASONS: { value: RejectionReason; label: string }[] = [
  { value: "EXPIRED", label: "Vencido" },
  { value: "ILLEGIBLE", label: "Ilegível" },
  { value: "INCORRECT", label: "Incorreto" },
  { value: "WRONG_SUBJECT", label: "Fornecedor errado" },
  { value: "OUTDATED_VERSION", label: "Versão desatualizada" },
  { value: "INCOMPLETE", label: "Incompleto" },
  { value: "OTHER", label: "Outro" },
];

function hitKey(hit: ReviewQueueHit): string {
  return `${hit.version.documentId}#${hit.version.seq}`;
}

function ReviewerBadge({ reviewerId, nameFor }: { reviewerId: string | undefined; nameFor: (userId: string) => string | undefined }) {
  if (!reviewerId) return <StatusBadge presentation={{ label: "Disponível", tone: "neutral" }} />;
  const name = nameFor(reviewerId) ?? reviewerId;
  return <StatusBadge presentation={{ label: `Com ${name}`, tone: "neutral" }} />;
}

interface DetailField {
  label: string;
  value: string | undefined;
}

function DetailList({ fields }: { fields: DetailField[] }) {
  const present = fields.filter((field): field is { label: string; value: string } => Boolean(field.value));
  if (present.length === 0) return null;
  return (
    <dl className="ui-detail-list">
      {present.map((field) => (
        <div key={field.label}>
          <dt>{field.label}</dt>
          <dd>{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ReviewQueue() {
  const orgPath = useOrgPath();
  void orgPath; // reserved for a future "Abrir documento" link once A12 exists
  const role = useCurrentMembershipRole();
  const canWrite = role === "OWNER" || role === "ADMIN" || role === "MEMBER";
  const isAdminOrOwner = role === "OWNER" || role === "ADMIN";
  // `Member` (api/types.ts) carries no display name (only `userId`/`role`/`status`) - the
  // Revisor badge/detail field show the raw userId, same graceful-degradation precedent as
  // `Document`'s missing `name` field above (no fabricated name-resolution fetch).
  const nameFor = (userId: string): string | undefined => userId;

  const [tab, setTab] = useState<ReviewQueueState>("RECEIVED");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [claimedByMe, setClaimedByMe] = useState<ReadonlySet<string>>(new Set());
  const autoSelectedRef = useRef(false);

  // Both tabs' counts are shown on their own FilterGroup entry (audited spec, "Structure" item
  // 2), so both are fetched unconditionally - two independent requests, never merged into one
  // "ALL" call (`listReviewQueue`'s own contract).
  const receivedQuery = useReviewQueue("RECEIVED");
  const underReviewQuery = useReviewQueue("UNDER_REVIEW");
  const activeQuery = tab === "RECEIVED" ? receivedQuery : underReviewQuery;

  useEffect(() => {
    if (autoSelectedRef.current) return;
    if (!receivedQuery.data) return;
    const first = receivedQuery.data.items[0];
    if (first) setSelectedKey(hitKey(first));
    autoSelectedRef.current = true;
  }, [receivedQuery.data]);

  function handleTabChange(next: ReviewQueueState) {
    setTab(next);
    setSelectedKey(null);
  }

  function markClaimedByMe(key: string) {
    setClaimedByMe((prev) => new Set(prev).add(key));
  }

  function advanceAfterDecision(decidedKey: string) {
    const items = activeQuery.data?.items ?? [];
    const remaining = items.filter((hit) => hitKey(hit) !== decidedKey);
    const decidedIndex = items.findIndex((hit) => hitKey(hit) === decidedKey);
    const next = remaining[decidedIndex] ?? remaining[decidedIndex - 1];
    setSelectedKey(next ? hitKey(next) : null);
  }

  const items = activeQuery.data?.items ?? [];
  const selectedHit = selectedKey ? items.find((hit) => hitKey(hit) === selectedKey) : undefined;

  return (
    <div>
      <PageHeader title="Fila de revisão" description="Versões de documento recebidas ou em revisão, aguardando decisão." />
      <Section heading="Itens da fila" headingId="review-queue-list">
        <Toolbar>
          <nav aria-label="Filtrar por estado">
            {TABS.map((t) => {
              const count = t.value === "RECEIVED" ? receivedQuery.data?.items.length : underReviewQuery.data?.items.length;
              return (
                <Button key={t.value} variant={t.value === tab ? "primary" : "secondary"} size="sm" aria-current={t.value === tab ? "page" : undefined} onClick={() => handleTabChange(t.value)}>
                  {t.label}
                  {count !== undefined ? ` (${count})` : ""}
                </Button>
              );
            })}
          </nav>
        </Toolbar>

        {activeQuery.isPending ? (
          <InitialLoading label="Carregando fila…" />
        ) : activeQuery.isError ? (
          <ErrorState message={activeQuery.error instanceof ApiError ? activeQuery.error.message : "Não foi possível carregar a fila."} onRetry={() => void activeQuery.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState kind="true-empty" message="Nenhum item nesta fila." />
        ) : (
          <DataTable
            caption="Fila de revisão"
            rowKey={hitKey}
            rows={items}
            columns={[
              {
                key: "document",
                header: "Documento",
                primary: true,
                render: (hit) => (
                  <>
                    <button type="button" className="ui-button ui-button--tertiary" aria-pressed={selectedKey === hitKey(hit)} onClick={() => setSelectedKey(hitKey(hit))}>
                      {hit.document?.documentId ?? hit.version.documentId}
                    </button>
                    <CellSecondary>{ORIGIN_LABEL[hit.version.origin] ?? hit.version.origin}</CellSecondary>
                  </>
                ),
              },
              { key: "subject", header: "Fornecedor", render: (hit) => hit.document?.subjectId ?? "—" },
              { key: "receivedAt", header: "Recebido em", numeric: true, render: (hit) => (hit.version.receivedAt ? formatAbsoluteDate(hit.version.receivedAt) : "—") },
              { key: "reviewer", header: "Revisor", render: (hit) => <ReviewerBadge reviewerId={hit.version.reviewerId} nameFor={nameFor} /> },
            ]}
          />
        )}
      </Section>

      <Section heading="Detalhe do item selecionado" headingId="review-detail">
        {items.length === 0 ? (
          <EmptyState kind="true-empty" message="Nenhum item nesta fila." />
        ) : !selectedHit ? (
          <EmptyState kind="not-ready" message="Selecione um item na lista acima." />
        ) : (
          <DetailPanel
            key={selectedKey}
            hit={selectedHit}
            canWrite={canWrite}
            isAdminOrOwner={isAdminOrOwner}
            claimedByMe={claimedByMe.has(selectedKey ?? "")}
            nameFor={nameFor}
            onClaimed={() => {
              if (selectedKey) markClaimedByMe(selectedKey);
            }}
            onDecided={() => {
              if (selectedKey) advanceAfterDecision(selectedKey);
            }}
          />
        )}
      </Section>
    </div>
  );
}

function scanLabel(pending: number, infected: number): string {
  if (infected > 0) return "Infectado";
  if (pending > 0) return "Verificando…";
  return "Verificado";
}

function DetailPanel({
  hit,
  canWrite,
  isAdminOrOwner,
  claimedByMe,
  nameFor,
  onClaimed,
  onDecided,
}: {
  hit: ReviewQueueHit;
  canWrite: boolean;
  isAdminOrOwner: boolean;
  claimedByMe: boolean;
  nameFor: (userId: string) => string | undefined;
  onClaimed: () => void;
  onDecided: () => void;
}) {
  const { version, document } = hit;
  const claimMutation = useClaimReview(version.documentId, version.seq);
  const acceptMutation = useAcceptVersion(version.documentId, version.seq);
  const rejectMutation = useRejectVersion(version.documentId, version.seq);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<RejectionReason>("EXPIRED");
  const [actionError, setActionError] = useState<string | undefined>();

  const scan = scanLabel(version.pendingFileScans, version.infectedFileScans);
  const isInfected = version.infectedFileScans > 0;
  const isScanPending = version.pendingFileScans > 0;
  const isClaimedByOther = Boolean(version.reviewerId) && !claimedByMe;
  // The service's `assertReviewerOrAdmin` bypass, mirrored here: an OWNER/ADMIN's action bar is
  // NEVER hidden for a claim ownership reason - only a MEMBER acting on someone else's claim is
  // blocked from deciding.
  const memberBlockedByOwnership = isClaimedByOther && !isAdminOrOwner;

  async function handleClaim() {
    setActionError(undefined);
    try {
      await claimMutation.mutateAsync({ expectedVersion: version.version });
      onClaimed();
    } catch (err) {
      if (isConflict(err)) {
        setActionError("Este item já foi reivindicado por outra pessoa — a fila foi atualizada.");
        return;
      }
      setActionError(err instanceof ApiError ? err.message : "Não foi possível reivindicar este item.");
    }
  }

  async function handleAccept() {
    setActionError(undefined);
    try {
      await acceptMutation.mutateAsync({ expectedVersion: version.version });
      onDecided();
    } catch (err) {
      if (isConflict(err)) {
        // Shown, not silently navigated away from (Codex-style lesson: a message the user
        // never sees is not a message) - the queue itself is already stale/invalidated by
        // TanStack Query's own cache; the operator explicitly reselects once they've read this.
        setActionError("Este item já foi decidido por outra pessoa.");
        return;
      }
      setActionError(err instanceof ApiError ? err.message : "Não foi possível aceitar este item.");
    }
  }

  async function handleReject() {
    setActionError(undefined);
    try {
      await rejectMutation.mutateAsync({ expectedVersion: version.version, reason });
      setRejecting(false);
      onDecided();
    } catch (err) {
      if (isConflict(err)) {
        setActionError("Este item já foi decidido por outra pessoa.");
        return;
      }
      setActionError(err instanceof ApiError ? err.message : "Não foi possível rejeitar este item.");
    }
  }

  return (
    <Panel padded>
      <div className="ui-entry-card-grid">
        <DetailList
          fields={[
            { label: "Documento", value: document?.documentId ?? version.documentId },
            { label: "Fornecedor", value: document?.subjectId },
            { label: "Requisito de origem", value: version.requestId },
            { label: "Origem", value: ORIGIN_LABEL[version.origin] ?? version.origin },
            { label: "Contadores de scan", value: `${version.pendingFileScans} pendente(s), ${version.infectedFileScans} infectado(s)` },
          ]}
        />
        <DetailList
          fields={[
            { label: "Recebido em", value: version.receivedAt ? formatAbsoluteDate(version.receivedAt) : undefined },
            { label: "Verificação de segurança", value: scan },
            { label: "Validade proposta", value: version.validUntil ? formatAbsoluteDate(version.validUntil) : "Sem validade" },
            { label: "Revisor", value: version.reviewerId ? (nameFor(version.reviewerId) ?? version.reviewerId) : "Não reivindicado" },
          ]}
        />
      </div>

      {actionError ? (
        <InlineNotice tone="warning" announce="alert">
          {actionError}
        </InlineNotice>
      ) : null}

      {isScanPending ? (
        <InlineNotice tone="info" announce="none">
          Verificando segurança — a decisão de aceitar fica disponível assim que o scan concluir.
        </InlineNotice>
      ) : null}
      {isInfected ? (
        <InlineNotice tone="critical" announce="none">
          Arquivo infectado — esta versão não pode ser aceita.
        </InlineNotice>
      ) : null}

      {!canWrite ? null : memberBlockedByOwnership ? (
        <InlineNotice tone="neutral" announce="none">
          Reivindicado por {version.reviewerId ? (nameFor(version.reviewerId) ?? version.reviewerId) : "outro revisor"}.
        </InlineNotice>
      ) : (
        <div className="a13-actionbar ui-toolbar">
          <div>
            {!version.reviewerId ? (
              <Button variant="secondary" pending={claimMutation.isPending} onClick={() => void handleClaim()}>
                {claimMutation.isPending ? "Reivindicando…" : "Reivindicar"}
              </Button>
            ) : null}
            {isClaimedByOther && isAdminOrOwner ? (
              <InlineNotice tone="neutral" announce="none">
                Reivindicado por {version.reviewerId ? (nameFor(version.reviewerId) ?? version.reviewerId) : "outro revisor"} — você pode decidir mesmo assim.
              </InlineNotice>
            ) : null}
          </div>
          <div>
            {rejecting ? (
              <span>
                <SelectField
                  id="reject-reason"
                  label="Motivo da rejeição"
                  value={reason}
                  onChange={(v) => setReason(v as RejectionReason)}
                  options={REJECTION_REASONS.map((r) => ({ value: r.value, label: r.label }))}
                />
                <Button variant="danger" pending={rejectMutation.isPending} onClick={() => void handleReject()}>
                  {rejectMutation.isPending ? "Rejeitando…" : "Confirmar rejeição"}
                </Button>{" "}
                <Button variant="secondary" onClick={() => setRejecting(false)}>
                  Cancelar
                </Button>
              </span>
            ) : (
              <>
                <Button variant="danger" onClick={() => setRejecting(true)}>
                  Rejeitar
                </Button>{" "}
                {!isInfected ? (
                  <Button variant="primary" disabled={isScanPending} pending={acceptMutation.isPending} onClick={() => void handleAccept()}>
                    {acceptMutation.isPending ? "Aceitando…" : "Aceitar"}
                  </Button>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
