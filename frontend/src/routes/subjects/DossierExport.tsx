/**
 * A17 — Exportar dossiê do fornecedor (Block 10, D-2xx). `docarchive:dossier-export`, OWNER+ADMIN
 * exclusively - NO assignee/responsible-party exception (D-205, confirmed correct in a 2026-09-10
 * audit, deliberately not softened here even for the Subject's own MEMBER/VIEWER owner).
 *
 * Real 3-stage wizard now buildable in full - the preview/confirm/download routes all exist for
 * real (`api/requirements.ts`'s own header comment on `downloadDossierExport` has the full
 * investigation, including the real gap this screen works around: there is no dedicated "get run
 * status" route, so `pollDossierExportRun` derives status from the download route's own
 * success/ConflictError outcome).
 *
 * `runId` lives in the URL (`?runId=`) rather than only in component state, matching the spec's
 * own requirement that leaving this screen mid-generation and returning later resumes the SAME
 * run rather than forcing a fresh preview - the only way to resume the real backend run without a
 * dedicated "get run" route is to already know its id, and the URL is the one place that survives
 * a full reload.
 *
 * Codex review round (Block 10) findings, fixed:
 *  - Polling used `retry: false`, so a single transient network/5xx hiccup on the FIRST poll
 *    permanently stopped polling forever (no data ever landed for `refetchInterval`'s own
 *    condition to re-arm) - a small bounded retry now absorbs a transient blip, and a genuine
 *    persistent failure surfaces its own retry action instead of leaving the screen stuck on
 *    "Gerando dossiê…" forever.
 *  - A failure at the final "Baixar dossiê" click (expired run, network, any non-2xx) was
 *    silently swallowed - now surfaces a real error with its own retry.
 *  - `confirmDossierExport`'s CONFLICT can come from two backend causes indistinguishable from
 *    this side (`document-archive-service.ts`'s `confirmDossierExport`: a genuine `scopeHash`
 *    mismatch, OR a concurrent-write OCC race) - verified directly against that file. This
 *    frontend can never actually detect "the Subject's data changed", contrary to what the
 *    previous copy claimed ("O escopo mudou...") - the message is now neutral about the cause
 *    while still offering the same safe recovery (refresh the preview).
 *  - Format selection (PDF/Excel) is now the existing `RadioGroup` component (real native radio
 *    inputs, one group, accessible name/state/relationship) instead of two unrelated buttons.
 *  - Focus now moves to each new stage's own heading/status on every real stage transition
 *    (`preview` -> `generating` -> `ready`/`failed`), per the spec's explicit requirement -
 *    previously only `aria-live` announced it, never actual focus.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useOrgPath } from "../../routing/useOrgPath.js";
import { useSubject } from "../../hooks/useSubject.js";
import { useCurrentMembershipRole } from "../../hooks/useCurrentMembershipRole.js";
import { previewDossierExport, confirmDossierExport, pollDossierExportRun, downloadDossierExport, type DossierPreviewRow } from "../../api/requirements.js";
import { ApiError, isConflict } from "../../api/errors.js";
import { InitialLoading, ErrorState, EmptyState, AsyncFeedback } from "../../components/AsyncStates.js";
import { PageHeader, Panel } from "../../components/ui/Layout.js";
import { Button } from "../../components/ui/Button.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";
import { RadioGroup } from "../../components/ui/RadioGroup.js";
import type { DossierExportFormat, DossierExportRunStatus, MembershipRole } from "../../api/types.js";

function canExportDossier(role: MembershipRole | undefined): boolean {
  return role === "OWNER" || role === "ADMIN";
}

const GENERATING_STATUSES = new Set<DossierExportRunStatus>(["CONFIRMED", "GENERATING"]);
const SLOW_GENERATION_THRESHOLD_MS = 45_000;
const POLL_INTERVAL_MS = 3_000;
const POLL_RETRY_COUNT = 2;

export function DossierExport() {
  const { subjectId = "" } = useParams<{ subjectId: string }>();
  const orgPath = useOrgPath();
  const role = useCurrentMembershipRole();
  const [searchParams, setSearchParams] = useSearchParams();
  const runId = searchParams.get("runId") ?? undefined;

  const subjectQuery = useSubject(subjectId);

  const [preview, setPreview] = useState<
    { kind: "idle" } | { kind: "loading" } | { kind: "loaded"; runId: string; scopeHash: string; rows: DossierPreviewRow[] } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [format, setFormat] = useState<DossierExportFormat>("pdf");
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | undefined>();
  const [staleScope, setStaleScope] = useState(false);
  const generationStartedAt = useRef<number | undefined>(undefined);

  const canExport = canExportDossier(role);

  useEffect(() => {
    if (!canExport || runId) return;
    let cancelled = false;
    setPreview({ kind: "loading" });
    setStaleScope(false);
    previewDossierExport(subjectId)
      .then(({ run, rows }) => {
        if (!cancelled) setPreview({ kind: "loaded", runId: run.runId, scopeHash: run.scopeHash, rows });
      })
      .catch((err: unknown) => {
        if (!cancelled) setPreview({ kind: "error", message: err instanceof ApiError ? err.message : "Não foi possível pré-visualizar o dossiê." });
      });
    return () => {
      cancelled = true;
    };
  }, [subjectId, runId, canExport]);

  const pollQuery = useQuery<{ status: DossierExportRunStatus }, unknown>({
    queryKey: ["dossier-export-run", subjectId, runId],
    queryFn: () => pollDossierExportRun(subjectId, runId ?? ""),
    enabled: Boolean(runId) && canExport,
    retry: POLL_RETRY_COUNT,
    refetchInterval: (query) => (query.state.data && GENERATING_STATUSES.has(query.state.data.status) ? POLL_INTERVAL_MS : false),
  });

  useEffect(() => {
    if (runId && generationStartedAt.current === undefined) generationStartedAt.current = Date.now();
    if (!runId) generationStartedAt.current = undefined;
  }, [runId]);

  if (role !== undefined && !canExport) {
    return (
      <>
        <PageHeader title="Exportar dossiê" />
        <Panel>
          <EmptyState kind="permission-limited" message="Exportar dossiê é restrito a OWNER e ADMIN desta organização." />
        </Panel>
      </>
    );
  }

  if (subjectQuery.isPending) return <InitialLoading label="Carregando fornecedor…" />;
  if (subjectQuery.isError) {
    const message = subjectQuery.error instanceof ApiError ? subjectQuery.error.message : "Não foi possível carregar este fornecedor.";
    return <ErrorState message={message} onRetry={() => void subjectQuery.refetch()} />;
  }
  const subject = subjectQuery.data.subject;

  async function handleConfirm() {
    if (preview.kind !== "loaded") return;
    setConfirming(true);
    setConfirmError(undefined);
    try {
      await confirmDossierExport(subjectId, preview.runId, preview.scopeHash);
      setSearchParams({ runId: preview.runId });
    } catch (err) {
      if (isConflict(err)) {
        setStaleScope(true);
        return;
      }
      setConfirmError(err instanceof ApiError ? err.message : "Não foi possível gerar o dossiê agora.");
    } finally {
      setConfirming(false);
    }
  }

  function handleRefreshPreview() {
    setPreview({ kind: "idle" });
    setStaleScope(false);
    // Re-runs the effect above on next render (runId is still undefined at this stage).
    void previewDossierExport(subjectId)
      .then(({ run, rows }) => setPreview({ kind: "loaded", runId: run.runId, scopeHash: run.scopeHash, rows }))
      .catch((err: unknown) => setPreview({ kind: "error", message: err instanceof ApiError ? err.message : "Não foi possível pré-visualizar o dossiê." }));
  }

  function handleNewDossier() {
    setSearchParams({});
  }

  return (
    <>
      <PageHeader above={<Link to={orgPath(`/subjects/${subjectId}`)}>← Voltar para {subject.displayName}</Link>} title="Exportar dossiê" description={`${subject.displayName} · pacote de conformidade em PDF ou Excel.`} />
      <Panel>
        {!runId ? (
          <PreviewStage
            preview={preview}
            format={format}
            onFormatChange={setFormat}
            staleScope={staleScope}
            confirming={confirming}
            confirmError={confirmError}
            onConfirm={() => void handleConfirm()}
            onRefreshPreview={handleRefreshPreview}
          />
        ) : (
          <GenerationStage
            subjectId={subjectId}
            runId={runId}
            pollQuery={pollQuery}
            format={format}
            generationStartedAt={generationStartedAt.current}
            onNewDossier={handleNewDossier}
          />
        )}
      </Panel>
    </>
  );
}

function PreviewStage({
  preview,
  format,
  onFormatChange,
  staleScope,
  confirming,
  confirmError,
  onConfirm,
  onRefreshPreview,
}: {
  preview: { kind: "idle" } | { kind: "loading" } | { kind: "loaded"; runId: string; scopeHash: string; rows: DossierPreviewRow[] } | { kind: "error"; message: string };
  format: DossierExportFormat;
  onFormatChange: (format: DossierExportFormat) => void;
  staleScope: boolean;
  confirming: boolean;
  confirmError: string | undefined;
  onConfirm: () => void;
  onRefreshPreview: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (preview.kind === "loaded") headingRef.current?.focus();
  }, [preview.kind]);

  if (preview.kind === "idle" || preview.kind === "loading") {
    return <InitialLoading label="Carregando pré-visualização…" />;
  }
  if (preview.kind === "error") {
    return <ErrorState message={preview.message} onRetry={onRefreshPreview} />;
  }

  return (
    <div>
      <section aria-labelledby="dossier-scope-heading">
        <h3 id="dossier-scope-heading" ref={headingRef} tabIndex={-1}>
          Escopo (congelado nesta pré-visualização)
        </h3>
        <p>Requisitos incluídos: {preview.rows.length}</p>
        <p title="Identifica exatamente esta versão do escopo. Se os dados mudarem antes de você confirmar, você será avisado e poderá atualizar a pré-visualização.">Hash do escopo: {preview.scopeHash}</p>
      </section>
      <RadioGroup
        legend="Formato"
        required
        name="dossier-format"
        value={format}
        onChange={(value) => onFormatChange(value as DossierExportFormat)}
        options={[
          { value: "pdf", label: "PDF" },
          { value: "xlsx", label: "Excel" },
        ]}
      />
      <InlineNotice tone="neutral">Apenas OWNER e ADMIN podem exportar o dossiê, mesmo que sejam o responsável direto pelo fornecedor.</InlineNotice>
      {staleScope ? (
        <InlineNotice tone="warning" announce="alert" actions={<Button size="sm" variant="secondary" onClick={onRefreshPreview}>Atualizar pré-visualização</Button>}>
          {/* Codex review round finding: the backend's confirm route returns the SAME generic
              CONFLICT for a real scopeHash mismatch AND for an unrelated concurrent-write OCC race
              (verified directly against confirmDossierExport in document-archive-service.ts) -
              this frontend cannot actually tell which happened, so the copy stays neutral about
              cause rather than claiming a specific one it can't prove. */}
          Não foi possível confirmar a geração agora. Atualize a pré-visualização e tente novamente.
        </InlineNotice>
      ) : (
        <>
          {confirmError ? (
            <InlineNotice tone="critical" announce="alert">
              {confirmError}
            </InlineNotice>
          ) : null}
          <Button variant="primary" pending={confirming} onClick={onConfirm}>
            {confirming ? "Gerando…" : "Confirmar e gerar"}
          </Button>
        </>
      )}
    </div>
  );
}

function GenerationStage({
  subjectId,
  runId,
  pollQuery,
  format,
  generationStartedAt,
  onNewDossier,
}: {
  subjectId: string;
  runId: string;
  pollQuery: { data?: { status: DossierExportRunStatus }; isPending: boolean; isError: boolean; error: unknown; refetch: () => void };
  format: DossierExportFormat;
  generationStartedAt: number | undefined;
  onNewDossier: () => void;
}) {
  const [slow, setSlow] = useState(false);
  const [downloadError, setDownloadError] = useState<string | undefined>();
  const [downloading, setDownloading] = useState(false);
  const statusHeadingRef = useRef<HTMLHeadingElement>(null);
  const status = pollQuery.data?.status;
  const stageKey = pollQuery.isPending ? "pending" : pollQuery.isError ? "error" : (status ?? "unknown");

  useEffect(() => {
    statusHeadingRef.current?.focus();
  }, [stageKey]);

  useEffect(() => {
    if (!generationStartedAt) return;
    const elapsed = Date.now() - generationStartedAt;
    if (elapsed >= SLOW_GENERATION_THRESHOLD_MS) {
      setSlow(true);
      return;
    }
    const timeout = setTimeout(() => setSlow(true), SLOW_GENERATION_THRESHOLD_MS - elapsed);
    return () => clearTimeout(timeout);
  }, [generationStartedAt]);

  async function handleDownload() {
    setDownloadError(undefined);
    setDownloading(true);
    try {
      const { downloadUrl } = await downloadDossierExport(subjectId, runId, format);
      window.location.assign(downloadUrl);
    } catch (err) {
      // Codex review round finding: this used to be an empty catch, silently doing nothing on a
      // real failure (expired run, network, any non-2xx) - now surfaces it with a retry.
      setDownloadError(err instanceof ApiError ? err.message : "Não foi possível baixar o dossiê agora.");
    } finally {
      setDownloading(false);
    }
  }

  if (pollQuery.isPending) {
    return <AsyncFeedback state="PROCESSING" message="Gerando dossiê…" />;
  }

  // Codex review round finding: `retry: false` used to mean a single transient poll failure
  // stopped polling forever (no data ever existed for `refetchInterval`'s own re-arm condition) -
  // the query now retries a couple of times on its own; if it still fails, offer a real retry
  // instead of leaving the screen stuck on a generic "Gerando…" with no way forward.
  if (pollQuery.isError) {
    return (
      <InlineNotice tone="critical" announce="alert" actions={<Button size="sm" variant="secondary" onClick={() => void pollQuery.refetch()}>Tentar novamente</Button>}>
        Não foi possível verificar o andamento da geração agora.
      </InlineNotice>
    );
  }

  if (status === "READY") {
    return (
      <div>
        <h3 ref={statusHeadingRef} tabIndex={-1} className="u-visually-hidden">
          Dossiê gerado
        </h3>
        <InlineNotice tone="success" announce="status">
          Dossiê gerado.
        </InlineNotice>
        <p>Formato selecionado: {format === "pdf" ? "PDF" : "Excel"}.</p>
        {downloadError ? (
          <InlineNotice tone="critical" announce="alert">
            {downloadError}
          </InlineNotice>
        ) : null}
        <Button variant="primary" pending={downloading} onClick={() => void handleDownload()}>
          {downloading ? "Baixando…" : "Baixar dossiê"}
        </Button>
      </div>
    );
  }

  if (status === "FAILED" || status === "TOO_LARGE") {
    return (
      <div>
        <h3 ref={statusHeadingRef} tabIndex={-1} className="u-visually-hidden">
          {status === "TOO_LARGE" ? "Pacote muito grande" : "Falha na geração"}
        </h3>
        <InlineNotice tone="critical" announce="alert" actions={<Button size="sm" variant="secondary" onClick={onNewDossier}>Tentar novamente</Button>}>
          {status === "TOO_LARGE" ? "O pacote excedeu o limite de tamanho." : "Não foi possível gerar o dossiê."}
        </InlineNotice>
      </div>
    );
  }

  return (
    <div>
      <h3 ref={statusHeadingRef} tabIndex={-1} className="u-visually-hidden">
        Gerando dossiê
      </h3>
      <AsyncFeedback state="PROCESSING" message="Gerando dossiê…" />
      {slow ? (
        <InlineNotice tone="neutral">Isso está demorando mais que o esperado. O processamento continua no backend — você pode voltar mais tarde.</InlineNotice>
      ) : null}
    </div>
  );
}
