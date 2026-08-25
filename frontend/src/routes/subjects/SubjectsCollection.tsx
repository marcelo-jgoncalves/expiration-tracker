/**
 * Fornecedores/Subjects collection (Fornecedor/Subject anchor, first real slice) - entry
 * point for the BLOCKER-C review workflow (Variante B, Marcelo's decision 2026-08-25):
 * an operator finds a subject here, then reviews its pending requirements/submissions on
 * SubjectDetail. Deliberately no "create subject" affordance yet (subjects are created via
 * the backend's other flows - CSV import, API - not a screen this slice builds); this is a
 * read/review surface, not full CRUD, matching the narrower scope BLOCKER-C actually needs.
 */
import { Link, useSearchParams } from "react-router-dom";
import { useSubjectsDashboard } from "../../hooks/useSubjectsDashboard.js";
import { InitialLoading, ErrorState, EmptyState, BackgroundRefreshIndicator } from "../../components/AsyncStates.js";
import { ApiError } from "../../api/errors.js";
import type { TrackedSubjectStatus } from "../../api/types.js";

const STATUS_TABS: { value: TrackedSubjectStatus; label: string }[] = [
  { value: "ACTIVE", label: "Ativos" },
  { value: "ARCHIVED", label: "Arquivados" },
];

function isKnownStatus(value: string | null): value is TrackedSubjectStatus {
  return value === "ACTIVE" || value === "ARCHIVED";
}

export function SubjectsCollection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get("status");
  const status: TrackedSubjectStatus = isKnownStatus(statusParam) ? statusParam : "ACTIVE";
  const query = useSubjectsDashboard(status);

  function selectStatus(next: TrackedSubjectStatus) {
    setSearchParams(next === "ACTIVE" ? {} : { status: next });
  }

  if (query.isPending) {
    return <InitialLoading label="Carregando fornecedores…" />;
  }

  if (query.isError) {
    const error = query.error;
    if (error instanceof ApiError && error.category === "AUTHORIZATION") {
      return <EmptyState kind="permission-limited" />;
    }
    const message = error instanceof ApiError ? error.message : "Não foi possível carregar os fornecedores.";
    return <ErrorState message={message} onRetry={() => void query.refetch()} />;
  }

  const subjects = query.data.subjects;
  const isBackgroundRefreshing = query.isFetching && !query.isPending;

  return (
    <div>
      <h1>Fornecedores</h1>
      <nav aria-label="Filtrar por status">
        {STATUS_TABS.map((tab) => (
          <button key={tab.value} type="button" aria-current={tab.value === status ? "page" : undefined} onClick={() => selectStatus(tab.value)}>
            {tab.label}
          </button>
        ))}
      </nav>
      <p>
        <button type="button" onClick={() => void query.refetch()}>
          Atualizar
        </button>{" "}
        {isBackgroundRefreshing ? <BackgroundRefreshIndicator /> : null}
      </p>
      {subjects.length === 0 ? (
        <EmptyState
          kind={status === "ACTIVE" ? "true-empty" : "filtered-empty"}
          message={status === "ACTIVE" ? "Nenhum fornecedor cadastrado ainda." : "Nenhum fornecedor neste status."}
        />
      ) : (
        <ul>
          {subjects.map((subject) => (
            <li key={subject.subjectId}>
              <Link to={`/subjects/${subject.subjectId}`}>{subject.displayName}</Link> <span>{subject.type}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
