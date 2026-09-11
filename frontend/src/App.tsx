/**
 * Routing skeleton (mission §26) matching the approved dual-anchor IA's top-level areas -
 * Overview, Vencimentos (Items), Fornecedores (Subjects) - plus Membros/Configurações (Wave
 * B2B-10, Tenant-aware Frontend), never part of the original single-tenant interface planning.
 * No route invented purely for technical convenience; no attempt to cover all 17 Interaction
 * Surfaces (mission §77). Overview, Vencimentos (Core Expiration Vertical Slice) and
 * Fornecedores (BLOCKER-C review queue, Variante B - 2026-08-25) have real implementations.
 *
 * D-2xx (Block 0): the real screens now live under `/app/:orgId/...`
 * (implementation-sequencing-plan.md's route contract) - `:orgId` is kept in sync with the
 * session's real `activeOrganizationId` by `OrgRouteGuard`, never a second competing source of
 * truth (see its own header comment). The pre-migration bare paths below (`overview`, `items`,
 * ...) are kept, each rendering `LegacyOrgRedirect` instead of removed outright - bookmarks and
 * the existing E2E suite's `page.goto("/items")`-style calls heal forward to the new contract
 * instead of 404ing.
 */
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext.js";
import { ActiveOrganizationProvider } from "./auth/ActiveOrganizationContext.js";
import { OnboardingGate } from "./auth/OnboardingGate.js";
import { ProtectedRoute } from "./auth/ProtectedRoute.js";
import { OrgRouteGuard } from "./routing/OrgRouteGuard.js";
import { LegacyOrgRedirect } from "./routing/LegacyOrgRedirect.js";
import { AppShell } from "./shell/AppShell.js";
import { Overview } from "./routes/Overview.js";
import { ItemsCollection } from "./routes/items/ItemsCollection.js";
import { ItemDetail } from "./routes/items/ItemDetail.js";
import { CreateItem } from "./routes/items/CreateItem.js";
import { RenewItem } from "./routes/items/RenewItem.js";
import { ItemDocuments } from "./routes/items/ItemDocuments.js";
import { ItemReminderPolicy } from "./routes/items/ItemReminderPolicy.js";
import { SubjectsCollection } from "./routes/subjects/SubjectsCollection.js";
import { SubjectForm } from "./routes/subjects/SubjectForm.js";
import { SubjectHub } from "./routes/subjects/SubjectHub.js";
import { RequirementsCollection } from "./routes/RequirementsCollection.js";
import { ReviewQueue } from "./routes/ReviewQueue.js";
import { DocumentDetail } from "./routes/DocumentDetail.js";
import { DocumentTypesCollection } from "./routes/document-types/DocumentTypesCollection.js";
import { DocumentTypeEditor } from "./routes/document-types/DocumentTypeEditor.js";
import { RequirementTemplatesScreen } from "./routes/requirement-templates/RequirementTemplatesScreen.js";
import { Members } from "./routes/Members.js";
import { Settings } from "./routes/Settings.js";
import { ActivityLog } from "./routes/ActivityLog.js";
import { AcceptInvitation } from "./routes/AcceptInvitation.js";
import { NotFound } from "./routes/NotFound.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { ToastProvider } from "./components/Toast.js";
import { SubjectRequests } from "./routes/subjects/SubjectRequests.js";
import { Tracking } from "./routes/subjects/Tracking.js";
import { RequestDeliverySettings } from "./routes/subjects/RequestDeliverySettings.js";
import { GuestDocumentRequest } from "./routes/guest/GuestDocumentRequest.js";
import { LegacyGuestUpload } from "./routes/guest/LegacyGuestUpload.js";

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

/** Shared by both the real `/app/:orgId` tree and the legacy bare-path tree below - identical
 * auth/tenant/onboarding gating either way, they only differ in what renders once past it. */
function withOrgGates(children: ReactNode) {
  return (
    <ProtectedRoute>
      <ActiveOrganizationProvider>
        <OnboardingGate>{children}</OnboardingGate>
      </ActiveOrganizationProvider>
    </ProtectedRoute>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            {/* A14 (Block 6, D-2xx) - first real usage of Toast (design-system.md §46). Wrapped
                here, above every route including G02's fully public one, so the live region is
                always registered - G02 itself never calls useToast() (its own confirmations are
                InlineNotice/AsyncFeedback per spec, never a toast a guest could miss). */}
            <ToastProvider>
            <Routes>
              <Route
                path="app/:orgId"
                element={withOrgGates(
                  <OrgRouteGuard>
                    <AppShell />
                  </OrgRouteGuard>,
                )}
              >
                <Route index element={<Navigate to="overview" replace />} />
                <Route path="overview" element={<Overview />} />
                <Route path="items" element={<ItemsCollection />} />
                <Route path="items/new" element={<CreateItem />} />
                <Route path="items/:itemId" element={<ItemDetail />} />
                <Route path="items/:itemId/renew" element={<RenewItem />} />
                <Route path="items/:itemId/documents" element={<ItemDocuments />} />
                <Route path="items/:itemId/reminder-policy" element={<ItemReminderPolicy />} />
                <Route path="subjects" element={<SubjectsCollection />} />
                <Route path="subjects/new" element={<SubjectForm />} />
                <Route path="subjects/:subjectId/edit" element={<SubjectForm />} />
                <Route path="subjects/:subjectId" element={<SubjectHub />} />
                {/* A14 (Block 6, D-2xx) - Solicitações e recorrência, `docarchive:series-read`
                    (all roles, incl. VIEWER). Same component for both routes - the seriesId
                    route opens the series detail overlay on top of the same two panels. */}
                <Route path="subjects/:subjectId/requests" element={<SubjectRequests />} />
                <Route path="subjects/:subjectId/series/:seriesId" element={<SubjectRequests />} />
                {/* A10 (Block 7, D-267) - Rastreamento legado, reached only from A09's card
                    ("Rastreamento legado"), no top-level nav entry of its own. */}
                <Route path="subjects/:subjectId/tracking" element={<Tracking />} />
                <Route path="subjects/:subjectId/tracking/:assignmentId" element={<Tracking />} />
                <Route path="requirements" element={<RequirementsCollection />} />
                {/* A13 (Block 5, D-2xx) - Fila de revisão, `docarchive:read` (all roles). */}
                <Route path="reviews" element={<ReviewQueue />} />
                {/* A12 (Block 5, D-2xx) - Document Detail/Version History, `docarchive:read`
                    (all roles). */}
                <Route path="documents/:documentId" element={<DocumentDetail />} />
                {/* A20 (Block 4, D-2xx) - catalog + field editor, `/settings/document-types...`
                    per the audited spec's own route contract (nested under "settings", never
                    a top-level path - matches its "Configurações" nav placement). */}
                <Route path="settings/document-types" element={<DocumentTypesCollection />} />
                <Route path="settings/document-types/:documentTypeId" element={<DocumentTypeEditor />} />
                {/* A21 (Block 4, D-2xx) - one screen, two routes (catalog-default and
                    deep-linked-to-a-template), same component either way per the audited
                    spec's own route contract. */}
                <Route path="settings/requirement-templates" element={<RequirementTemplatesScreen />} />
                <Route path="settings/requirement-templates/:templateId" element={<RequirementTemplatesScreen />} />
                {/* A22 (Block 7, D-267) - OWNER-only, own route guard inside the component
                    (Navigate away for non-OWNER) - matches A20/A21's nested-under-settings
                    route contract. */}
                <Route path="settings/request-delivery" element={<RequestDeliverySettings />} />
                <Route path="members" element={<Members />} />
                <Route path="settings" element={<Settings />} />
                <Route path="activity" element={<ActivityLog />} />
              </Route>
              {/* Root path - a plain, ungated redirect to the (also legacy, also gated below)
                  "/overview" path, exactly what the pre-migration index route did. Kept OUTSIDE
                  the gated group below: that group's layout element (LegacyOrgRedirect) never
                  renders an <Outlet/>, so an `index` child nested in it would never actually
                  render its own element either - a plain top-level redirect avoids that trap. */}
              <Route path="/" element={<Navigate to="/overview" replace />} />
              {/* Pre-migration bare paths (D-2xx, Block 0) - same gating as the real tree above
                  (organizationId is guaranteed defined by the time LegacyOrgRedirect renders),
                  each one heals forward to the equivalent `/app/:orgId/...` URL rather than
                  disappearing. */}
              <Route element={withOrgGates(<LegacyOrgRedirect />)}>
                <Route path="overview" element={null} />
                <Route path="items" element={null} />
                <Route path="items/new" element={null} />
                <Route path="items/:itemId" element={null} />
                <Route path="items/:itemId/renew" element={null} />
                <Route path="subjects" element={null} />
                <Route path="subjects/new" element={null} />
                <Route path="subjects/:subjectId/edit" element={null} />
                <Route path="subjects/:subjectId" element={null} />
                {/* A14 (Block 6, D-2xx) - added here from the start, same healing-forward
                    discipline as A13/A12/A20/A21, not a repeat of A11's real gap (D-260). */}
                <Route path="subjects/:subjectId/requests" element={null} />
                <Route path="subjects/:subjectId/series/:seriesId" element={null} />
                {/* A10 (Block 7, D-267) - added here from the start, same healing-forward
                    discipline as A13/A12/A20/A21, not a repeat of A11's real gap (D-260). */}
                <Route path="subjects/:subjectId/tracking" element={null} />
                <Route path="subjects/:subjectId/tracking/:assignmentId" element={null} />
                {/* A11 (Block 3, D-2xx) - was missing from this list entirely (real gap, found
                    by the Block 3 E2E/accessibility gap closure, D-2xx): `page.goto("/requirements")`
                    and any real bookmark/link to the bare path 404'd via the catch-all `*` route
                    instead of healing forward like every other real screen here. */}
                <Route path="requirements" element={null} />
                {/* A13 (Block 5, D-2xx) - added here from the start, same healing-forward
                    discipline as A20/A21 below, not a repeat of A11's real gap (D-260). */}
                <Route path="reviews" element={null} />
                {/* A12 (Block 5, D-2xx) - added here from the start, same healing-forward
                    discipline as A13/A20/A21. */}
                <Route path="documents/:documentId" element={null} />
                {/* A20 (Block 4, D-2xx) - added here from the start, unlike A11's real gap
                    (D-260): both legacy bare paths heal forward instead of 404ing. */}
                <Route path="settings/document-types" element={null} />
                <Route path="settings/document-types/:documentTypeId" element={null} />
                <Route path="settings/requirement-templates" element={null} />
                <Route path="settings/requirement-templates/:templateId" element={null} />
                {/* A22 (Block 7, D-267) - added here from the start, same healing-forward
                    discipline as A20/A21. */}
                <Route path="settings/request-delivery" element={null} />
                <Route path="members" element={null} />
                <Route path="settings" element={null} />
                <Route path="activity" element={null} />
              </Route>
              {/* Sibling of the two groups above, never nested under ActiveOrganizationProvider/
                  OnboardingGate (Wave B2B-14, D-120) - an invitee may have zero Memberships
                  anywhere yet, exactly the case those two assume never happens. */}
              <Route
                path="accept-invitation"
                element={
                  <ProtectedRoute>
                    <AcceptInvitation />
                  </ProtectedRoute>
                }
              />
              {/* G02 (Block 6, D-2xx) - Solicitação de documento (convidado), a fully public
                  route validated only by the opaque token/session in the URL and its own
                  cookies (document-archive-guest-handlers.ts) - NEVER wrapped in
                  ProtectedRoute/AuthProvider gating (G02's own spec: "esta tela é estruturalmente
                  separada do app autenticado"). No AppShell, no org context, no RBAC. */}
              <Route path="document-archive/guest/document-requests/:token" element={<GuestDocumentRequest />} />
              {/* G01 (Block 7, D-267) - legacy guest upload (M10, D-037), same public/no-AppShell
                  posture as G02 above - the bare path is also the API's own info-fetch path,
                  which is why the CloudFront routing gap this block closed uses a distinct
                  "/info" alias instead of this page route (see guestLegacyUpload.ts). */}
              <Route path="guest/document-requests/:token" element={<LegacyGuestUpload />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            </ToastProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
