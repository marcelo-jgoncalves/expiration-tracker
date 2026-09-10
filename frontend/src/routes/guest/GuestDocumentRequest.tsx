/**
 * G02 — Solicitação de documento (convidado), Block 6, D-2xx. Fully public, no AppShell, no org
 * context, no RBAC — validated only by the opaque token in the URL + the guest's own session/CSRF
 * cookies (`document-archive-guest-handlers.ts`). See `api/guestDocumentArchive.ts`'s header
 * comment for why this never goes through `apiClient`.
 *
 * TWO real, confirmed deviations from `G02-solicitacao-documento-convidado.md` (the audited
 * spec), investigated directly against the backend before deciding how to adapt, never silently:
 *
 *  1. **`documentTypeId`/name selection never distinguishably fails at submission time.**
 *     `submitEvidence`'s own code collapses EVERY submission failure — including a
 *     since-deprecated `documentTypeId`'s ConditionCheck failing — into the SAME generic
 *     anti-enumeration error as a session/CSRF failure (its own comment: "the guest never sees
 *     which"). The spec's Etapa 3 "tipo descontinuado" specific copy assumes a distinguishable
 *     backend signal that does not exist — this screen uses the spec's OWN generic submission-
 *     failure copy ("Não foi possível enviar. Tente novamente.") for every submission failure,
 *     honestly matching the backend's real, deliberate collapse rather than fabricating a
 *     distinction the API cannot make.
 *  2. **The bare layer-1 GET route is never called** (`resolveCredential` alone) — `startGuestSession`
 *     already resolves the credential internally, so this screen calls only session/document-types/
 *     uploads, matching the three specific CloudFront behaviors added in this block (`infra/
 *     modules/spa-hosting/main.tf`) — the bare token path is reserved for the SPA's own page load.
 *
 * ADR-0013 (D-265) closed the real, pre-existing gap D-264's Codex review round 1 (NEEDS FIXES
 * 7.6/10) had flagged: `submitEvidence` used to accept `fileName` as metadata only, with no real
 * S3 integration. It now persists a real `DocumentFile` (PENDING_UPLOAD) and returns a presigned
 * PUT — Etapa 3 below now completes the real 3-call flow (submit → PUT the bytes directly to S3 →
 * `confirmUploadInFlight`, mirroring the tenant-authenticated 2-phase upload `api/documentArchive.ts`
 * already uses for A07/A12, D-163's shared pipeline). The final-state copy is still deliberately
 * neutral, never claiming the file was REVIEWED/ACCEPTED (only submitted) — that stays correct
 * regardless of storage, since the STARTER/PROMOTER activation gate (D-193) is a separate, still-
 * pending product decision that governs the authenticated path identically (see ADR-0013 §4).
 */
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useIdempotentMutation } from "../../hooks/useIdempotentMutation.js";
import { startGuestSession, listGuestDocumentTypes, submitGuestEvidence, confirmGuestUpload } from "../../api/guestDocumentArchive.js";
import { computeChecksumSha256, uploadDocumentBytes } from "../../api/documents.js";
import { GuestLinkUnavailable } from "../../components/GuestLinkUnavailable.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";
import { Button } from "../../components/ui/Button.js";
import { AsyncFeedback } from "../../components/AsyncStates.js";
import type { GuestDocumentTypeOption, GuestSubmitEvidenceResult } from "../../api/types.js";
import "./GuestDocumentRequest.css";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png"];

type WizardStep = 1 | 2 | 3;

export function GuestDocumentRequest() {
  const { token = "" } = useParams<{ token: string }>();

  const sessionQuery = useQuery({
    queryKey: ["guest", "session", token],
    queryFn: () => startGuestSession(token),
    enabled: token.length > 0,
    retry: false,
  });

  const [step, setStep] = useState<WizardStep>(1);
  const [documentTypeId, setDocumentTypeId] = useState<string | undefined>();
  const [file, setFile] = useState<File | undefined>();
  const [fileError, setFileError] = useState<string | undefined>();
  const [submitted, setSubmitted] = useState(false);

  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [step, submitted, sessionQuery.isError]);

  if (sessionQuery.isPending) {
    return (
      <GuestShell>
        <p role="status" aria-live="polite">
          Carregando…
        </p>
      </GuestShell>
    );
  }

  if (sessionQuery.isError) {
    return (
      <GuestShell>
        <GuestLinkUnavailable requestedItem="evidência" />
      </GuestShell>
    );
  }

  const { subjectDisplayName, requirementName } = sessionQuery.data;
  const description =
    subjectDisplayName && requirementName ? (
      <p>
        {subjectDisplayName} solicitou evidência para o requisito: <strong>{requirementName}</strong>.
      </p>
    ) : null;

  if (submitted) {
    return (
      <GuestShell description={description}>
        <h1 ref={headingRef} tabIndex={-1}>
          Evidência enviada
        </h1>
        <InlineNotice tone="success" announce="status">
          Recebemos sua submissão. Ela será analisada pela equipe responsável — esta confirmação não significa que o documento foi aprovado, e a equipe pode entrar em contato caso precise do arquivo novamente.
        </InlineNotice>
      </GuestShell>
    );
  }

  return (
    <GuestShell description={description}>
      <ol className="guest-steps" aria-label="Etapas">
        <li aria-current={step === 1 ? "step" : undefined}>1. Tipo de documento</li>
        <li aria-current={step === 2 ? "step" : undefined}>2. Arquivo</li>
        <li aria-current={step === 3 ? "step" : undefined}>3. Revisar e enviar</li>
      </ol>

      {step === 1 ? (
        <StepDocumentType
          headingRef={headingRef}
          token={token}
          documentTypeId={documentTypeId}
          onSelect={setDocumentTypeId}
          onContinue={() => setStep(2)}
        />
      ) : null}

      {step === 2 ? (
        <StepFile
          headingRef={headingRef}
          file={file}
          fileError={fileError}
          onFileSelected={(selected) => {
            setFileError(undefined);
            if (selected.size > MAX_FILE_BYTES) {
              setFile(undefined); // Codex review round 1 finding: a rejected file must clear any
              // PREVIOUSLY accepted one too - "Continuar" is gated on `file`, and leaving a stale
              // valid file selected would let the guest advance past a file they never actually
              // re-confirmed.
              setFileError("Arquivo excede o limite de 10 MB.");
              return;
            }
            if (!ACCEPTED_TYPES.includes(selected.type)) {
              setFile(undefined);
              setFileError("Tipo de arquivo não suportado. Envie PDF, JPG ou PNG.");
              return;
            }
            setFile(selected);
          }}
          onBack={() => setStep(1)}
          onContinue={() => setStep(3)}
        />
      ) : null}

      {step === 3 && documentTypeId && file ? (
        <StepReview headingRef={headingRef} token={token} documentTypeId={documentTypeId} file={file} onBack={() => setStep(2)} onSubmitted={() => setSubmitted(true)} />
      ) : null}
    </GuestShell>
  );
}

function GuestShell({ description, children }: { description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="guest-page">
      <p className="guest-wordmark">Expiration Tracker</p>
      <div className="guest-card">
        {description}
        {children}
      </div>
    </div>
  );
}

function StepDocumentType({
  headingRef,
  token,
  documentTypeId,
  onSelect,
  onContinue,
}: {
  headingRef: React.RefObject<HTMLHeadingElement>;
  token: string;
  documentTypeId: string | undefined;
  onSelect: (id: string) => void;
  onContinue: () => void;
}) {
  const typesQuery = useQuery({
    queryKey: ["guest", "documentTypes", token],
    queryFn: () => listGuestDocumentTypes(token),
    retry: false,
  });

  return (
    <div>
      <h1 ref={headingRef} tabIndex={-1}>
        Tipo de documento
      </h1>
      {typesQuery.isPending ? (
        <select disabled aria-label="Tipo de documento">
          <option>Carregando tipos disponíveis…</option>
        </select>
      ) : typesQuery.isError ? (
        <InlineNotice tone="critical" announce="alert" actions={<Button size="sm" variant="secondary" onClick={() => void typesQuery.refetch()}>Tentar novamente</Button>}>
          Não foi possível carregar os tipos de documento aceitos.
        </InlineNotice>
      ) : (
        <>
          <label htmlFor="guest-document-type">Tipo de documento *</label>
          <select id="guest-document-type" value={documentTypeId ?? ""} onChange={(event) => onSelect(event.target.value)}>
            <option value="" disabled>
              Selecione…
            </option>
            {typesQuery.data.documentTypes.map((option: GuestDocumentTypeOption) => (
              <option key={option.documentTypeId} value={option.documentTypeId}>
                {option.displayName}
              </option>
            ))}
          </select>
          {!documentTypeId ? <InlineNotice tone="neutral">Campo obrigatório — não é possível avançar sem selecionar um tipo.</InlineNotice> : null}
        </>
      )}
      <Button variant="primary" disabled={!documentTypeId} onClick={onContinue}>
        Continuar
      </Button>
    </div>
  );
}

function StepFile({
  headingRef,
  file,
  fileError,
  onFileSelected,
  onBack,
  onContinue,
}: {
  headingRef: React.RefObject<HTMLHeadingElement>;
  file: File | undefined;
  fileError: string | undefined;
  onFileSelected: (file: File) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const dropped = event.dataTransfer.files[0];
    if (dropped) onFileSelected(dropped);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (selected) onFileSelected(selected);
  }

  return (
    <div>
      <h1 ref={headingRef} tabIndex={-1}>
        Arquivo
      </h1>
      <div className="guest-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
        <p>Arraste um arquivo ou</p>
        <label className="ui-button ui-button--secondary ui-button--sm">
          Selecionar arquivo
          <input type="file" accept={ACCEPTED_TYPES.join(",")} onChange={handleChange} className="u-visually-hidden" />
        </label>
        <p>PDF, JPG ou PNG · até 10 MB</p>
      </div>
      {fileError ? (
        <InlineNotice tone="critical" announce="alert">
          {fileError}
        </InlineNotice>
      ) : file ? (
        <p>Selecionado: {file.name}</p>
      ) : null}
      <Button variant="ghost" onClick={onBack}>
        Voltar
      </Button>{" "}
      <Button variant="primary" disabled={!file} onClick={onContinue}>
        Continuar
      </Button>
    </div>
  );
}

function StepReview({
  headingRef,
  token,
  documentTypeId,
  file,
  onBack,
  onSubmitted,
}: {
  headingRef: React.RefObject<HTMLHeadingElement>;
  token: string;
  documentTypeId: string;
  file: File;
  onBack: () => void;
  onSubmitted: () => void;
}) {
  const typesQuery = useQuery({ queryKey: ["guest", "documentTypes", token], queryFn: () => listGuestDocumentTypes(token), retry: false });
  const typeLabel = typesQuery.data?.documentTypes.find((t: GuestDocumentTypeOption) => t.documentTypeId === documentTypeId)?.displayName ?? documentTypeId;

  // ADR-0013 (D-265) — the real 3-call flow, all inside ONE mutationFn so a retry after a
  // mid-flow failure (PUT or confirm step) reuses the exact SAME idempotencyKey, never a fresh
  // one (useIdempotentMutation's own contract: only `newIntent()` rotates it). If submitEvidence
  // itself already succeeded on a prior attempt, this replay returns the cached snapshot (with a
  // freshly recomputed uploadUrl, never a stale one) rather than re-creating the DocumentVersion.
  //
  // Codex review round 1 (D-265 implementation) finding, corrected: PUTting the bytes only when
  // `uploadUrl` is present is right, but treating "no uploadUrl" as automatic success was NOT —
  // it conflated "already confirmed by an earlier attempt" with "the window genuinely expired
  // without ever uploading" (a real risk on retry: a replay past the GSI8 deadline, or one whose
  // file already advanced to SCANNING between attempts, both legitimately omit `uploadUrl`).
  // `confirmUploadInFlight`'s own `{extended}` return is the authoritative, server-side signal —
  // `true` for any genuinely non-terminal file (PENDING_UPLOAD or SCANNING, i.e. bytes really are
  // in flight or already landed), `false` for missing/terminal (expired, rejected, or — unreachable
  // today since STARTER/PROMOTER stays off, ADR-0013 §4 — already CLEAN). ALWAYS calling it
  // (never only inside the `if (uploadUrl)` branch) means a retry whose file already advanced past
  // PENDING_UPLOAD still gets a truthful answer instead of being skipped.
  const mutation = useIdempotentMutation<GuestSubmitEvidenceResult, void>({
    mutationFn: async (_input, idempotencyKey) => {
      const checksumSha256 = await computeChecksumSha256(file);
      const result = await submitGuestEvidence(token, {
        fileName: file.name,
        documentTypeId,
        mediaType: file.type,
        contentLength: file.size,
        checksumSha256,
        idempotencyKey,
      });
      if (result.uploadUrl && result.requiredHeaders) {
        await uploadDocumentBytes(result.uploadUrl, result.requiredHeaders, file);
      }
      const confirmation = await confirmGuestUpload(token, { idempotencyKey });
      if (!confirmation.extended) {
        // Never surfaced to the guest as a distinguishing reason (deviation 2 below) - just a
        // real exception so the generic retry copy shows instead of a false "Evidência enviada".
        throw new Error("Guest upload window expired or already resolved without confirmation.");
      }
      return result;
    },
  });

  async function handleSubmit() {
    try {
      await mutation.mutateAsync(undefined);
      onSubmitted();
    } catch {
      // Error surfaced via mutation.isError below - generic copy, see this file's header
      // comment (deviation 2: the backend never distinguishes submission failure causes).
    }
  }

  return (
    <div>
      <h1 ref={headingRef} tabIndex={-1}>
        Revisar e enviar
      </h1>
      <p>
        <strong>Tipo de documento:</strong> {typeLabel}
      </p>
      <p>
        <strong>Arquivo:</strong> {file.name}
      </p>
      <InlineNotice tone="neutral">
        Revise antes de enviar. Após o envio, uma pessoa da equipe responsável pode entrar em contato pelos mesmos meios usados para enviar este link, pedindo a correção de um
        campo específico — mas você não poderá reverter ou reenviar esta submissão por aqui.
      </InlineNotice>
      {mutation.isPending ? <AsyncFeedback state="PENDING" message="Enviando evidência…" /> : null}
      {mutation.isError ? (
        <InlineNotice tone="critical" announce="alert" actions={<Button size="sm" variant="secondary" onClick={() => void handleSubmit()}>Tentar novamente</Button>}>
          Não foi possível enviar. Tente novamente.
        </InlineNotice>
      ) : null}
      <Button variant="ghost" disabled={mutation.isPending} onClick={onBack}>
        Voltar
      </Button>{" "}
      <Button variant="primary" pending={mutation.isPending} onClick={() => void handleSubmit()}>
        Enviar evidência
      </Button>
    </div>
  );
}
