/**
 * Subject Detail — BLOCKER-C review queue (Variante B, revisão humana explícita, decisão do
 * Marcelo 2026-08-25): for each requirement not yet SATISFIED, the operator can expand it to
 * see the uploaded evidence (DocumentSubmission list) and, having reviewed it, link an
 * already-existing ExpirationItem to satisfy the requirement. Deliberately no auto-suggested
 * item (BLOCKER-C's own investigation found DocumentSubmission carries no structured data -
 * validity date, type - a safe automatic match could be built from; the operator supplies the
 * itemId, same trust boundary the backend's own linkExpirationItem already enforces via
 * ExpirationItemLookup, never accepted blindly).
 */
import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useSubject } from "../../hooks/useSubject.js";
import { useRequirementAssignments } from "../../hooks/useRequirementAssignments.js";
import { useDocumentSubmissions } from "../../hooks/useDocumentSubmissions.js";
import { useLinkExpirationItem } from "../../hooks/useLinkExpirationItem.js";
import { useUnlinkExpirationItem } from "../../hooks/useUnlinkExpirationItem.js";
import { presentRequirementStatus, presentSubmissionStatus, formatAbsoluteDate } from "../../api/presentation.js";
import { InitialLoading, ErrorState, EmptyState } from "../../components/AsyncStates.js";
import { TextField } from "../../components/forms/TextField.js";
import { FormErrorSummary } from "../../components/forms/FormErrorSummary.js";
import { ApiError, isConflict } from "../../api/errors.js";
import type { RequirementAssignment } from "../../api/types.js";

const REVIEWABLE_STATUSES = new Set(["MISSING", "REQUESTED", "SUBMITTED", "UNDER_REVIEW", "REJECTED"]);

export function SubjectDetail() {
  const { subjectId } = useParams<{ subjectId: string }>();
  const subjectQuery = useSubject(subjectId ?? "");
  const assignmentsQuery = useRequirementAssignments(subjectId ?? "");

  if (!subjectId) return null; // unreachable - the route always supplies :subjectId

  if (subjectQuery.isPending || assignmentsQuery.isPending) {
    return <InitialLoading label="Carregando fornecedor…" />;
  }

  if (subjectQuery.isError) {
    const error = subjectQuery.error;
    if (error instanceof ApiError && error.category === "NOT_FOUND") {
      return <EmptyState kind="unavailable" message="Este fornecedor não foi encontrado." action={<Link to="/subjects">Voltar para Fornecedores</Link>} />;
    }
    const message = error instanceof ApiError ? error.message : "Não foi possível carregar este fornecedor.";
    return <ErrorState message={message} onRetry={() => void subjectQuery.refetch()} />;
  }

  if (assignmentsQuery.isError) {
    const message = assignmentsQuery.error instanceof ApiError ? assignmentsQuery.error.message : "Não foi possível carregar os requisitos.";
    return <ErrorState message={message} onRetry={() => void assignmentsQuery.refetch()} />;
  }

  const subject = subjectQuery.data.subject;
  const assignments = assignmentsQuery.data.assignments;

  return (
    <div>
      <p>
        <Link to="/subjects">← Voltar para Fornecedores</Link>
      </p>
      <h1>{subject.displayName}</h1>
      <p>{subject.type}</p>
      <h2>Requisitos</h2>
      {assignments.length === 0 ? (
        <EmptyState kind="true-empty" message="Nenhum requisito atribuído ainda." />
      ) : (
        <ul>
          {assignments.map((assignment) => (
            <RequirementRow key={assignment.assignmentId} subjectId={subjectId} assignment={assignment} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RequirementRow({ subjectId, assignment }: { subjectId: string; assignment: RequirementAssignment }) {
  const [expanded, setExpanded] = useState(false);
  const presentation = presentRequirementStatus(assignment.status);
  const canReview = REVIEWABLE_STATUSES.has(assignment.status);

  return (
    <li>
      <span data-tone={presentation.tone}>[{presentation.label}]</span> <strong>{assignment.requirementName}</strong>
      {assignment.status === "SATISFIED" ? (
        <>
          {" "}
          — vinculado a <code>{assignment.linkedItemId}</code> <UnlinkButton subjectId={subjectId} assignment={assignment} />
        </>
      ) : canReview ? (
        <>
          {" "}
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Ocultar revisão" : "Revisar"}
          </button>
          {expanded ? <ReviewPanel subjectId={subjectId} assignment={assignment} /> : null}
        </>
      ) : null}
    </li>
  );
}

function UnlinkButton({ subjectId, assignment }: { subjectId: string; assignment: RequirementAssignment }) {
  const mutation = useUnlinkExpirationItem(subjectId, assignment.assignmentId);
  return (
    <>
      <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate({ expectedVersion: assignment.version })}>
        Desvincular
      </button>
      {mutation.isConflict ? <span role="alert"> Este requisito mudou desde que a página carregou — atualize antes de tentar de novo.</span> : null}
    </>
  );
}

function ReviewPanel({ subjectId, assignment }: { subjectId: string; assignment: RequirementAssignment }) {
  const submissionsQuery = useDocumentSubmissions(subjectId, assignment.assignmentId, true);
  const [itemId, setItemId] = useState("");
  const [generalErrors, setGeneralErrors] = useState<string[]>([]);
  const mutation = useLinkExpirationItem(subjectId, assignment.assignmentId);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending || mutation.isConflict) return;
    if (!itemId.trim()) {
      setGeneralErrors(["Informe o ID do vencimento a vincular."]);
      return;
    }
    setGeneralErrors([]);
    try {
      await mutation.mutateAsync({ itemId: itemId.trim(), expectedVersion: assignment.version });
      setItemId("");
    } catch (err) {
      if (isConflict(err)) return; // surfaced by mutation.isConflict below.
      setGeneralErrors([err instanceof ApiError ? err.message : "Não foi possível vincular este vencimento."]);
    }
  }

  return (
    <div>
      {submissionsQuery.isPending ? (
        <p>Carregando envios…</p>
      ) : submissionsQuery.isError ? (
        <p role="alert">Não foi possível carregar os envios deste requisito.</p>
      ) : submissionsQuery.data.submissions.length === 0 ? (
        <p>Nenhum documento enviado ainda para este requisito.</p>
      ) : (
        <ul>
          {submissionsQuery.data.submissions.map((submission) => {
            const status = presentSubmissionStatus(submission.status);
            return (
              <li key={submission.submissionId}>
                {submission.fileName} — <span data-tone={status.tone}>[{status.label}]</span> <span>{formatAbsoluteDate(submission.createdAt)}</span>
              </li>
            );
          })}
        </ul>
      )}
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <FormErrorSummary errors={generalErrors} />
        {mutation.isConflict ? <p role="alert">Este requisito mudou desde que a página carregou — atualize a página antes de tentar de novo.</p> : null}
        <TextField label="ID do vencimento a vincular" value={itemId} onChange={setItemId} required hint="O vencimento precisa já existir." />
        <button type="submit" disabled={mutation.isPending || mutation.isConflict}>
          {mutation.isPending ? "Vinculando…" : "Vincular"}
        </button>
      </form>
    </div>
  );
}
