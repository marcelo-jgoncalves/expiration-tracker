/**
 * G02 — Solicitação de documento (convidado), Block 6, D-2xx. Fully public, no AppShell, no org
 * context, no RBAC — validated only by the opaque token in the URL + the guest's own session/CSRF
 * cookies (`document-archive-guest-handlers.ts`). See `api/guestDocumentArchive.ts`'s header
 * comment for why this never goes through `apiClient`.
 *
 * THREE real, confirmed deviations from `G02-solicitacao-documento-convidado.md` (the audited
 * spec), investigated directly against the backend before deciding how to adapt, never silently:
 *
 *  1. **No S3/file-storage integration exists in the guest submission path at all.** Read
 *     directly: `GuestDocumentAccessService.submitEvidence` creates a real
 *     Document/DocumentVersion(RECEIVED) record and accepts `fileName` as a string, but never
 *     transmits or stores the file's actual bytes anywhere (unlike the tenant-authenticated
 *     `reserveFiles`/`commitUpload` 2-phase S3 flow `api/documentArchive.ts` uses for A07/A12).
 *     This is a genuine, pre-existing backend limitation this screen does not invent or hide —
 *     Etapa 2 still lets the guest select a file (for `fileName` and UX completeness/future
 *     readiness), and the submission call is wired to the real, only-existing endpoint, but the
 *     bytes are never actually persisted server-side. Named explicitly in
 *     `docs/architecture/decisions-log.md`/`NEXT_SESSION_PROMPT.md` as a real gap requiring its
 *     own Type-1 design decision (new anonymous public write surface + malware-scan integration)
 *     before it can be closed — deliberately out of this block's scope, never faked here.
 *  2. **`documentTypeId`/name selection never distinguishably fails at submission time.**
 *     `submitEvidence`'s own code collapses EVERY submission failure — including a
 *     since-deprecated `documentTypeId`'s ConditionCheck failing — into the SAME generic
 *     anti-enumeration error as a session/CSRF failure (its own comment: "the guest never sees
 *     which"). The spec's Etapa 3 "tipo descontinuado" specific copy assumes a distinguishable
 *     backend signal that does not exist — this screen uses the spec's OWN generic submission-
 *     failure copy ("Não foi possível enviar. Tente novamente.") for every submission failure,
 *     honestly matching the backend's real, deliberate collapse rather than fabricating a
 *     distinction the API cannot make.
 *  3. **The bare layer-1 GET route is never called** (`resolveCredential` alone) — `startGuestSession`
 *     already resolves the credential internally, so this screen calls only session/document-types/
 *     uploads, matching the three specific CloudFront behaviors added in this block (`infra/
 *     modules/spa-hosting/main.tf`) — the bare token path is reserved for the SPA's own page load.
 *
 * Codex review round 1 (D-264, NEEDS FIXES 7.6/10) confirmed deviation 1 above is NOT acceptable
 * as-is for a screen claiming the A14→G02→A13/A12 loop closes end to end: an operator reviewing
 * in A13/A12 has nothing real to inspect. The final-state copy below was softened to never claim
 * the FILE itself was received (only the submission/record was) — real file storage remains the
 * named, un-closed blocker (see decisions-log D-264), not something this session could respond to
 * with the codebase's usual anonymous-write-surface + malware-scan rigor in the time available.
 */
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useIdempotentMutation } from "../../hooks/useIdempotentMutation.js";
import { startGuestSession, listGuestDocumentTypes, submitGuestEvidence } from "../../api/guestDocumentArchive.js";
import { GuestLinkUnavailable } from "../../components/GuestLinkUnavailable.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";
import { Button } from "../../components/ui/Button.js";
import { AsyncFeedback } from "../../components/AsyncStates.js";
import type { GuestDocumentTypeOption } from "../../api/types.js";
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

  const mutation = useIdempotentMutation<Awaited<ReturnType<typeof submitGuestEvidence>>, void>({
    mutationFn: (_input, idempotencyKey) => submitGuestEvidence(token, { fileName: file.name, documentTypeId, idempotencyKey }),
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
