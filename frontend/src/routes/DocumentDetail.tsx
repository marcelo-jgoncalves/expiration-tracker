/**
 * A12 — Document Detail / Version History (Block 5, D-2xx). Post-audit spec
 * (`docs/frontend/prototype-screen-specs/A12-documento-detalhe.md`): route
 * `/app/:orgId/documents/:documentId`, one Document + its chronological (newest-first)
 * DocumentVersion list, plus a 3-step upload wizard and the same claim/accept/reject review
 * decisions A13 exposes (this screen is a second surface for the SAME actions, not a
 * duplicate/competing implementation — every mutation call goes through the same
 * `api/documentArchive.ts` functions A13's reviewer flow would use if routed here instead).
 *
 * RBAC: `docarchive:read` (all 4 roles view). `docarchive:document-metadata-update`/
 * `docarchive:upload` (WRITE_ROLES: OWNER/ADMIN/MEMBER) gates the upload wizard.
 * `docarchive:review` (WRITE_ROLES) + the service's `assertReviewerOrAdmin`
 * (`document-archive-service.ts:2710`) gates claim/accept/reject — OWNER/ADMIN may always
 * decide, a MEMBER only on a version nobody claimed or one THEY personally claimed. Mirrors
 * `ReviewQueue.tsx`'s `memberBlockedByOwnership` pattern exactly, including its named
 * limitation: the BFF session carries no `userId` (Wave B2B-5, D-095/096), so "claimed by me"
 * is approximated with an in-memory set populated the instant THIS session's own claim
 * succeeds — a claim from a previous session/tab reads as "claimed by another reviewer" here
 * until released. Only affects a MEMBER's UI; OWNER/ADMIN's action bar is never gated by it.
 * The backend's `assertReviewerOrAdmin` remains the real, always-correct enforcement.
 *
 * No archive action/route exists for `Document` — deliberately omitted (out of scope, same
 * "omit rather than fabricate a route" precedent `ReviewQueue.tsx` sets for the pre-A12 link).
 */
import { useState } from "react";
import { useParams } from "react-router-dom";
import { useDocument, useDocumentVersions } from "../hooks/useDocumentDetail.js";
import { listDocumentVersions } from "../api/documentArchive.js";
import {
  useReserveUpload,
  useReserveFiles,
  useCommitUpload,
  useClaimDocumentVersion,
  useAcceptDocumentVersion,
  useRejectDocumentVersion,
} from "../hooks/useDocumentVersionActions.js";
import { useCurrentMembershipRole } from "../hooks/useCurrentMembershipRole.js";
import { uploadFileBytes, computeChecksumSha256 } from "../api/documentArchive.js";
import { InitialLoading, ErrorState } from "../components/AsyncStates.js";
import { InlineNotice } from "../components/ui/InlineNotice.js";
import { StatusBadge } from "../components/ui/StatusBadge.js";
import { PageHeader, Section, Panel } from "../components/ui/Layout.js";
import { Button } from "../components/ui/Button.js";
import { SelectField } from "../components/forms/SelectField.js";
import { ApiError, isConflict } from "../api/errors.js";
import { formatAbsoluteDate } from "../api/presentation.js";
import type { DocumentArchiveVersion, RejectionReason, DocumentVersionState } from "../api/types.js";

const STATE_LABEL: Record<DocumentVersionState, { label: string; tone: "neutral" | "warning" | "danger" }> = {
  DRAFT: { label: "Rascunho", tone: "neutral" },
  RECEIVED: { label: "Recebida", tone: "neutral" },
  UNDER_REVIEW: { label: "Em revisão", tone: "warning" },
  ACCEPTED: { label: "Aceita", tone: "neutral" },
  REJECTED: { label: "Rejeitada", tone: "danger" },
  SUPERSEDED: { label: "Substituída", tone: "neutral" },
  WITHDRAWN: { label: "Retirada", tone: "neutral" },
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

export function DocumentDetail() {
  const { documentId } = useParams<{ documentId: string }>();
  const role = useCurrentMembershipRole();
  const canWrite = role === "OWNER" || role === "ADMIN" || role === "MEMBER";
  const isAdminOrOwner = role === "OWNER" || role === "ADMIN";
  const [claimedByMe, setClaimedByMe] = useState<ReadonlySet<number>>(new Set());

  const documentQuery = useDocument(documentId ?? "");
  const versionsQuery = useDocumentVersions(documentId ?? "");

  if (!documentId) {
    return <ErrorState message="Documento não informado." />;
  }

  if (documentQuery.isPending || versionsQuery.isPending) {
    return <InitialLoading label="Carregando documento…" />;
  }

  if (documentQuery.isError) {
    return <ErrorState message={documentQuery.error instanceof ApiError ? documentQuery.error.message : "Não foi possível carregar o documento."} onRetry={() => void documentQuery.refetch()} />;
  }
  if (versionsQuery.isError) {
    return <ErrorState message={versionsQuery.error instanceof ApiError ? versionsQuery.error.message : "Não foi possível carregar o histórico de versões."} onRetry={() => void versionsQuery.refetch()} />;
  }

  const document = documentQuery.data.document;
  const versions = [...versionsQuery.data.versions].sort((a, b) => b.seq - a.seq);

  return (
    <div>
      <PageHeader title={`Documento ${document.documentId}`} description={`Fornecedor ${document.subjectId} · Tipo ${document.documentTypeId} · ${document.status === "ACTIVE" ? "Ativo" : "Arquivado"}`} />

      {canWrite ? (
        <Section heading="Enviar nova versão" headingId="upload-wizard">
          <UploadWizard documentId={documentId} onDone={() => void versionsQuery.refetch()} />
        </Section>
      ) : null}

      <Section heading="Histórico de versões" headingId="version-history">
        {versions.length === 0 ? (
          <Panel padded>
            <InlineNotice tone="info" announce="none">
              Nenhuma versão registrada ainda.
            </InlineNotice>
          </Panel>
        ) : (
          <ol className="a12-version-timeline" aria-label="Histórico de versões, mais recente primeiro">
            {versions.map((version) => (
              <li key={version.seq}>
                <VersionCard
                  documentId={documentId}
                  version={version}
                  canWrite={canWrite}
                  isAdminOrOwner={isAdminOrOwner}
                  claimedByMe={claimedByMe.has(version.seq)}
                  markClaimedByMe={() => setClaimedByMe((prev) => new Set(prev).add(version.seq))}
                />
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

function VersionCard({
  documentId,
  version,
  canWrite,
  isAdminOrOwner,
  claimedByMe,
  markClaimedByMe,
}: {
  documentId: string;
  version: DocumentArchiveVersion;
  canWrite: boolean;
  isAdminOrOwner: boolean;
  claimedByMe: boolean;
  markClaimedByMe: () => void;
}) {
  const claimMutation = useClaimDocumentVersion(documentId, version.seq);
  const acceptMutation = useAcceptDocumentVersion(documentId, version.seq);
  const rejectMutation = useRejectDocumentVersion(documentId, version.seq);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<RejectionReason>("EXPIRED");
  const [actionError, setActionError] = useState<string | undefined>();

  const stateInfo = STATE_LABEL[version.state];
  const decidable = version.state === "RECEIVED" || version.state === "UNDER_REVIEW";
  const isClaimedByOther = Boolean(version.reviewerId) && !claimedByMe;
  const memberBlockedByOwnership = isClaimedByOther && !isAdminOrOwner;
  const anyPending = claimMutation.isPending || acceptMutation.isPending || rejectMutation.isPending;
  const isInfected = version.infectedFileScans > 0;
  const isScanPending = version.pendingFileScans > 0;

  async function handleClaim() {
    setActionError(undefined);
    try {
      await claimMutation.mutateAsync({ expectedVersion: version.version });
      markClaimedByMe();
    } catch (err) {
      if (isConflict(err)) {
        setActionError("Este item já foi reivindicado por outra pessoa.");
        return;
      }
      setActionError(err instanceof ApiError ? err.message : "Não foi possível reivindicar esta versão.");
    }
  }

  async function handleAccept() {
    setActionError(undefined);
    try {
      await acceptMutation.mutateAsync({ expectedVersion: version.version });
    } catch (err) {
      if (isConflict(err)) {
        setActionError("Esta versão já foi decidida por outra pessoa.");
        return;
      }
      setActionError(err instanceof ApiError ? err.message : "Não foi possível aceitar esta versão.");
    }
  }

  async function handleReject() {
    setActionError(undefined);
    try {
      await rejectMutation.mutateAsync({ expectedVersion: version.version, reason });
      setRejecting(false);
    } catch (err) {
      if (isConflict(err)) {
        setActionError("Esta versão já foi decidida por outra pessoa.");
        return;
      }
      setActionError(err instanceof ApiError ? err.message : "Não foi possível rejeitar esta versão.");
    }
  }

  return (
    <Panel padded>
      <div className="a12-version-header">
        <strong>Versão {version.seq}</strong>
        <StatusBadge presentation={{ label: stateInfo.label, tone: stateInfo.tone }} />
      </div>
      <dl className="ui-detail-list">
        <div>
          <dt>Emitida em</dt>
          <dd>{version.issuedAt ? formatAbsoluteDate(version.issuedAt) : "—"}</dd>
        </div>
        <div>
          <dt>Validade</dt>
          <dd>{version.validUntil ? formatAbsoluteDate(version.validUntil) : "Sem validade"}</dd>
        </div>
        <div>
          <dt>Recebida em</dt>
          <dd>{version.receivedAt ? formatAbsoluteDate(version.receivedAt) : "—"}</dd>
        </div>
        <div>
          <dt>Revisor</dt>
          <dd>{version.reviewerId ?? "Não reivindicado"}</dd>
        </div>
        {version.state === "REJECTED" && version.rejectionReason ? (
          <div>
            <dt>Motivo da rejeição</dt>
            <dd>{REJECTION_REASONS.find((r) => r.value === version.rejectionReason)?.label ?? version.rejectionReason}</dd>
          </div>
        ) : null}
      </dl>

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

      {!canWrite || !decidable ? null : memberBlockedByOwnership ? (
        <InlineNotice tone="neutral" announce="none">
          Reivindicada por {version.reviewerId ?? "outro revisor"}.
        </InlineNotice>
      ) : (
        <div className="a12-actionbar ui-toolbar">
          <div>
            {!version.reviewerId ? (
              <Button variant="secondary" disabled={anyPending && !claimMutation.isPending} pending={claimMutation.isPending} onClick={() => void handleClaim()}>
                {claimMutation.isPending ? "Reivindicando…" : "Reivindicar"}
              </Button>
            ) : null}
            {isClaimedByOther && isAdminOrOwner ? (
              <InlineNotice tone="neutral" announce="none">
                Reivindicada por {version.reviewerId ?? "outro revisor"} — você pode decidir mesmo assim.
              </InlineNotice>
            ) : null}
          </div>
          <div>
            {rejecting ? (
              <span>
                <SelectField
                  id={`reject-reason-${version.seq}`}
                  label="Motivo da rejeição"
                  value={reason}
                  onChange={(v) => setReason(v as RejectionReason)}
                  options={REJECTION_REASONS.map((r) => ({ value: r.value, label: r.label }))}
                />
                <Button variant="danger" disabled={anyPending && !rejectMutation.isPending} pending={rejectMutation.isPending} onClick={() => void handleReject()}>
                  {rejectMutation.isPending ? "Rejeitando…" : "Confirmar rejeição"}
                </Button>{" "}
                <Button variant="secondary" disabled={anyPending} onClick={() => setRejecting(false)}>
                  Cancelar
                </Button>
              </span>
            ) : (
              <>
                <Button variant="danger" disabled={anyPending} onClick={() => setRejecting(true)}>
                  Rejeitar
                </Button>{" "}
                {!isInfected ? (
                  <Button variant="primary" disabled={isScanPending || (anyPending && !acceptMutation.isPending)} pending={acceptMutation.isPending} onClick={() => void handleAccept()}>
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

type UploadStep = "idle" | "reserving" | "reserved" | "uploading-files" | "upload-failed" | "files-reserved" | "committing" | "done";

/** The 3-step upload flow, modeled as sequential UI state (not one button): (1) reserve a new
 * version (`reserveUpload`), (2) reserve+presign a file batch for it and PUT the bytes to
 * storage (`reserveFiles` + direct-to-storage PUT), (3) commit (`commitUpload`, DRAFT ->
 * RECEIVED). Each step can fail independently and the wizard surfaces exactly which one did —
 * never collapsed into a single opaque "upload" action. */
function UploadWizard({ documentId, onDone }: { documentId: string; onDone: () => void }) {
  const reserveUploadMutation = useReserveUpload(documentId);
  const [seq, setSeq] = useState<number | undefined>();
  const [expectedVersion, setExpectedVersion] = useState<number | undefined>();
  const reserveFilesMutation = useReserveFiles(documentId, seq ?? 0);
  const commitMutation = useCommitUpload(documentId, seq ?? 0);
  const [step, setStep] = useState<UploadStep>("idle");
  const [file, setFile] = useState<File | undefined>();
  const [error, setError] = useState<string | undefined>();
  // Codex review round 1 finding: `reserveFiles` seals the file set in the SAME transaction
  // that reserves it (D-163 §2's `fileSetSealed` fence) - once that call succeeds, calling it
  // again for a retry would fail with "file set is already sealed" even though the caller's
  // real problem was only the follow-up storage PUT. So a PUT failure must retry ONLY the PUT
  // against the already-reserved URL, never re-run `reserveFiles`.
  const [reservedUpload, setReservedUpload] = useState<{ uploadUrl: string; requiredHeaders: Record<string, string> } | undefined>();

  async function handleReserveVersion() {
    setError(undefined);
    setStep("reserving");
    try {
      const { version } = await reserveUploadMutation.mutateAsync({ origin: "MANUAL_UPLOAD" });
      setSeq(version.seq);
      setExpectedVersion(version.version);
      setStep("reserved");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível reservar uma nova versão.");
      setStep("idle");
    }
  }

  async function handleReserveAndUploadFile() {
    if (!file || seq === undefined || expectedVersion === undefined) return;
    setError(undefined);
    setStep("uploading-files");
    // Local, not the `reservedUpload` state var - `setReservedUpload` below only SCHEDULES a
    // re-render, it does not update this closure's already-captured `reservedUpload` value, so
    // the catch block below must consult this local flag to know whether reserveFiles already
    // committed on the backend (a real stale-closure bug found while writing this fix).
    let reservedThisAttempt: { uploadUrl: string; requiredHeaders: Record<string, string> } | undefined;
    try {
      const checksumSha256 = await computeChecksumSha256(file);
      const { files } = await reserveFilesMutation.mutateAsync({
        expectedVersion,
        files: [{ role: "PRINCIPAL", mediaType: file.type || "application/octet-stream", contentLength: file.size, checksumSha256 }],
      });
      const reserved = files[0];
      if (!reserved) throw new Error("Nenhum arquivo reservado.");
      reservedThisAttempt = { uploadUrl: reserved.uploadUrl, requiredHeaders: reserved.requiredHeaders };
      setReservedUpload(reservedThisAttempt);
      // Codex review round 1 finding: `reserveFiles`'s own TransactWriteItems (D-163 §2) updates
      // the DocumentVersion row (fileSetSealed/principalFileId/totalFiles) - its OCC `version`
      // has advanced past what `reserveUpload` returned. Re-reading the version here (rather
      // than reusing the stale `expectedVersion`) is what makes `commitUpload`'s OCC check pass
      // instead of always conflicting.
      const { versions } = await listDocumentVersions(documentId);
      const refreshed = versions.find((v) => v.seq === seq);
      if (refreshed) setExpectedVersion(refreshed.version);
      await uploadFileBytes(reserved.uploadUrl, reserved.requiredHeaders, file);
      setStep("files-reserved");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Não foi possível enviar o arquivo.");
      // If the file set was already reserved/sealed on the backend before the failure, land on
      // "upload-failed" so the retry button below retries ONLY the PUT - never "reserved"
      // (which would let the user hit "Enviar arquivo" again and re-run `reserveFiles` against
      // an already-sealed set, D-163 §2's `fileSetSealed` fence).
      setStep(reservedThisAttempt ? "upload-failed" : "reserved");
    }
  }

  async function handleRetryUploadOnly() {
    if (!file || !reservedUpload) return;
    setError(undefined);
    setStep("uploading-files");
    try {
      await uploadFileBytes(reservedUpload.uploadUrl, reservedUpload.requiredHeaders, file);
      setStep("files-reserved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível enviar o arquivo.");
      setStep("upload-failed");
    }
  }

  async function handleCommit() {
    if (expectedVersion === undefined) return;
    setError(undefined);
    setStep("committing");
    try {
      await commitMutation.mutateAsync({ expectedVersion });
      setStep("done");
      onDone();
    } catch (err) {
      if (isConflict(err)) {
        setError("O conjunto de arquivos ainda não está pronto ou a versão foi alterada — tente novamente.");
      } else {
        setError(err instanceof ApiError ? err.message : "Não foi possível concluir o envio.");
      }
      setStep("files-reserved");
    }
  }

  function reset() {
    setSeq(undefined);
    setExpectedVersion(undefined);
    setFile(undefined);
    setReservedUpload(undefined);
    setError(undefined);
    setStep("idle");
  }

  return (
    <Panel padded>
      {error ? (
        <InlineNotice tone="warning" announce="alert">
          {error}
        </InlineNotice>
      ) : null}

      {step === "done" ? (
        <>
          <InlineNotice tone="info" announce="none">
            Versão {seq} enviada com sucesso e aguardando revisão.
          </InlineNotice>
          <Button variant="secondary" onClick={reset}>
            Enviar outra versão
          </Button>
        </>
      ) : (
        <ol className="a12-upload-wizard">
          <li>
            <p>1. Reservar nova versão</p>
            <Button variant="primary" disabled={step !== "idle"} pending={step === "reserving"} onClick={() => void handleReserveVersion()}>
              {seq !== undefined ? `Versão ${seq} reservada` : "Reservar versão"}
            </Button>
          </li>
          <li>
            <p>2. Selecionar e enviar arquivo</p>
            <input
              type="file"
              aria-label="Selecionar arquivo"
              disabled={seq === undefined || step === "files-reserved" || step === "committing" || Boolean(reservedUpload)}
              onChange={(e) => setFile(e.target.files?.[0])}
            />
            {step === "upload-failed" ? (
              // The file batch is already reserved/sealed on the backend (D-163 §2) - only the
              // storage PUT failed, so retry ONLY the PUT, never re-run reserveFiles.
              <Button variant="primary" pending={false} onClick={() => void handleRetryUploadOnly()}>
                Tentar enviar novamente
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={seq === undefined || !file || step === "files-reserved" || step === "committing"}
                pending={step === "uploading-files"}
                onClick={() => void handleReserveAndUploadFile()}
              >
                {step === "files-reserved" ? "Arquivo enviado" : "Enviar arquivo"}
              </Button>
            )}
          </li>
          <li>
            <p>3. Concluir envio</p>
            <Button variant="primary" disabled={step !== "files-reserved"} pending={step === "committing"} onClick={() => void handleCommit()}>
              Concluir
            </Button>
          </li>
        </ol>
      )}
    </Panel>
  );
}
