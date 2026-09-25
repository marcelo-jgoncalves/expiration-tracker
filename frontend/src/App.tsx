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
import { lazy, Suspense, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useRouteUsefulContentTiming } from "./observability/routeTiming.js";
import { AuthProvider } from "./auth/AuthContext.js";
import { ActiveOrganizationProvider } from "./auth/ActiveOrganizationContext.js";
import { OnboardingGate } from "./auth/OnboardingGate.js";
import { ProtectedRoute } from "./auth/ProtectedRoute.js";
import { OrgRouteGuard } from "./routing/OrgRouteGuard.js";
import { LegacyOrgRedirect } from "./routing/LegacyOrgRedirect.js";
import { AppShell } from "./shell/AppShell.js";
import { InitialLoading } from "./components/AsyncStates.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { ToastProvider } from "./components/Toast.js";
import { prefetchOverviewNextRoutes } from "./routing/prefetch.js";

// PERF-09 (Ciclo B) - route-level code splitting. Every top-level route screen below is its own
// chunk (React.lazy + Suspense fallback), so the initial bundle carries only the router shell,
// auth/tenant gating, AppShell and shared providers - not every screen's own code. Split at the
// route granularity established by App's own Route list below, never per sub-component (that
// would trade one big request for many small ones with no real benefit - see PERF-09 task notes).
const Overview = lazy(() => import("./routes/Overview.js").then((m) => ({ default: m.Overview })));
const ItemsCollection = lazy(() =>
  import("./routes/items/ItemsCollection.js").then((m) => ({ default: m.ItemsCollection })),
);
const ItemDetail = lazy(() => import("./routes/items/ItemDetail.js").then((m) => ({ default: m.ItemDetail })));
const CreateItem = lazy(() => import("./routes/items/CreateItem.js").then((m) => ({ default: m.CreateItem })));
const RenewItem = lazy(() => import("./routes/items/RenewItem.js").then((m) => ({ default: m.RenewItem })));
const ItemDocuments = lazy(() =>
  import("./routes/items/ItemDocuments.js").then((m) => ({ default: m.ItemDocuments })),
);
const ItemReminderPolicy = lazy(() =>
  import("./routes/items/ItemReminderPolicy.js").then((m) => ({ default: m.ItemReminderPolicy })),
);
const SubjectsCollection = lazy(() =>
  import("./routes/subjects/SubjectsCollection.js").then((m) => ({ default: m.SubjectsCollection })),
);
const SubjectForm = lazy(() => import("./routes/subjects/SubjectForm.js").then((m) => ({ default: m.SubjectForm })));
const SubjectHub = lazy(() => import("./routes/subjects/SubjectHub.js").then((m) => ({ default: m.SubjectHub })));
const RequirementDetail = lazy(() =>
  import("./routes/subjects/RequirementDetail.js").then((m) => ({ default: m.RequirementDetail })),
);
const RequirementsCollection = lazy(() =>
  import("./routes/RequirementsCollection.js").then((m) => ({ default: m.RequirementsCollection })),
);
const ReviewQueue = lazy(() => import("./routes/ReviewQueue.js").then((m) => ({ default: m.ReviewQueue })));
const DocumentDetail = lazy(() => import("./routes/DocumentDetail.js").then((m) => ({ default: m.DocumentDetail })));
const DocumentTypesCollection = lazy(() =>
  import("./routes/document-types/DocumentTypesCollection.js").then((m) => ({
    default: m.DocumentTypesCollection,
  })),
);
const DocumentTypeEditor = lazy(() =>
  import("./routes/document-types/DocumentTypeEditor.js").then((m) => ({ default: m.DocumentTypeEditor })),
);
const RequirementTemplatesScreen = lazy(() =>
  import("./routes/requirement-templates/RequirementTemplatesScreen.js").then((m) => ({
    default: m.RequirementTemplatesScreen,
  })),
);
const Members = lazy(() => import("./routes/Members.js").then((m) => ({ default: m.Members })));
const Settings = lazy(() => import("./routes/Settings.js").then((m) => ({ default: m.Settings })));
const ActivityLog = lazy(() => import("./routes/ActivityLog.js").then((m) => ({ default: m.ActivityLog })));
const NotificationPreferences = lazy(() =>
  import("./routes/NotificationPreferences.js").then((m) => ({ default: m.NotificationPreferences })),
);
const AcceptInvitation = lazy(() =>
  import("./routes/AcceptInvitation.js").then((m) => ({ default: m.AcceptInvitation })),
);
const NotFound = lazy(() => import("./routes/NotFound.js").then((m) => ({ default: m.NotFound })));
const SubjectRequests = lazy(() =>
  import("./routes/subjects/SubjectRequests.js").then((m) => ({ default: m.SubjectRequests })),
);
const Tracking = lazy(() => import("./routes/subjects/Tracking.js").then((m) => ({ default: m.Tracking })));
const RequestDeliverySettings = lazy(() =>
  import("./routes/subjects/RequestDeliverySettings.js").then((m) => ({ default: m.RequestDeliverySettings })),
);
const DossierExport = lazy(() =>
  import("./routes/subjects/DossierExport.js").then((m) => ({ default: m.DossierExport })),
);
const Reports = lazy(() => import("./routes/Reports.js").then((m) => ({ default: m.Reports })));
const GuestDocumentRequest = lazy(() =>
  import("./routes/guest/GuestDocumentRequest.js").then((m) => ({ default: m.GuestDocumentRequest })),
);
const LegacyGuestUpload = lazy(() =>
  import("./routes/guest/LegacyGuestUpload.js").then((m) => ({ default: m.LegacyGuestUpload })),
);
const ImportWizard = lazy(() => import("./routes/imports/ImportWizard.js").then((m) => ({ default: m.ImportWizard })));
// D-3xx (reversal of D-320) - the app's own login/signup/reset-password screens, replacing the
// Cognito Hosted UI redirect as the frontend's real entry point.
const Login = lazy(() => import("./routes/auth/Login.js").then((m) => ({ default: m.Login })));
const SignUp = lazy(() => import("./routes/auth/SignUp.js").then((m) => ({ default: m.SignUp })));
const VerifyEmail = lazy(() => import("./routes/auth/VerifyEmail.js").then((m) => ({ default: m.VerifyEmail })));
const ForgotPassword = lazy(() => import("./routes/auth/ForgotPassword.js").then((m) => ({ default: m.ForgotPassword })));
const ResetPassword = lazy(() => import("./routes/auth/ResetPassword.js").then((m) => ({ default: m.ResetPassword })));

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

/** PERF-02 scaffolding: reports `ET_ROUTE_USEFUL_CONTENT_MS` on every route change. Needs
 * `useLocation`, so it must render inside `BrowserRouter` - kept as its own component (instead
 * of calling the hook directly in `App`) purely so its intent reads clearly at the call site. */
function RouteUsefulContentTracker() {
  const location = useLocation();
  useRouteUsefulContentTiming(location.pathname);
  return null;
}

/** PERF-09: on the Overview route (the landing screen after login for every role), schedule an
 * idle-time prefetch of the two most likely next destinations - Items and Subjects, both
 * top-of-nav entries (`shell/navigation.ts`) and both linked directly from Overview's own content
 * (see Overview.tsx's "em acompanhamento" attention card / item links). Kept to this single call site
 * (not "prefetch everything") - see `routing/prefetch.ts` for why these two and not the rest. */
function IdlePrefetch() {
  const location = useLocation();
  if (location.pathname === "/overview" || location.pathname.endsWith("/overview")) {
    prefetchOverviewNextRoutes();
  }
  return null;
}

export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <RouteUsefulContentTracker />
            <IdlePrefetch />
            {/* A14 (Block 6, D-2xx) - first real usage of Toast (design-system.md §46). Wrapped
                here, above every route including G02's fully public one, so the live region is
                always registered - G02 itself never calls useToast() (its own confirmations are
                InlineNotice/AsyncFeedback per spec, never a toast a guest could miss). */}
            <ToastProvider>
            {/* PERF-09 - one Suspense boundary above the whole route tree. Every route component
                above is now a separate lazy chunk; this fallback is what renders while that
                chunk downloads/parses on first visit to a given route. */}
            <Suspense fallback={<InitialLoading />}>
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
                {/* Requisito - Detalhe (Marcelo, 2026-09-21) - reached from A09's card ("Requisitos
                    documentais") and A11's table row ("Ver"), no top-level nav entry of its own. */}
                <Route path="subjects/:subjectId/requirements/:requirementId" element={<RequirementDetail />} />
                {/* A10 (Block 7, D-267) - Rastreamento legado, reached only from A09's card
                    ("Rastreamento legado"), no top-level nav entry of its own. */}
                <Route path="subjects/:subjectId/tracking" element={<Tracking />} />
                <Route path="subjects/:subjectId/tracking/:assignmentId" element={<Tracking />} />
                {/* A17 (Block 10, D-2xx) - Exportar dossiê, reached only from A09's card, no
                    top-level nav entry of its own (spec: "Conecta-se com: A09, ambos os sentidos"). */}
                <Route path="subjects/:subjectId/dossier" element={<DossierExport />} />
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
                {/* A18 (Block 8, D-2xx) - per-user, READ_ONLY_ROLES (every role edits only their
                    own preferences), no route guard needed - same "no restriction" posture as
                    Settings/Members below. */}
                <Route path="settings/notifications" element={<NotificationPreferences />} />
                <Route path="members" element={<Members />} />
                <Route path="settings" element={<Settings />} />
                <Route path="activity" element={<ActivityLog />} />
                {/* A15 (Block 9) - Importação em massa (CSV), `import:read` (all roles) for the
                    `:jobId` route, `import:create` (WRITE_ROLES) gated inside the component for
                    the `new` route - same "gate inside the screen, not the route" discipline as
                    A22/Settings.tsx below. Two paths, one component: `ImportWizard` branches on
                    whether `:jobId` is present (see its own header comment). */}
                <Route path="imports/new" element={<ImportWizard />} />
                <Route path="imports/:jobId" element={<ImportWizard />} />
                {/* A16 (Block 10, D-2xx) - Relatórios e exportações, ADMIN_ROLES-only own route
                    guard inside the component, same pattern as A22. */}
                <Route path="reports" element={<Reports />} />
              </Route>
              {/* Root path - a plain, ungated redirect to the (also legacy, also gated below)
                  "/overview" path, exactly what the pre-migration index route did. Kept OUTSIDE
                  the gated group below: that group's layout element (LegacyOrgRedirect) never
                  renders an <Outlet/>, so an `index` child nested in it would never actually
                  render its own element either - a plain top-level redirect avoids that trap. */}
              <Route path="/" element={<Navigate to="/overview" replace />} />
              <Route path="dashboard" element={<Navigate to="/overview" replace />} />
              <Route path="recuperar-senha" element={<ForgotPassword />} />
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
                {/* Requisito - Detalhe (Marcelo, 2026-09-21) - added here from the start, same
                    healing-forward discipline as A10/A13/A14/A17/A20/A21/A22, not a repeat of
                    A11's real gap (D-260). */}
                <Route path="subjects/:subjectId/requirements/:requirementId" element={null} />
                {/* A10 (Block 7, D-267) - added here from the start, same healing-forward
                    discipline as A13/A12/A20/A21, not a repeat of A11's real gap (D-260). */}
                <Route path="subjects/:subjectId/tracking" element={null} />
                <Route path="subjects/:subjectId/tracking/:assignmentId" element={null} />
                {/* A17 (Block 10, D-2xx) - added here from the start, same healing-forward
                    discipline as A10/A13/A20/A21/A22, not a repeat of A11's real gap (D-260). */}
                <Route path="subjects/:subjectId/dossier" element={null} />
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
                {/* A18 (Block 8, D-2xx) - added here from the start, same healing-forward
                    discipline as A20/A21/A22. */}
                <Route path="settings/notifications" element={null} />
                <Route path="members" element={null} />
                <Route path="settings" element={null} />
                <Route path="activity" element={null} />
                {/* A15 (Block 9) - added here from the start, same healing-forward discipline
                    as A20/A21/A22 above. */}
                <Route path="imports/new" element={null} />
                <Route path="imports/:jobId" element={null} />
                {/* A16 (Block 10, D-2xx) - added here from the start, same healing-forward
                    discipline as A20/A21/A22. */}
                <Route path="reports" element={null} />
              </Route>
              {/* D-3xx (reversal of D-320) - fully public, NEVER wrapped in ProtectedRoute (the
                  opposite posture of every route above): these are exactly the screens an
                  unauthenticated visitor needs. Each one redirects an already-AUTHENTICATED
                  visitor away itself (see each component's own effect), matching the "don't
                  show a login form to someone who doesn't need one" posture without a shared
                  route-level guard that would have to know each screen's own post-auth
                  destination. */}
              <Route path="login" element={<Login />} />
              <Route path="signup" element={<SignUp />} />
              <Route path="verify-email" element={<VerifyEmail />} />
              <Route path="forgot-password" element={<ForgotPassword />} />
              <Route path="reset-password" element={<ResetPassword />} />
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
            </Suspense>
            </ToastProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
