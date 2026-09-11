/**
 * G01 — Upload de convidado (rastreamento legado), Block 7 (D-267). Fully public, no AppShell,
 * no org context, no RBAC - validated only by the opaque token in the URL
 * (`guest-handlers.ts`'s own header comment: "o convidado nunca passa por
 * RequestContextResolver/authorize()"). Reached via `guestLegacyUpload.ts` - see that module's
 * own header comment for why the bare token GET is never called directly (CloudFront routing
 * gap this same block closed, `.../info` alias).
 *
 * Single-step upload (fileName/mediaType/contentLength/checksumSha256 -> presigned PUT), NOT
 * G02's 3-step wizard - the legacy `GuestSubmissionService#startSubmission` has no document-type
 * selection at all (the type is already fixed per the assignment) and no explicit confirm call
 * (unlike G02's ADR-0013 `confirmUploadInFlight` - this legacy Lambda's own `DocumentSubmission`
 * lifecycle is driven entirely by S3-event workers, `submission-finalizer`/`submission-malware-
 * result`, never a client-side confirm). Once the PUT to S3 succeeds, the upload is done - no
 * second call.
 *
 * PENDING, pre-existing, real gap (same one D-266 named for G02, not fixed here): CSP
 * `connect-src 'self'` + no CORS on the quarantine bucket blocks a real browser PUT direct to S3
 * for this path exactly as it does for G02/A07/A12 - needs its own dedicated Claude<->Codex round
 * (see NEXT_SESSION_PROMPT.md), out of scope of this block.
 */
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchLegacyGuestRequestInfo, submitLegacyGuestUpload } from "../../api/guestLegacyUpload.js";
import { computeChecksumSha256, uploadDocumentBytes } from "../../api/documents.js";
import { GuestLinkUnavailable } from "../../components/GuestLinkUnavailable.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";
import { Button } from "../../components/ui/Button.js";
import { AsyncFeedback } from "../../components/AsyncStates.js";
import type { LegacyGuestSubmissionResult } from "../../api/types.js";
import "./GuestDocumentRequest.css";

type Stage = "initial" | "uploading" | "sent" | "upload-error";

export function LegacyGuestUpload() {
  const { token = "" } = useParams<{ token: string }>();

  const infoQuery = useQuery({
    queryKey: ["guest", "legacy", "info", token],
    queryFn: () => fetchLegacyGuestRequestInfo(token),
    enabled: token.length > 0,
    retry: false,
  });

  const [stage, setStage] = useState<Stage>("initial");
  const [file, setFile] = useState<File | undefined>();
  const [fileError, setFileError] = useState<string | undefined>();
  const [submitError, setSubmitError] = useState<string | undefined>();

  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [stage, infoQuery.isError]);

  if (infoQuery.isPending) {
    return (
      <GuestShell>
        <p role="status" aria-live="polite">
          Carregando…
        </p>
      </GuestShell>
    );
  }

  // Anti-enumeration collapse (per spec): invalid/expired/revoked/not-found/already-used token
  // are five internal causes producing exactly ONE external state - never distinguished here.
  if (infoQuery.isError) {
    return (
      <GuestShell>
        <GuestLinkUnavailable requestedItem="documento" />
      </GuestShell>
    );
  }

  const { requirementName, deadline, allowedMediaTypes, maxUploadBytes, requesterDisplayName } = infoQuery.data.request;
  const description = (
    <p>
      <strong>{requesterDisplayName}</strong> solicitou o envio de: <strong>{requirementName}</strong>.
    </p>
  );

  if (stage === "sent") {
    return (
      <GuestShell description={description}>
        <h1 ref={headingRef} tabIndex={-1}>
          Envio recebido
        </h1>
        <InlineNotice tone="success" announce="status">
          Envio recebido. Seu arquivo foi registrado e será analisado pela equipe responsável. Você não receberá uma confirmação de aprovação por este link.
        </InlineNotice>
      </GuestShell>
    );
  }

  function handleFileSelected(selected: File) {
    setFileError(undefined);
    setSubmitError(undefined);
    if (selected.size > maxUploadBytes) {
      setFile(undefined);
      setFileError(`Arquivo maior que ${Math.floor(maxUploadBytes / (1024 * 1024))} MB.`);
      return;
    }
    if (!allowedMediaTypes.includes(selected.type)) {
      setFile(undefined);
      setFileError("Tipo de arquivo não suportado. Envie PDF, JPG ou PNG.");
      return;
    }
    setFile(selected);
  }

  return (
    <GuestShell description={description} deadline={deadline}>
      <h1 ref={headingRef} tabIndex={-1}>
        Enviar documento solicitado
      </h1>
      <UploadForm
        token={token}
        file={file}
        fileError={fileError}
        submitError={submitError}
        stage={stage}
        maxUploadBytes={maxUploadBytes}
        allowedMediaTypes={allowedMediaTypes}
        onFileSelected={handleFileSelected}
        onFileCleared={() => {
          setFile(undefined);
          setFileError(undefined);
        }}
        onSubmitError={setSubmitError}
        onStageChange={setStage}
      />
    </GuestShell>
  );
}

function GuestShell({ description, deadline, children }: { description?: React.ReactNode; deadline?: string; children: React.ReactNode }) {
  return (
    <div className="guest-page">
      <p className="guest-wordmark">Expiration Tracker</p>
      <div className="guest-card">
        {description}
        {children}
        {deadline ? (
          <p className="guest-footer">
            Prazo: {new Date(deadline).toLocaleDateString("pt-BR")} · Este link é de uso único e não requer login.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function UploadForm({
  token,
  file,
  fileError,
  submitError,
  stage,
  maxUploadBytes,
  allowedMediaTypes,
  onFileSelected,
  onFileCleared,
  onSubmitError,
  onStageChange,
}: {
  token: string;
  file: File | undefined;
  fileError: string | undefined;
  submitError: string | undefined;
  stage: Stage;
  maxUploadBytes: number;
  allowedMediaTypes: string[];
  onFileSelected: (file: File) => void;
  onFileCleared: () => void;
  onSubmitError: (message: string | undefined) => void;
  onStageChange: (stage: Stage) => void;
}) {
  // Plain useMutation, not useIdempotentMutation - `StartGuestSubmissionInput`
  // (`guest-submission-service.ts`) takes no idempotency-key field at all, unlike G02's
  // ADR-0013 evidence flow. A retry after a failed PUT re-calls `startSubmission` fresh (a real,
  // pre-existing backend limitation for this legacy path, not something this screen can paper
  // over with a client-only key the server never reads).
  const mutation = useMutation<LegacyGuestSubmissionResult, unknown, void>({
    mutationFn: async () => {
      if (!file) throw new Error("No file selected.");
      const checksumSha256 = await computeChecksumSha256(file);
      const result = await submitLegacyGuestUpload(token, {
        fileName: file.name,
        mediaType: file.type,
        contentLength: file.size,
        checksumSha256,
      });
      await uploadDocumentBytes(result.uploadUrl, result.requiredHeaders, file);
      return result;
    },
  });

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const dropped = event.dataTransfer.files[0];
    if (dropped) onFileSelected(dropped);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (selected) onFileSelected(selected);
  }

  async function handleSubmit() {
    onSubmitError(undefined);
    onStageChange("uploading");
    try {
      await mutation.mutateAsync(undefined);
      onStageChange("sent");
    } catch {
      onSubmitError("Não foi possível enviar. Tente novamente.");
      onStageChange("upload-error");
    }
  }

  const maxMb = Math.floor(maxUploadBytes / (1024 * 1024));

  return (
    <div>
      <div className="guest-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
        <p>Arraste um arquivo ou</p>
        <label className="ui-button ui-button--secondary ui-button--sm">
          Selecionar arquivo
          <input type="file" accept={allowedMediaTypes.join(",")} onChange={handleChange} className="u-visually-hidden" />
        </label>
        <p>PDF, JPG ou PNG · até {maxMb} MB</p>
      </div>
      {fileError ? (
        <InlineNotice tone="critical" announce="alert">
          {fileError}
        </InlineNotice>
      ) : file ? (
        <p aria-live="polite">
          Selecionado: {file.name}{" "}
          <Button type="button" variant="ghost" size="sm" onClick={onFileCleared} disabled={stage === "uploading"}>
            Remover
          </Button>
        </p>
      ) : null}
      {stage === "uploading" ? <AsyncFeedback state="PENDING" message="Enviando arquivo…" /> : null}
      {stage === "upload-error" && submitError ? (
        <InlineNotice tone="critical" announce="alert" actions={<Button size="sm" variant="secondary" onClick={() => void handleSubmit()}>Tentar novamente</Button>}>
          {submitError}
        </InlineNotice>
      ) : null}
      <Button variant="primary" disabled={!file || stage === "uploading"} pending={stage === "uploading"} onClick={() => void handleSubmit()}>
        {stage === "uploading" ? "Enviando…" : "Enviar"}
      </Button>
    </div>
  );
}
