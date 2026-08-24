/**
 * First Vertical Slice (mission §76-77, kept deliberately thin): a real, read-only page
 * wired through the full pipeline (AuthProvider -> ProtectedRoute -> ApiClient ->
 * /bff/api/items/dashboard -> the real, JWT-authorizer-protected backend) as evidence the
 * foundation actually connects end-to-end, without building the full Create/Renew CRUD UI
 * (explicitly deferred - see docs/frontend/frontend-production-foundation.md §27/§28).
 *
 * Sorted by dueDate ascending (most urgent first) - the exact same ordering fix
 * docs/frontend/interface-validation-readiness.md's density stress scenario found missing in
 * the prototype (§12 of that document), applied here from the start rather than
 * rediscovered.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiClient } from "../api/apiClient.js";
import { retryPolicyFor } from "../api/retryPolicy.js";
import type { ExpirationItem } from "../api/types.js";
import { presentItemStatus, sortByDueDateAscending } from "../api/presentation.js";
import { InitialLoading, ErrorState, EmptyState } from "../components/AsyncStates.js";
import { ApiError } from "../api/errors.js";

interface DashboardResponse {
  items: ExpirationItem[];
}

export function Overview() {
  const query = useQuery<DashboardResponse, unknown>({
    queryKey: ["items", "dashboard", "ACTIVE"],
    queryFn: () => apiClient.get<DashboardResponse>("/items/dashboard?status=ACTIVE"),
    retry: retryPolicyFor("safe-read"),
  });

  if (query.isPending) {
    return <InitialLoading label="Carregando seus vencimentos…" />;
  }

  if (query.isError) {
    const message = query.error instanceof ApiError ? query.error.message : "Não foi possível carregar seus vencimentos.";
    return <ErrorState message={message} onRetry={() => void query.refetch()} />;
  }

  const items = sortByDueDateAscending(query.data.items);

  if (items.length === 0) {
    return (
      <div>
        <h1>Vencimentos — Visão Geral</h1>
        <EmptyState kind="true-empty" message="Nenhum vencimento cadastrado ainda." action={<Link to="/items/new">+ Novo vencimento</Link>} />
      </div>
    );
  }

  return (
    <div>
      <h1>Vencimentos — Visão Geral</h1>
      <ul>
        {items.map((item) => {
          const presentation = presentItemStatus(item.status);
          return (
            <li key={item.itemId}>
              <span data-tone={presentation.tone}>[{presentation.label}]</span> <Link to={`/items/${item.itemId}`}>{item.name}</Link>{" "}
              <span>{new Date(item.dueDate).toLocaleDateString("pt-BR")}</span>
            </li>
          );
        })}
      </ul>
      <p>
        <Link to="/items">Ver todos os vencimentos</Link>
      </p>
    </div>
  );
}
