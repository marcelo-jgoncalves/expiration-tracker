/**
 * A15 — Importação em massa (CSV), Block 9 (Tier 1: async-state/partial-success complexity per
 * `implementation-sequencing-plan.md` §3, even though its RBAC surface is lighter than the
 * tier's other members).
 *
 * `docs/frontend/prototype-screen-specs/A15-importacao-csv.md` is the authoritative UX spec, but
 * three real gaps between it and the actual backend (`src/modules/import/`, verified directly
 * against the code, never guessed) force deliberate, documented deviations from its literal text:
 *
 *  1. `POST /imports` has no `targetEntityType` input — every job this screen can create is
 *     hardcoded `TrackedSubject` server-side (`ImportService.reserveImport`). "Documentos e
 *     Requisitos" (the spec's PageHeader copy) have no real creation entry point yet — this
 *     screen only ever imports Fornecedores. Copy below says so honestly instead of promising a
 *     capability that doesn't exist.
 *  2. Dedupe is automatic-skip only — a duplicate row is never created NOR updated
 *     (`import-parse-service.ts`'s `SKIP_DUPLICATE` outcome), counted in `duplicateRows`. There
 *     is no per-row "Atualizar existente/Criar como novo" choice anywhere in the backend, so the
 *     spec's dedupe radio-per-row block does not exist here — the preview step states the real
 *     automatic-skip behavior instead.
 *  3. No endpoint exposes per-row preview/outcome data (`ImportRowOutcome` is DynamoDB-only,
 *     queried by no allowlisted route) — the preview/result steps can only show the aggregate
 *     counters `GET /imports/{jobId}` actually returns (`totalRows`/`acceptedRows`/
 *     `rejectedRows`/`duplicateRows`), never a per-row `DataTable`, and there is no "ver
 *     relatório de erros" link (nothing to link to). A commit that FAILS (`ENTITLEMENT_EXCEEDED`/
 *     `TENANT_NOT_ACTIVE`/plan-integrity mismatch) also has no retry endpoint — `requestCommit()`
 *     requires `PREVIEW_READY`, which a failed job can never return to — so "Tentar novamente"
 *     is honestly "envie o mesmo arquivo de novo" (dedupe skips the rows already committed),
 *     never a literal retry of the same job.
 *
 * Real limits used in copy/validation below are the backend's actual ceilings
 * (`import-job.ts`'s `MAX_IMPORT_FILE_BYTES`/`MAX_IMPORT_ROWS` — 5 MiB / 5,000 rows), not the
 * spec's aspirational "20 MB / 10.000 linhas".
 *
 *  4. (Codex review round 1, real CONFIRMED finding, fixed) The spec's "mapping" step cannot
 *     safely be an editable form while a job is `UPLOADED` — every job this screen creates
 *     already has `columnMapping` populated at creation, so the S3-triggered parse worker races
 *     to claim `UPLOADED -> PARSING` the instant the upload lands. A client mapping submission
 *     that wins that race writes `UPLOADED -> UPLOADED` (no new parse dispatched) and can
 *     permanently orphan the job once the worker's own claim then loses OCC and gives up for
 *     good (see `stepIdForJob`'s own comment). The editable form is offered ONLY for
 *     `AWAITING_MAPPING` (unreachable via this screen's only creation path today, but the correct
 *     state to eventually wire a `Document`/`Requirement` creation entry point onto) —
 *     `UPLOADED` renders the same safe "please wait" view as `PARSING`.
 */
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useOrgPath } from "../../routing/useOrgPath.js";
import { useCurrentMembershipRole } from "../../hooks/useCurrentMembershipRole.js";
import { useReserveImport } from "../../hooks/useReserveImport.js";
import { useImportJob } from "../../hooks/useImportJob.js";
import { useImportJobSchema } from "../../hooks/useImportJobSchema.js";
import { useSubmitImportMapping } from "../../hooks/useSubmitImportMapping.js";
import { useRequestImportCommit } from "../../hooks/useRequestImportCommit.js";
import { ApiError, isConflict } from "../../api/errors.js";
import { PageHeader, Panel } from "../../components/ui/Layout.js";
import { Button, ButtonLink } from "../../components/ui/Button.js";
import { InlineNotice } from "../../components/ui/InlineNotice.js";
import { SelectField } from "../../components/forms/SelectField.js";
import { InitialLoading, ErrorState, EmptyState } from "../../components/AsyncStates.js";
import type { ImportJob, ImportJobStatus, ColumnMapping, MembershipRole } from "../../api/types.js";
import "./ImportWizard.css";

const WRITE_ROLES: ReadonlySet<MembershipRole> = new Set(["OWNER", "ADMIN", "MEMBER"]);
const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024; // mirrors import-job.ts's real MAX_IMPORT_FILE_BYTES
const MAX_IMPORT_ROWS = 5000; // mirrors import-job.ts's real MAX_IMPORT_ROWS (client-side copy only, the backend enforces this)
const CLIENT_POLL_GRACE_MS = 60_000;

type StepId = "upload" | "mapping" | "processing" | "preview" | "commit";

const BADGES: { id: StepId; label: string }[] = [
  { id: "upload", label: "1. Enviar arquivo" },
  // Deliberate reorder vs. the spec's literal badge text order (which lists "Processando"
  // before "Mapear colunas") — the real state machine (`import-job.ts`'s `ImportJobStatus`)
  // always reaches `UPLOADED`/`AWAITING_MAPPING` (mappable) BEFORE `PARSING` (the real async
  // wait), so numbering it in spec order would show an unvisited step as already passed.
  { id: "mapping", label: "2. Mapear colunas" },
  { id: "processing", label: "3. Processando" },
  { id: "preview", label: "4. Pré-visualizar e deduplicar" },
  { id: "commit", label: "5. Confirmar" },
];

function stepIdForJob(job: ImportJob | undefined): StepId {
  if (!job) return "upload";
  const status: ImportJobStatus = job.status;
  switch (status) {
    // Codex review round 1 (real, CONFIRMED finding): `UPLOADED` must NEVER render the editable
    // mapping form. Every job this screen creates already has `columnMapping` populated at
    // creation (`DEFAULT_TRACKED_SUBJECT_COLUMN_MAPPING`, `import-service.ts`), so the S3-
    // triggered parse worker races to claim `UPLOADED -> PARSING` the instant the upload lands
    // (`import-parse-service.ts`) - a client mapping submission that reads the job while it is
    // still `UPLOADED` would itself write `UPLOADED -> UPLOADED` (`submitImportMapping`'s
    // `toStatus` is only `PARSING` when the job was `AWAITING_MAPPING`), which enqueues NO new
    // parse trigger. If that write wins the OCC race against the one-shot S3 event, the worker's
    // own claim attempt loses OCC, returns `SKIPPED_ALREADY_CLAIMED`, and NOTHING ever re-
    // triggers parsing again - the job is permanently orphaned in `UPLOADED`. `AWAITING_MAPPING`
    // has no such race (a job only ever enters it when `columnMapping` was genuinely absent, and
    // submitting there safely dispatches a fresh parse trigger in the same transaction) - so
    // `UPLOADED` is treated as part of the same "please wait" step as `PARSING`, and the
    // interactive mapping form is offered ONLY for `AWAITING_MAPPING` (unreachable via this
    // screen's only creation path today, TrackedSubject-only, but the safe/correct behavior for
    // whenever a future Document/Requirement creation entry point starts using it).
    case "UPLOADED":
    case "PARSING":
      return "processing";
    case "AWAITING_MAPPING":
      return "mapping";
    case "PREVIEW_READY":
      return "preview";
    case "COMMITTING":
    case "COMMITTED":
    case "FAILED":
    case "EXPIRED":
      return "commit";
  }
}

function badgeIndex(step: StepId): number {
  return BADGES.findIndex((badge) => badge.id === step);
}

function StepBadges({ current }: { current: StepId }) {
  const currentIndex = badgeIndex(current);
  return (
    <ol className="import-wizard__badges">
      {BADGES.map((badge, index) => {
        const isCurrent = badge.id === current;
        const isDone = index < currentIndex;
        return (
          <li
            key={badge.id}
            className={`import-wizard__badge${isCurrent ? " import-wizard__badge--current" : ""}${isDone ? " import-wizard__badge--done" : ""}`}
            aria-current={isCurrent ? "step" : undefined}
          >
            {isDone ? (
              <span className="import-wizard__badge-check" aria-hidden="true">
                ✓
              </span>
            ) : null}
            {badge.label}
            {isDone ? <span className="u-visually-hidden"> (concluída)</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Moves focus to the current step's own heading whenever the step changes (never a route
 * change here — all steps live at the same `/imports/:jobId` URL) and announces it via a polite
 * live region, matching the spec's "Teclado e foco" requirement and this app's established
 * `AppShell.tsx` convention for the same problem on real route changes. */
function useStepFocus(step: StepId) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  return headingRef;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

const PARSE_FAILURE_LABELS: Record<string, string> = {
  FILE_TOO_LARGE: "O arquivo excede o limite de 5 MB.",
  TOO_MANY_ROWS: `O arquivo excede o limite de ${MAX_IMPORT_ROWS.toLocaleString("pt-BR")} linhas.`,
};

const COMMIT_FAILURE_LABELS: Record<string, string> = {
  ENTITLEMENT_EXCEEDED: "O limite de Fornecedores do seu plano foi atingido.",
  TENANT_NOT_ACTIVE: "A organização não está mais ativa.",
  PLAN_INTEGRITY_MISMATCH: "O plano de importação mudou desde a pré-visualização.",
  MISSING_PLAN_REFERENCE: "O plano de importação não foi encontrado.",
};

function presentFailureReason(reason: string | undefined, labels: Record<string, string>): string {
  if (!reason) return "Motivo não informado.";
  const friendly = labels[reason];
  return friendly ? `${friendly} (${reason})` : `Falha não classificada (${reason}).`;
}

// ---------------------------------------------------------------------------------------------
// Upload step (`/imports/new`)
// ---------------------------------------------------------------------------------------------

function UploadStep({ headingRef }: { headingRef: React.RefObject<HTMLHeadingElement> }) {
  const navigate = useNavigate();
  const orgPath = useOrgPath();
  const reserve = useReserveImport();
  const [file, setFile] = useState<File | undefined>();
  const [validationError, setValidationError] = useState<string | undefined>();
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function validateAndSet(candidate: File | undefined) {
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith(".csv")) {
      setValidationError("Formato não reconhecido — envie um arquivo .csv.");
      setFile(undefined);
      return;
    }
    if (candidate.size > MAX_IMPORT_FILE_BYTES) {
      setValidationError("Arquivo maior que 5 MB.");
      setFile(undefined);
      return;
    }
    setValidationError(undefined);
    setFile(candidate);
    // Codex review round 1 (real, CONFIRMED finding): the idempotency key used to be renewed
    // only after a SUCCESSFUL reserve - if reserve succeeded but the PUT (phase 2) failed, the
    // key stays IN_PROGRESS/COMPLETED for THAT file's requestHash; picking a genuinely different
    // file and resubmitting with the SAME stale key hits `existing.requestHash !== requestHash`
    // in `IdempotencyStore.begin()` (`shared/idempotency/idempotency.ts`) and throws
    // `ConcurrentOperationError`, permanently blocking that new file for the rest of the session.
    // Choosing a (new) file is always a deliberately new submission - the key is renewed right
    // here, not only after success, matching `useIdempotentMutation`'s own documented contract.
    reserve.newIntent();
  }

  async function handleSubmit() {
    if (!file) return;
    try {
      const result = await reserve.mutateAsync({ file });
      reserve.newIntent();
      navigate(orgPath(`/imports/${result.jobId}`));
    } catch {
      // Surfaced below via reserve.isError.
    }
  }

  return (
    <div>
      <h2 ref={headingRef} tabIndex={-1} className="import-wizard__step-heading">
        Enviar arquivo
      </h2>
      {validationError ? (
        <InlineNotice tone="critical" announce="alert">
          <p>{validationError}</p>
        </InlineNotice>
      ) : null}
      {reserve.isError ? (
        <InlineNotice tone="critical" announce="alert">
          <p>{errorMessage(reserve.error, "Não foi possível enviar o arquivo.")}</p>
        </InlineNotice>
      ) : null}
      <div
        className={`import-wizard__dropzone${dragOver ? " import-wizard__dropzone--active" : ""}`}
        onDragOver={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event: DragEvent<HTMLDivElement>) => {
          event.preventDefault();
          setDragOver(false);
          validateAndSet(event.dataTransfer.files?.[0]);
        }}
      >
        <p>Arraste um arquivo .csv ou</p>
        <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
          Selecionar arquivo
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          aria-label="Selecionar arquivo"
          className="u-visually-hidden"
          onChange={(event) => validateAndSet(event.target.files?.[0])}
        />
        <p className="u-text-secondary">Até 5 MB · até {MAX_IMPORT_ROWS.toLocaleString("pt-BR")} linhas</p>
        {file ? <p>Selecionado: {file.name}</p> : null}
      </div>
      <div className="import-wizard__actions">
        <Button variant="primary" pending={reserve.isPending} disabled={!file} onClick={() => void handleSubmit()}>
          {reserve.isPending ? "Enviando…" : "Enviar e continuar"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Mapping step (`UPLOADED`/`AWAITING_MAPPING`)
// ---------------------------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  displayName: "Nome",
  type: "Tipo",
  externalId: "ID externo",
  notes: "Notas",
  tags: "Tags",
};

function detectHeader(headers: string[], candidates: (string | undefined)[]): string | undefined {
  const normalized = new Map(headers.map((h) => [h.trim().toLowerCase(), h]));
  for (const candidate of candidates) {
    if (!candidate) continue;
    const match = normalized.get(candidate.trim().toLowerCase());
    if (match) return match;
  }
  return undefined;
}

function MappingStep({
  headingRef,
  job,
  jobId,
  canWrite,
  orgPath,
}: {
  headingRef: React.RefObject<HTMLHeadingElement>;
  job: ImportJob;
  jobId: string;
  canWrite: boolean;
  orgPath: (path: string) => string;
}) {
  const navigate = useNavigate();
  const schemaQuery = useImportJobSchema(jobId, true);
  const submitMapping = useSubmitImportMapping();
  const [columns, setColumns] = useState<Record<string, string> | undefined>(undefined);
  // A required field always gets SOME select value once headers exist (so a submit is never
  // structurally invalid - the JSON schema requires non-empty `displayName`/`type`), but that
  // forced fallback is NOT the same thing as "the user (or auto-detection) actually confirmed
  // this mapping" - `confirmed` tracks the latter, which is what the "coluna obrigatória sem
  // mapeamento" warning must key off, never `!!value` (that would always be true by
  // construction and the warning could never fire).
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});

  const existingColumns = job.columnMapping?.targetKind === "TrackedSubject" ? job.columnMapping.columns : undefined;

  useEffect(() => {
    if (columns || !schemaQuery.data) return;
    if (schemaQuery.data.targetEntityType !== "TrackedSubject") return;
    const initial: Record<string, string> = {};
    const initialConfirmed: Record<string, boolean> = {};
    // A required field with no real detection still needs SOME value (the submit payload can
    // never omit it), but falling back to the same fixed `headers[0]` for every undetected
    // required field would manufacture a spurious conflict between them (two different fields
    // both silently pointing at the same first column) - each undetected required field instead
    // claims the first header no earlier field (detected or fallback) has already claimed, so
    // the ONLY conflicts a user ever sees are real ones (two fields deliberately mapped to the
    // same column), never an artifact of this fallback.
    const claimedHeaders = new Set<string>();
    for (const entry of schemaQuery.data.fields) {
      const detected = detectHeader(schemaQuery.data.headers, [existingColumns?.[entry.field as keyof typeof existingColumns], entry.field]);
      if (detected !== undefined) {
        initial[entry.field] = detected;
        initialConfirmed[entry.field] = true;
        claimedHeaders.add(detected);
        continue;
      }
      initialConfirmed[entry.field] = false;
      if (!entry.required) {
        initial[entry.field] = "";
        continue;
      }
      const fallback = schemaQuery.data.headers.find((h) => !claimedHeaders.has(h)) ?? schemaQuery.data.headers[0] ?? "";
      initial[entry.field] = fallback;
      claimedHeaders.add(fallback);
    }
    setColumns(initial);
    setConfirmed(initialConfirmed);
    // Codex review round 1 (considered, not changed): a later schema refetch returning DIFFERENT
    // headers than this seed used could in theory leave a stale, no-longer-valid select value
    // (this effect never re-seeds after first success). Not applied here because the raw CSV
    // object this reads (`ImportService.readCsvHeaderAndSample`) is immutable per job - the same
    // `objectETag` (a hash of the file's own bytes) forever - so `schemaQuery.data.headers` can
    // never genuinely differ across refetches of the SAME jobId; and even in the unreachable case
    // it somehow did, `submitImportMapping` independently revalidates every referenced header
    // against the real file server-side, so a stale value would 400 rather than silently commit.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seeds once when the schema first arrives, never re-derives over the user's own edits.
  }, [schemaQuery.data]);

  if (schemaQuery.isPending) {
    return (
      <div>
        <h2 ref={headingRef} tabIndex={-1} className="import-wizard__step-heading">
          Mapear colunas
        </h2>
        <InitialLoading label="Carregando colunas detectadas…" />
      </div>
    );
  }
  if (schemaQuery.isError) {
    return (
      <div>
        <h2 ref={headingRef} tabIndex={-1} className="import-wizard__step-heading">
          Mapear colunas
        </h2>
        <ErrorState message={errorMessage(schemaQuery.error, "Não foi possível carregar as colunas do arquivo.")} onRetry={() => void schemaQuery.refetch()} />
      </div>
    );
  }
  if (schemaQuery.data.targetEntityType !== "TrackedSubject") {
    return (
      <div>
        <h2 ref={headingRef} tabIndex={-1} className="import-wizard__step-heading">
          Mapear colunas
        </h2>
        <InlineNotice tone="warning">
          <p>Este tipo de importação ({schemaQuery.data.targetEntityType}) ainda não é suportado por esta tela.</p>
        </InlineNotice>
      </div>
    );
  }

  const { fields, headers } = schemaQuery.data;
  const values = columns ?? {};

  // A header used by more than one currently-selected field is an invalid mapping (blocks
  // advancing) - only non-blank selections count (an unmapped optional field is never a conflict).
  const headerUsage = new Map<string, string[]>();
  for (const entry of fields) {
    const value = values[entry.field];
    if (!value) continue;
    headerUsage.set(value, [...(headerUsage.get(value) ?? []), entry.field]);
  }
  const conflictingFields = new Set<string>();
  for (const usedBy of headerUsage.values()) {
    if (usedBy.length > 1) usedBy.forEach((field) => conflictingFields.add(field));
  }
  const hasConflict = conflictingFields.size > 0;

  const missingRequired = fields.filter((entry) => entry.required && !confirmed[entry.field]);

  async function handlePreview() {
    if (!columns) return;
    const mapping: ColumnMapping = {
      schemaVersion: 1,
      targetKind: "TrackedSubject",
      columns: {
        displayName: columns["displayName"] ?? "",
        type: columns["type"] ?? "",
        ...(columns["externalId"] ? { externalId: columns["externalId"] } : {}),
        ...(columns["notes"] ? { notes: columns["notes"] } : {}),
        ...(columns["tags"] ? { tags: columns["tags"] } : {}),
      },
    };
    try {
      await submitMapping.mutateAsync({ jobId, columnMapping: mapping, expectedVersion: job.version });
    } catch {
      // Surfaced below via submitMapping.isError (a CONFLICT just means the job already moved
      // on elsewhere - the parent's poll will pick up the new state either way).
    }
  }

  if (!canWrite) {
    return (
      <div>
        <h2 ref={headingRef} tabIndex={-1} className="import-wizard__step-heading">
          Mapear colunas
        </h2>
        <p className="u-text-secondary">Mapeamento aplicado a este arquivo (somente leitura):</p>
        <div className="import-wizard__mapping-grid" role="table" aria-label="Mapeamento de colunas">
          {fields.map((entry) => (
            <div className="import-wizard__mapping-row" role="row" key={entry.field}>
              <span role="cell">{FIELD_LABELS[entry.field] ?? entry.field}</span>
              <span role="cell" aria-hidden="true">
                →
              </span>
              <span role="cell">{existingColumns?.[entry.field as keyof typeof existingColumns] ?? "(não mapeado)"}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 ref={headingRef} tabIndex={-1} className="import-wizard__step-heading">
        Mapear colunas
      </h2>
      {missingRequired.length > 0 ? (
        <InlineNotice tone="warning">
          <p>
            {missingRequired.length} coluna{missingRequired.length > 1 ? "s" : ""} obrigatória{missingRequired.length > 1 ? "s" : ""} sem mapeamento:{" "}
            {missingRequired.map((entry) => `"${FIELD_LABELS[entry.field] ?? entry.field}"`).join(", ")}.
          </p>
        </InlineNotice>
      ) : null}
      {submitMapping.isError && !isConflict(submitMapping.error) ? (
        <InlineNotice tone="critical" announce="alert">
          <p>{errorMessage(submitMapping.error, "Não foi possível salvar o mapeamento.")}</p>
        </InlineNotice>
      ) : null}
      <div className="import-wizard__mapping-grid">
        {fields.map((entry) => {
          const conflict = conflictingFields.has(entry.field);
          const options = entry.required
            ? headers.map((h) => ({ value: h, label: h }))
            : [{ value: "", label: "— não mapear —" }, ...headers.map((h) => ({ value: h, label: h }))];
          return (
            <div key={entry.field} className="import-wizard__mapping-row">
              <SelectField
                label={`${FIELD_LABELS[entry.field] ?? entry.field} (coluna do CSV)`}
                value={values[entry.field] ?? ""}
                onChange={(value) => {
                  setColumns({ ...values, [entry.field]: value });
                  setConfirmed((prev) => ({ ...prev, [entry.field]: true }));
                }}
                options={options}
                required={entry.required}
              />
              {conflict ? (
                <InlineNotice tone="critical">
                  <p>Esta coluna já está mapeada para outro campo.</p>
                </InlineNotice>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="import-wizard__actions">
        <Button variant="ghost" onClick={() => navigate(orgPath("/imports/new"))}>
          Voltar
        </Button>
        {/* Codex review round 1 (real, CONFIRMED finding): a required field that only holds an
            unconfirmed fallback value (the forced first-unclaimed-header pick, never a real
            detection or an explicit user choice) must also block advancing - otherwise a CSV
            with unrecognized headers silently submits garbage into `displayName`/`type` instead
            of surfacing the warning as something the user must actually resolve. */}
        <Button variant="primary" pending={submitMapping.isPending} disabled={hasConflict || missingRequired.length > 0} onClick={() => void handlePreview()}>
          Pré-visualizar
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Processing step (`PARSING` / `COMMITTING`)
// ---------------------------------------------------------------------------------------------

function ProcessingStep({
  headingRef,
  label,
  note,
  onGoBack,
}: {
  headingRef: React.RefObject<HTMLHeadingElement>;
  label: string;
  note: string;
  onGoBack: () => void;
}) {
  const [graceUntil, setGraceUntil] = useState(() => Date.now() + CLIENT_POLL_GRACE_MS);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() >= graceUntil) setSlow(true);
    }, 1000);
    return () => clearInterval(id);
  }, [graceUntil]);

  return (
    <div>
      <h2 ref={headingRef} tabIndex={-1} className="import-wizard__step-heading">
        Processando
      </h2>
      <InlineNotice tone="neutral" announce="status">
        <p>{label}</p>
      </InlineNotice>
      <div className="import-wizard__progress-bar" aria-hidden="true">
        <div className="import-wizard__progress-fill" />
      </div>
      <p className="u-text-secondary">{note}</p>
      {slow ? (
        <InlineNotice tone="warning" announce="status">
          <p>Isso está demorando mais que o esperado.</p>
          <div className="import-wizard__actions">
            <Button variant="secondary" onClick={() => setGraceUntil(Date.now() + CLIENT_POLL_GRACE_MS)}>
              Continuar aguardando
            </Button>
            <Button variant="ghost" onClick={onGoBack}>
              Voltar mais tarde
            </Button>
          </div>
        </InlineNotice>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Preview step (`PREVIEW_READY`)
// ---------------------------------------------------------------------------------------------

function PreviewStep({
  headingRef,
  job,
  jobId,
  canWrite,
  orgPath,
}: {
  headingRef: React.RefObject<HTMLHeadingElement>;
  job: ImportJob;
  jobId: string;
  canWrite: boolean;
  orgPath: (path: string) => string;
}) {
  const navigate = useNavigate();
  const commit = useRequestImportCommit();
  const total = job.totalRows ?? 0;
  const accepted = job.acceptedRows ?? 0;
  const rejected = job.rejectedRows ?? 0;
  const duplicate = job.duplicateRows ?? 0;

  async function handleConfirm() {
    try {
      await commit.mutateAsync({ jobId, expectedVersion: job.version });
    } catch {
      // Surfaced below via commit.isError.
    }
  }

  return (
    <div>
      <h2 ref={headingRef} tabIndex={-1} className="import-wizard__step-heading">
        Pré-visualizar e deduplicar
      </h2>
      <InlineNotice tone="neutral">
        <p>
          {accepted} de {total} linha{total === 1 ? "" : "s"} válida{accepted === 1 ? "" : "s"}. Linhas inválidas não bloqueiam a importação das demais — cada
          linha é processada de forma independente, mas o resumo mostra apenas os totais de linhas válidas, com erro e duplicadas (não há um relatório por
          linha nesta versão).
        </p>
      </InlineNotice>
      {duplicate > 0 ? (
        <InlineNotice tone="warning">
          <p>
            {duplicate} linha{duplicate > 1 ? "s" : ""} correspondem a um Fornecedor já existente (mesmo ID externo/nome) e serão ignoradas — a importação
            nunca atualiza um Fornecedor existente automaticamente, apenas cria os que ainda não existem.
          </p>
        </InlineNotice>
      ) : null}
      {rejected > 0 ? (
        <InlineNotice tone="warning">
          <p>
            {rejected} linha{rejected > 1 ? "s" : ""} com erro de validação será{rejected > 1 ? "ão" : ""} ignorada{rejected > 1 ? "s" : ""}.
          </p>
        </InlineNotice>
      ) : null}
      {commit.isError && !isConflict(commit.error) ? (
        <InlineNotice tone="critical" announce="alert">
          <p>{errorMessage(commit.error, "Não foi possível iniciar a importação.")}</p>
        </InlineNotice>
      ) : null}
      {canWrite ? (
        <div className="import-wizard__actions">
          <Button variant="ghost" onClick={() => navigate(orgPath("/imports/new"))}>
            Voltar
          </Button>
          <Button variant="primary" pending={commit.isPending} onClick={() => void handleConfirm()}>
            {commit.isPending ? "Confirmando…" : "Confirmar importação"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Commit result step (`COMMITTING` / `COMMITTED` / `FAILED` / `EXPIRED`)
// ---------------------------------------------------------------------------------------------

function CommitStep({
  headingRef,
  job,
  jobId,
  canWrite,
  orgPath,
  onGoBack,
}: {
  headingRef: React.RefObject<HTMLHeadingElement>;
  job: ImportJob;
  jobId: string;
  canWrite: boolean;
  orgPath: (path: string) => string;
  onGoBack: () => void;
}) {
  if (job.status === "COMMITTING") {
    return <ProcessingStep headingRef={headingRef} label="Importando…" note="Isso pode levar alguns instantes para arquivos grandes." onGoBack={onGoBack} />;
  }

  if (job.status === "COMMITTED") {
    return (
      <div>
        <h2 ref={headingRef} tabIndex={-1} className="import-wizard__step-heading">
          Confirmar
        </h2>
        <InlineNotice tone="success">
          <p>
            Importação concluída: {job.acceptedRows ?? 0} fornecedor{(job.acceptedRows ?? 0) === 1 ? "" : "es"} processado
            {(job.acceptedRows ?? 0) === 1 ? "" : "s"}, {job.duplicateRows ?? 0} duplicata(s) ignorada(s), {job.rejectedRows ?? 0} linha(s) ignorada(s) por
            erro.
          </p>
        </InlineNotice>
        <p className="u-text-secondary">
          Este resumo permanece disponível neste mesmo link (<code>/imports/{jobId}</code>) mesmo depois de sair desta tela.
        </p>
        <div className="import-wizard__actions">
          <ButtonLink variant="secondary" to={orgPath("/subjects")}>
            Ver Fornecedores
          </ButtonLink>
        </div>
      </div>
    );
  }

  if (job.status === "FAILED") {
    const failedDuringParsing = job.totalRows === undefined;
    return (
      <div>
        <h2 ref={headingRef} tabIndex={-1} className="import-wizard__step-heading">
          Confirmar
        </h2>
        {failedDuringParsing ? (
          <>
            <InlineNotice tone="critical" announce="alert">
              <p>Não foi possível processar o arquivo: {presentFailureReason(job.failureReason, PARSE_FAILURE_LABELS)}</p>
            </InlineNotice>
            {canWrite ? (
              <div className="import-wizard__actions">
                <ButtonLink variant="primary" to={orgPath("/imports/new")}>
                  Enviar outro arquivo
                </ButtonLink>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <InlineNotice tone="critical" announce="alert">
              {/* Codex review round 1 (real, CONFIRMED finding): `lastCommittedRowNumber` is a
                  raw CSV row position (1..totalRows, may skip rejected/duplicate rows in
                  between) - comparing it against `acceptedRows` (a plain COUNT) mixes two
                  different denominators and can render a nonsensical "10 de 7". `totalRows` is
                  the only field sharing `lastCommittedRowNumber`'s own unit (a row position in
                  the same file), so it's the only honest denominator here. */}
              <p>
                A importação falhou durante a criação dos registros: {presentFailureReason(job.failureReason, COMMIT_FAILURE_LABELS)} Última linha do
                arquivo alcançada antes da falha: {job.lastCommittedRowNumber ?? 0} de {job.totalRows ?? 0}.
              </p>
            </InlineNotice>
            {canWrite ? (
              <>
                <p className="u-text-secondary">
                  Não é possível retomar esta importação diretamente. Envie o mesmo arquivo novamente — as linhas já criadas serão detectadas como
                  duplicatas e ignoradas automaticamente.
                </p>
                <div className="import-wizard__actions">
                  <ButtonLink variant="primary" to={orgPath("/imports/new")}>
                    Enviar novamente
                  </ButtonLink>
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
    );
  }

  // EXPIRED — declared in ImportJobStatus but no backend code path sets it today; handled for an
  // exhaustive step, never actually reachable yet (see ImportJobStatus's own doc comment).
  return (
    <div>
      <h2 ref={headingRef} tabIndex={-1} className="import-wizard__step-heading">
        Confirmar
      </h2>
      <InlineNotice tone="warning">
        <p>Este job de importação expirou.</p>
      </InlineNotice>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Shared shell + top-level component
// ---------------------------------------------------------------------------------------------

function ImportWizardShell({ step, children }: { step: StepId; children: ReactNode }) {
  return (
    <div>
      <PageHeader title="Importação em massa" description="Envie um CSV para criar Fornecedores." />
      <StepBadges current={step} />
      <span className="u-visually-hidden" role="status" aria-live="polite">
        Etapa atual: {BADGES[badgeIndex(step)]?.label}
      </span>
      <Panel padded>{children}</Panel>
    </div>
  );
}

function NewImportScreen() {
  const role = useCurrentMembershipRole();
  const headingRef = useStepFocus("upload");

  if (role === undefined) {
    return (
      <ImportWizardShell step="upload">
        <InitialLoading label="Carregando…" />
      </ImportWizardShell>
    );
  }
  if (!WRITE_ROLES.has(role)) {
    return (
      <ImportWizardShell step="upload">
        <EmptyState kind="permission-limited" message="Você não tem permissão para iniciar uma importação." />
      </ImportWizardShell>
    );
  }

  return (
    <ImportWizardShell step="upload">
      <UploadStep headingRef={headingRef} />
    </ImportWizardShell>
  );
}

function ExistingImportScreen({ jobId }: { jobId: string }) {
  const navigate = useNavigate();
  const orgPath = useOrgPath();
  const role = useCurrentMembershipRole();
  const canWrite = role !== undefined && WRITE_ROLES.has(role);
  const jobQuery = useImportJob(jobId);

  const step = stepIdForJob(jobQuery.data?.job);
  const headingRef = useStepFocus(step);

  if (jobQuery.isPending) {
    return (
      <ImportWizardShell step="upload">
        <InitialLoading label="Carregando importação…" />
      </ImportWizardShell>
    );
  }
  if (jobQuery.isError) {
    if (jobQuery.error instanceof ApiError && jobQuery.error.category === "AUTHORIZATION") {
      return (
        <ImportWizardShell step="upload">
          <EmptyState kind="permission-limited" />
        </ImportWizardShell>
      );
    }
    if (jobQuery.error instanceof ApiError && jobQuery.error.category === "NOT_FOUND") {
      return (
        <ImportWizardShell step="upload">
          <EmptyState kind="unavailable" message="Esta importação não foi encontrada." />
        </ImportWizardShell>
      );
    }
    return (
      <ImportWizardShell step="upload">
        <ErrorState message={errorMessage(jobQuery.error, "Não foi possível carregar esta importação.")} onRetry={() => void jobQuery.refetch()} />
      </ImportWizardShell>
    );
  }

  const job = jobQuery.data.job;
  const goBackLater = () => navigate(orgPath("/subjects"));

  return (
    <ImportWizardShell step={step}>
      {step === "mapping" ? (
        <MappingStep headingRef={headingRef} job={job} jobId={jobId} canWrite={canWrite} orgPath={orgPath} />
      ) : step === "processing" ? (
        <ProcessingStep
          headingRef={headingRef}
          label="Analisando o arquivo…"
          note="Isso pode levar alguns segundos para arquivos grandes."
          onGoBack={goBackLater}
        />
      ) : step === "preview" ? (
        <PreviewStep headingRef={headingRef} job={job} jobId={jobId} canWrite={canWrite} orgPath={orgPath} />
      ) : (
        <CommitStep headingRef={headingRef} job={job} jobId={jobId} canWrite={canWrite} orgPath={orgPath} onGoBack={goBackLater} />
      )}
    </ImportWizardShell>
  );
}

export function ImportWizard() {
  const { jobId } = useParams<{ jobId?: string }>();
  if (!jobId) return <NewImportScreen />;
  return <ExistingImportScreen jobId={jobId} />;
}
