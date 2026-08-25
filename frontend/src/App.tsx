/**
 * Routing skeleton (mission §26) matching the approved dual-anchor IA's top-level areas only
 * - Overview, Vencimentos (Items), Fornecedores (Subjects), Configurações (Settings). No
 * route invented purely for technical convenience; no attempt to cover all 17 Interaction
 * Surfaces (mission §77). Overview, Vencimentos (Core Expiration Vertical Slice) and
 * Fornecedores (BLOCKER-C review queue, Variante B - 2026-08-25) have real implementations;
 * Configurações remains an honest placeholder.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext.js";
import { ProtectedRoute } from "./auth/ProtectedRoute.js";
import { AppShell } from "./shell/AppShell.js";
import { Overview } from "./routes/Overview.js";
import { ItemsCollection } from "./routes/items/ItemsCollection.js";
import { ItemDetail } from "./routes/items/ItemDetail.js";
import { CreateItem } from "./routes/items/CreateItem.js";
import { RenewItem } from "./routes/items/RenewItem.js";
import { SubjectsCollection } from "./routes/subjects/SubjectsCollection.js";
import { SubjectDetail } from "./routes/subjects/SubjectDetail.js";
import { NotImplementedPlaceholder } from "./routes/NotImplementedPlaceholder.js";
import { NotFound } from "./routes/NotFound.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Per-query retry policy is set explicitly at each call site (api/retryPolicy.ts,
      // mission §41 - never a single generic retry rule) - the cache-wide default is
      // deliberately "no retry" so a call site that forgets to set one fails fast and
      // visibly, rather than silently retrying with a policy nobody chose.
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route
                element={
                  <ProtectedRoute>
                    <AppShell />
                  </ProtectedRoute>
                }
              >
                <Route index element={<Navigate to="/overview" replace />} />
                <Route path="overview" element={<Overview />} />
                <Route path="items" element={<ItemsCollection />} />
                <Route path="items/new" element={<CreateItem />} />
                <Route path="items/:itemId" element={<ItemDetail />} />
                <Route path="items/:itemId/renew" element={<RenewItem />} />
                <Route path="subjects" element={<SubjectsCollection />} />
                <Route path="subjects/:subjectId" element={<SubjectDetail />} />
                <Route path="settings" element={<NotImplementedPlaceholder title="Configurações" />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
