---
status: APPROVED — converged via Claude↔Codex protocol (AGENTS.md §4), Stage 1 rubric 9.4/Codex,
  9.3/Claude (retrospective); Stage 2 screen inventory 9.4/Codex, 9.3/Claude (retrospective) — both
  stages ≥9.0 without rounding
owner: Marcelo
authority: hand-off specification for Claude Design (downstream prototyping tool) — the explicit
  purpose of this document is to give that tool everything it needs to build the P0 screens with
  assertiveness and coherence with the rest of the project, WITHOUT assuming it has read any other
  session, decision log, or planning document. Not a system-architecture source of truth (that is
  `docs/architecture/README.md`); not a re-opening of any `APPROVED` architecture decision.
supersedes-in-scope: docs/frontend/interface-screen-and-state-inventory.md (17 SURF-xxx, dated
  2026-08, predates the document-archive/organization/multi-tenant-B2B domains — its STATE
  TAXONOMY DISCIPLINE is reused here, not reinvented, but its surface list is no longer current;
  not deleted, kept as historical record per docs/frontend/README.md convention)
date: 2026-09-08/09
---

# Expiration Tracker — P0 Screen Inventory Plan

## 0. Purpose and how to use this document

This document exists because the entire backend for the P0 launch roadmap
(`docs/project/roadmap-competitivo-2026-09-01.md`, 11 items) is implemented **except item 11: the
frontend**. Before any prototyping starts, Marcelo required a rigorous two-stage Claude↔Codex
research+design protocol: Stage 1 established a grading rubric for what makes a good pre-launch
screen/IA plan; Stage 2 (this document's content) used that rubric to define the actual screen
inventory. Full evidence trail: `docs/architecture/reviews/p0-frontend-screens-scoping/`.

**You (the reader) are a downstream design/prototyping tool with no other context on this
project.** Everything you need is restated inline below — you should not need to open the backend
source code or any other planning document to build a screen from this spec. If something here
seems to require clarification, that is a real gap this document should have closed; check §9
(named gaps/deferrals) first, since the gap is probably already named there.

**What this document is NOT**: it does not decide layout, component library, visual design,
color, or typography (that is `docs/frontend/design-system.md`, already `APPROVED`, and should be
read separately before/during prototyping — Operational Calm visual language, token architecture
already implemented in `frontend/`). It does not implement anything — no frontend code exists yet
for this domain beyond the older Expiration vertical slice (§10). It does not re-decide anything
already `APPROVED` in `docs/architecture/decisions-log.md`.

## 1. The product, in one paragraph

Expiration Tracker is a B2B SaaS that helps a company keep its compliance documents (licenses,
certificates, contracts, tax clearances, etc.) valid and organized. A tenant ("Organization")
tracks entities that must maintain documentation (vendors, clients, employees, assets — modeled as
"Subjects"), defines what must be proven ("Requirements"), collects evidence from internal staff
or external third parties ("Documents"/"DocumentVersions", including via a public anonymous
"guest upload" link that requires no account), and gets reminded before things expire. There is
also an older, simpler, still-live "Expiration" anchor (a generic due-date tracker, `ExpirationItem`)
that predates the full document-archive domain and continues to exist in parallel — see §2.4 for
why these are NOT the same concept and must not be merged in the UI.

## 2. Backend facts restated inline (read once, referenced by every screen below)

### 2.1 Roles (RBAC) — `Role` type, 4 values, strictly ordered by privilege

`OWNER > ADMIN > MEMBER > VIEWER`. Every screen below states which of these 4 can see it and
which can invoke each action on it, using these role-tier names (from
`src/modules/identity/domain/authorization.ts`, the single ground-truth file for all authorization
in this codebase):

- **READ_ONLY_ROLES** = all 4 roles (OWNER, ADMIN, MEMBER, VIEWER) — anyone with any real
  Membership.
- **WRITE_ROLES** = OWNER, ADMIN, MEMBER (excludes VIEWER) — day-to-day content mutation.
- **ADMIN_ROLES** = OWNER, ADMIN — tenant-wide administrative/disclosure-sensitive actions
  (bulk export, catalogs, audit log, dossier export).
- **OWNER_ROLES** = OWNER only — tenant-wide external/reputational/destructive actions
  (organization settings, closing the tenant, configuring how guest invites are delivered).

**RBAC-aware navigation rule (binding for every screen below)**: a role that cannot perform ANY
action on a screen should not see that screen's nav entry at all (hide, don't just disable) —
this applies most concretely to Organization Settings (OWNER-only) and the various catalog admin
screens (ADMIN-only). A role that can perform SOME but not all actions on a screen sees the screen
with the unavailable actions disabled/absent, never a broken 403 after clicking.

### 2.2 Core entities (glossary — every screen below references these by name only)

| Entity | Module | What it is |
|---|---|---|
| `Organization` | organization | The tenant. Has `displayName`, `timezone`. Lifecycle: ACTIVE → DELETING → HELD_FOR_RECOVERY → DELETED. |
| `Membership` | organization | A user's role within one Organization. Status ACTIVE/SUSPENDED/REMOVED. |
| `Invitation` | organization | A pending invite to join an Organization with a given role. |
| `TrackedSubject` | subject | An entity the tenant tracks compliance for (vendor/client/employee/asset/location/custom). The "Fornecedor" mental anchor. |
| `RequirementAssignment` | subject | **Older, still-live, distinct concept** — a simple MISSING/SATISFIED link between a Subject's requirement and an `ExpirationItem`. See §2.4. |
| `ExpirationItem` | expiration | The original generic due-date entity (name, category, dueDate, status, responsible). Independent of Document/Requirement. |
| `Document` | document-archive | A tracked document belonging to a Subject (e.g., "CND Federal for Vendor X"). Has a `DocumentType`, ACTIVE/ARCHIVED status. |
| `DocumentVersion` | document-archive | One uploaded file for a Document, with lifecycle DRAFT/RECEIVED/UNDER_REVIEW/ACCEPTED/REJECTED/SUPERSEDED/WITHDRAWN. Only one version is ever the current accepted one. |
| `DocumentType` | document-archive | Tenant catalog entry ("Alvará de Funcionamento", "CND Federal"...). ACTIVE/DEPRECATED. Can carry custom metadata field definitions. Publicly readable by guests for the type picker. |
| `Requirement` | document-archive | **Newer, distinct concept from `RequirementAssignment`** — "something a Subject must possess/present/keep valid," backed by `DocumentVersion` evidence, 5 derived states (MISSING/PENDING/SATISFIED/NOT_SATISFIED/NOT_APPLICABLE). See §2.4. |
| `RequirementTemplate` | document-archive | Reusable checklist of Requirements, applicable to a Subject in one action. |
| `DocumentRequest` / `DocumentRequestSeries` | document-archive | A request for a Subject/external party to submit a Document, one-off or recurring. Produces a guest link. |
| `NotificationPreferences` / `NotificationEntitlements` | notification | Per-user reminder channel settings; per-tenant channel availability (email always on; WhatsApp gated by kill switch + entitlement). |
| `WhatsAppOptIn` | notification | Per-user WhatsApp consent record — **no HTTP route exists yet to write this (§9, G5)**. |

### 2.4 Two real naming collisions — do not merge these in the UI

1. **`Requirement` (document-archive) vs. `RequirementAssignment` (subject)** — two genuinely
   separate domain concepts that happen to sound alike. The newer `Requirement` (evidence-backed,
   5-state) lives under Subjects → Requirements (A11) and Document detail (A12/A13). The older
   `RequirementAssignment` (simple MISSING/SATISFIED, linked to an `ExpirationItem`) lives under a
   distinct "legacy tracking" tab (A10). **Never label both simply "Requirement" in the UI** — use
   "Document Requirement" for the new one and "Tracked Requirement" (or similar, product-copy
   decision) for the legacy one, and keep them as visually distinct sections/tabs, never merged
   into one list.
2. **`ExpirationItem` (expiration module) vs. `Document`/`Requirement` (document-archive)** — the
   original generic due-date tracker is independent of the newer document-evidence domain. Both
   are live in P0. A5 (Expiration Detail) and A12 (Document detail) are separate screens; an
   ExpirationItem MAY optionally link to a Subject, but does not require or imply a Document.

### 2.5 Guest surface — structural boundary

The guest-facing flow (G01/G02, §8) is a **completely separate, unauthenticated experience** —
no login, no Organization nav, no shared shell with the authenticated app. A guest is validated
only by an opaque token/credential in the URL, never by a `Role`. Four distinct internal failure
causes (invalid, expired, revoked, not-found token) must always collapse into ONE generic external
message ("this link is unavailable") — this is a deliberate anti-enumeration security property,
not a missing feature; never build a UI that reveals which of the 4 causes applies.

## 3. Navigation shell (authenticated app)

- Persistent primary nav: Dashboard, Expirations, Subjects, Requirements, Reviews (if unblocked,
  §9), Requests, Documents Types/Templates (under Settings), Reports, Team/Organization (Settings),
  Notifications (Settings).
- **Organization switcher**: always visible in the header once a user has ≥2 Memberships (single-
  org users may omit it or show it non-interactively). Switching organizations must: change the
  URL's `:orgId` segment, clear all cached data/filters/selections from the previous org, reset to
  that org's Dashboard (never preserve a route that doesn't exist/apply in the new org), and never
  show a flash of the previous org's data during the transition.
- A role that cannot see any screen in a nav group (e.g., VIEWER and Organization Settings) does
  not see that nav entry (§2.1's RBAC-aware navigation rule).

## 4. Authenticated screens (23) — A01 to A23

Each screen: route, purpose, entities/fields, actions (mapped to real `Action`s + role tier),
states, connections (entry points / links to-from), responsive treatment.

### A01 — Sign-in / Session
- **Route**: `/login`, `/auth/callback`, `/session-expired`
- **Purpose**: authenticate, complete OAuth callback, recover an expired session.
- **Data**: user identity, session state, a validated internal-only `returnPath`.
- **Actions**: none from the RBAC matrix — this is the BFF/identity-provider boundary, pre-RBAC.
- **States**: no session; invalid callback; refresh in progress (should be transparent to the
  user); refresh failed; re-authentication required. `returnPath` must never accept an external
  URL (open-redirect prevention).
- **Connects to**: successful auth → A02 (if no Membership yet) or directly to A03 (if the user
  already has exactly one active Membership) or an organization picker.
- **Responsive**: full parity, single-column form, focus moves to title/error after callback.

### A02 — Onboarding / Organization picker / Invitation acceptance
- **Route**: `/onboarding`, `/organizations`, `/invitations/accept`
- **Purpose**: create the first Organization, list Organizations the user can access, accept a
  pending Invitation, choose the active Organization.
- **Entities**: `Organization` (create/list), `Membership` (role/status), `Invitation`
  (email/role/expiry).
- **Actions**: none from the RBAC matrix (pre-tenant-context by construction — same class of
  exception as `authorizeCancelClosure`). `membership:leave` lives in A19, not here.
- **States**: zero memberships (first-run); invitation valid/already-accepted/revoked/expired;
  invitation email mismatch (the invited email differs from the signed-in account); Membership
  SUSPENDED/REMOVED; a previously-selected org became inaccessible; brief "confirming..." state
  while a just-created Membership propagates (eventually-consistent read path).
- **Connects to**: A01 (from), A03 (to, on selection/creation/acceptance).
- **Responsive**: full parity, organizations as cards, never color-only for status.

### A03 — Dashboard / Compliance Overview
- **Route**: `/app/:orgId/dashboard`
- **Purpose**: answer "what needs my attention right now" tenant-wide.
- **Data**: 4 real counters from `GET /dashboard/summary` — overdue, expiring-soon (7-day window,
  not the 30 days shown in early product mockups — this is a confirmed, deliberate difference),
  awaiting-review, missing-requirements. **Never render "aguardando cliente" or "renovações
  abertas" counters — no backend field models either concept (§9, G6).**
- **Actions**: read-only; implicitly `item:read`/`docarchive:read`/`docarchive:requirement-read`,
  all READ_ONLY_ROLES (every role sees this screen).
- **States**: each counter loads/fails independently (partial data never zeroes the others);
  EMPTY_TRUE genuinely-zero state for a brand-new tenant reads as success, not as an error.
- **Connects to**: each counter card → A04 (Expirations) or A11 (Requirements) pre-filtered to
  that condition; a "review" card → A13 if unblocked (§9).
- **Responsive**: cards reflow 4→2→1 columns, severity order preserved at every width.

### A04 — Expiration Collection
- **Route**: `/app/:orgId/expirations`
- **Purpose**: search/filter/operate on `ExpirationItem` rows (the legacy generic tracker, §2.4).
- **Data**: name, category, due date, derived status (valid/expiring/expired/permanent),
  responsible, priority, tags.
- **Actions**: `item:read` (all roles); `item:create`/`item:update` (WRITE_ROLES); `item:delete`
  (ADMIN_ROLES); `item:export` (ADMIN_ROLES — bulk CSV reads every member's rows, disclosure-
  sensitive); `item:watch` (WRITE_ROLES).
- **States**: EMPTY_TRUE / EMPTY_FILTERED; bulk-action partial success (some rows changed, some
  didn't — must report per-row outcome, never a single pass/fail); export truncated/unavailable.
- **Connects to**: A03 (from, with filter); row → A05; "New" → creation form (inline or modal,
  layout decision, not this document's call); "Import" → A15.
- **Responsive**: table on desktop, selectable cards on mobile; bulk toolbar sticky only within
  the active bulk-selection flow, never obscuring content otherwise.

### A05 — Expiration Detail
- **Route**: `/app/:orgId/expirations/:itemId`
- **Purpose**: manage one `ExpirationItem` — edit, renew, reminders, watchers, generic file
  attachment.
- **Data**: all item fields (name, category, description, dates, periodicity, issuer, number,
  assignee, tags, priority, status, OCC version, `renewedFromId`).
- **Actions**: `item:read` (all); `item:update`/`item:watch` (WRITE_ROLES); `item:delete`
  (ADMIN_ROLES); renew/archive reuse `item:update`; `reminder:manage` (WRITE_ROLES, opens A06);
  `document:reserve-upload`/`document:read` (WRITE_ROLES/all, opens A07); `document:delete`
  (ADMIN_ROLES); `audit:read` (all — technical history of this one aggregate).
- **States**: ACTIVE/ARCHIVED/RENEWED/DELETED; OCC conflict on concurrent edit; renewal is
  idempotent under retry (never creates a duplicate on a retried request); a linked
  successor/origin item may be absent.
- **Connects to**: A04 (both ways); files → A07; reminder policy → A06; `renewedFromId` → another
  A05 instance (the item this one was renewed from).
- **Responsive**: full parity; tabs become horizontal accessible nav or stacked sections;
  destructive actions never in the primary/most-reachable menu position.

### A06 — Reminder Policy (for one Expiration)
- **Route**: `/app/:orgId/expirations/:itemId/reminders/:policyId?`
- **Purpose**: create/view/edit/disable the real reminder policy for one item.
- **Data**: policy id, schedule/offsets, channels, enabled flag.
- **Actions**: `reminder:manage` (WRITE_ROLES).
- **States**: no policy yet; disabled; OCC conflict; a channel without entitlement (e.g. WhatsApp
  off); quiet-hours; scheduler dependency unavailable.
- **Connects to**: only from/to A05. Personal notification-receipt preferences live in A18, not
  here — this screen configures WHEN a reminder fires, A18 configures HOW an individual user
  receives it.
- **Responsive**: full parity, sequence editor as a vertical list on mobile.

### A07 — Generic Document / OCR attachment (Expiration module)
- **Route**: `/app/:orgId/expirations/:itemId/files/:documentId?`
- **Purpose**: the OLDER, simpler file-attachment mechanism tied directly to an `ExpirationItem`
  (module `document`, not `document-archive` — see §2.4, this is genuinely a different, lower-
  level primitive than A12's `Document`/`DocumentVersion`).
- **Data**: file, media type, size, status (PENDING_UPLOAD/SCANNING/CLEAN/REJECTED/
  UNSUPPORTED/TIMEOUT/DELETED); OCR extraction fields with suggested values + confidence, when
  present.
- **Actions**: `document:reserve-upload` (WRITE_ROLES); `document:read` (all); `document:delete`
  (ADMIN_ROLES); `extraction:confirm` (WRITE_ROLES — confirming a SUGGESTED extracted field is a
  distinct, deliberate action; `SUGGESTED != CONFIRMED`, never auto-promote).
- **States**: upload-reserved ≠ bytes-actually-sent; SCANNING is persisted-but-not-yet-observable-
  as-a-final-result; malware rejection; unsupported type; timeout; a suggested field not yet
  confirmed; concurrent confirmation attempt.
- **Connects to**: A05 only, both ways. Do not confuse with A12.
- **Responsive**: full parity; suggested-vs-confirmed field comparison stacks on mobile.

### A08 — Subject Collection
- **Route**: `/app/:orgId/subjects`
- **Purpose**: list/search `TrackedSubject` rows.
- **Data**: name, type (COMPANY/VENDOR/CLIENT/EMPLOYEE/ASSET/LOCATION/CUSTOM), external
  identifier, contact, tags, assignee, status.
- **Actions**: `subject:read` (all); `subject:create`/`subject:update` (WRITE_ROLES);
  `subject:delete` (ADMIN_ROLES).
- **States**: ACTIVE/ARCHIVED/DELETED; EMPTY_TRUE; duplicate external identifier; delete blocked
  by a business rule (e.g. active Requirements exist).
- **Connects to**: A03/A11 (with filter) → here; row → A09; create → A09 (new).
- **Responsive**: table → cards.

### A09 — Subject Hub (compliance)
- **Route**: `/app/:orgId/subjects/:subjectId`
- **Purpose**: the canonical landing point for everything belonging to one Subject.
- **Data**: `TrackedSubject` record; real compliance figures (`totalRequirements`,
  `satisfiedCount`, `expiringSoonCount`, `missingCount`, `compliancePercent` — **`null`, never
  `0%`, when `totalRequirements === 0`**); counts of documents/requirements/series.
- **Actions**: `subject:read` (all); `subject:update` (WRITE_ROLES); `subject:delete`
  (ADMIN_ROLES); `docarchive:requirement-read`/`docarchive:read`/`docarchive:series-read` (all);
  `docarchive:dossier-export` (ADMIN_ROLES, opens A17).
- **States**: compliance `null` (no requirements yet) vs. a real percent — always show numerator/
  denominator alongside the percent, never the bare number alone; partially-unavailable panels;
  archived Subject; a linked resource that was itself removed.
- **Connects to**: A08 (both ways); tabs/links → A10 (legacy tracking), A11 filtered to this
  Subject, A12 (documents), A14 (requests/series); dossier action → A17.
- **Responsive**: full parity; summary before tabs; percent always paired with its numerator/
  denominator.

### A10 — Legacy Tracked Requirements (per Subject)
- **Route**: `/app/:orgId/subjects/:subjectId/tracking`, `/.../tracking/:assignmentId`
- **Purpose**: the OLDER `RequirementAssignment` mechanism (§2.4) — still live, must not be
  merged visually with A11's newer `Requirement`.
- **Data**: assignment id, label, description, status (MISSING/SATISFIED), linked
  `ExpirationItem` + its version, related `DocumentSubmission`s, related legacy `DocumentRequest`s
  (recipient, expiry, revocation, delivery status).
- **Actions**: `requirement:read` (all); `requirement:assign`/`requirement:update`/
  `requirement:review`/`requirement:request-document` (WRITE_ROLES); `requirement:delete`
  (ADMIN_ROLES).
- **States**: linked item absent/archived; MISSING/SATISFIED (this is a snapshot, never re-derive
  it as "compliant right now" without re-checking); an active/revoked/expired legacy request; a
  submission's own PENDING_UPLOAD/SCANNING/CLEAN/REJECTED lifecycle; scheduled chasing is shown as
  informational only, never directly editable here.
- **Connects to**: A09 (from); linked item → A05; "request document" → issues a G01 guest link;
  submissions shown inline.
- **Responsive**: full parity, timeline as a list.

### A11 — Document Requirements (tenant-wide)
- **Route**: `/app/:orgId/requirements`
- **Purpose**: the newer, evidence-backed `Requirement` (§2.4) — searchable across all Subjects.
- **Data**: name, Subject, applicability, status (MISSING/PENDING/SATISFIED/NOT_SATISFIED/
  NOT_APPLICABLE), assignee, linked evidence Document/Version, validity, template origin (if
  applied from a `RequirementTemplate`).
- **Actions**: `docarchive:requirement-read` (all); `docarchive:requirement-create`/`-update`
  (WRITE_ROLES); `docarchive:requirement-delete` (**WRITE_ROLES, not ADMIN** — note this action's
  tier is lower than most `-delete` actions in this codebase, confirmed against the matrix);
  linking/unlinking evidence reuses `-update`; `docarchive:requirement-export` (ADMIN_ROLES, bulk
  CSV); applying a template uses `docarchive:requirementtemplate-apply` (WRITE_ROLES).
- **States**: search requires a status filter to be useful at scale; evidence pending/rejected/
  expired; assignee removed from the org; `NOT_APPLICABLE` explicitly distinct from `MISSING`;
  name-collision guard; template-apply preview distinguishes items that will be created from ones
  skipped as `DUPLICATE_NAME`.
- **Connects to**: A03 (from, filtered); row → A09's Requirement tab; evidence → A12; apply
  template → A21.
- **Responsive**: filters in a drawer on mobile, active filters always announced; partial results
  clearly flagged.

### A12 — Document Detail / Version History
- **Route**: `/app/:orgId/documents/:documentId`
- **Purpose**: the document-archive aggregate — versions, review, metadata. Reached from a
  Subject, a Requirement, or a direct link — there is currently no standalone tenant-wide
  "Documents Collection" screen. G2 (§9) closed the narrower A13 review-queue listing route
  (D-248); a general `listDocuments`/`searchDocuments` route for a standalone collection screen
  was explicitly out of scope for that fix and still does not exist.
- **Data**: `Document` (Subject, DocumentType, ACTIVE/ARCHIVED, `hasValidity`, current accepted
  version, custom metadata); each `DocumentVersion` (sequence, status DRAFT/RECEIVED/
  UNDER_REVIEW/ACCEPTED/REJECTED/SUPERSEDED/WITHDRAWN, origin, issued/valid dates, reviewer,
  rejection reason, scan counters); files (name, media type, size, primary/complementary, scan
  state).
- **Actions**: `docarchive:read` (all); `docarchive:create`/`docarchive:upload`/
  `docarchive:document-metadata-update` (WRITE_ROLES); `docarchive:review` (WRITE_ROLES — claim/
  accept/reject, plus a service-level "reviewer or admin" gate beyond the RBAC tier). **No
  "archive Document" action/route exists** even though the `Document.status` field admits
  ARCHIVED — do not invent an archive button.
- **States**: upload is a 3-step process (reserve version → reserve/send files → commit) — each
  step can independently fail; a file-set once sealed cannot add more files; scan pending/
  infected; a review claim can be lost/expire (another reviewer took it); a version is terminal
  once ACCEPTED/REJECTED/SUPERSEDED/WITHDRAWN; a newly-accepted version automatically supersedes
  the prior one; a required metadata field left empty is shown as an incompleteness indicator, not
  a hard block on saving; an archived metadata field/option keeps its historical value on old
  Documents; OCC conflict on concurrent metadata edit.
- **Connects to**: A09/A11/A13 → here; "new version" stays on this same screen; pending review →
  A13; DocumentType name → A20.
- **Responsive**: full parity — review actions are never degraded on mobile; version history
  becomes a timeline instead of a table; file preview can go full-screen.

### A13 — Review Queue
- **Route**: `/app/:orgId/reviews`
- **Purpose**: operator inbox to discover and decide on `DocumentVersion`s in RECEIVED/
  UNDER_REVIEW state.
- **G2 CLOSED (D-248, 2026-09-09)**: `GET /document-archive/reviews?state=RECEIVED|UNDER_REVIEW`
  now exists (`DocumentArchiveService.listReviewQueue`, `docarchive:read`) — this screen can be
  built end-to-end. One `state` per call (never a merged "ALL" mode server-side, since the GSI5
  index partitions by state) — the frontend calls it per tab/filter, same shape every other
  paginated search route in this codebase already uses.
- **Data**: version, document, Subject, submission origin, receipt time, reviewer, scan
  counters, proposed validity.
- **Actions**: `docarchive:read` (all); `docarchive:review` (WRITE_ROLES, subject to the
  reviewer-or-admin service gate).
- **States**: already claimed by someone else; claim expired; scan still pending; scan infected;
  concurrent decision by two reviewers; rejection requires a reason from a closed set (with an
  "OTHER" free-text option where the domain allows it).
- **Connects to**: A03 (from); item → A12 focused on that version; a decision advances to the next
  queue item or back to A12.
- **Responsive**: full parity; split panel becomes a list→detail sequence on mobile.

### A14 — Requests & Recurrence (per Subject)
- **Route**: `/app/:orgId/subjects/:subjectId/requests`, `/.../series/:seriesId`
- **Purpose**: create/operate `DocumentRequestSeries` (recurring) and view materializations.
- **Data**: Subject, Requirement, series status (ACTIVE/CANCELLED), schedule/recurrence, next
  run, recipient, known materialization attempts.
- **Actions**: `docarchive:series-read` (all); `docarchive:series-create`/`-update`/`-cancel`
  (WRITE_ROLES); `docarchive:series-materialize` (WRITE_ROLES — an explicit "generate now" control,
  distinct from the automated schedule); `docarchive:request-create` (WRITE_ROLES) — **G4 CLOSED
  (D-248, 2026-09-09)**: `POST /document-archive/requirements/{subjectId}/{requirementId}/
  document-requests` now exists. The one-off ("avulso") request control described in the roadmap
  (item 9) can be built end-to-end, same as the recurring/series flow.
- **States**: no recipient set yet; an attempt not yet materialized; generation is idempotent
  (retrying "generate now" never double-issues); credential issuance/delivery uncertain (mirrors
  the SEND_UNCERTAIN discipline used elsewhere in this codebase — never claim delivery succeeded
  when it's actually unconfirmed); OCC conflict on the series; a resulting request may itself be
  expired/revoked/resolved.
- **Connects to**: A09 (from); an issued request → produces a G02 guest link; the target
  Requirement → A11/A09; a received submission → A13/A12.
- **Responsive**: full parity; recurrence schedule shown in both natural language and its precise
  technical form.

### A15 — Bulk Import
- **Route**: `/app/:orgId/imports/new`, `/app/:orgId/imports/:jobId`
- **Purpose**: CSV upload → column mapping → preview → dedupe → commit → resume (P0.2), creating
  Subjects/Documents/Requirements.
- **Data**: job id, type/status, detected columns, current mapping, valid/invalid row counts,
  dedupe results, commit results, resumable cursor/progress.
- **Actions**: `import:create`/`import:map`/`import:commit` (WRITE_ROLES); `import:read` (all —
  status polling).
- **States**: asynchronous parsing (ASYNC_POLLING); a required column with no mapping; an invalid
  mapping; per-row failure; partial success (never presented as all-or-nothing); a resumable job;
  a commit that's already run (idempotent, never double-creates); quota/file-size limit; an
  incompatible file format.
- **Connects to**: A04/A08/A11 (entry points); on completion, links to the created resources and
  back to this same import job's summary.
- **Responsive**: real transformation, not degradation — mapping becomes stacked field pairs
  instead of a wide grid on mobile; the error table becomes a list. Import must remain fully
  usable on mobile, not desktop-only.

### A16 — Reports & Exports
- **Route**: `/app/:orgId/reports`
- **Purpose**: 7 real CSV reports (expired-items, expiring-soon-items, renewed-items,
  expiration-items-by-assignee, missing-requirements, requirements-by-subject,
  requirements-by-assignee) + scheduled `ReportSubscription` management.
- **G3 CLOSED (D-248, 2026-09-09)**: all 7 `GET /reports/*` endpoints are now proxied through the
  BFF (`content-disposition`/`x-report-truncated` added to `ProxyService`'s forwarded response
  headers, plus the 7 routes added to the proxy allowlist). Downloads work end-to-end through the
  browser.
- **Data**: the 7 report definitions; subscriptions (recipients, periodicity, run history,
  download links).
- **Actions**: item-based reports → `item:export` (ADMIN_ROLES); requirement-based reports →
  `docarchive:requirement-export` (ADMIN_ROLES); subscriptions → `reports:subscription-manage`
  (ADMIN_ROLES); a named recipient of one specific run can download THAT run even without being
  ADMIN (a narrower, per-run gate distinct from the tenant-wide export action).
- **States**: an empty report; generation/download failure; a truncated CSV (size-limited,
  signaled via header); an expired-but-regenerable download URL; a deleted subscription; a run
  whose subscription no longer exists but which a past recipient can still access.
- **Connects to**: rows may deep-link back to A04/A11 with an equivalent filter, where possible.
- **Responsive**: full parity; catalog as cards; recipient editor is keyboard-searchable.

### A17 — Subject Dossier Export
- **Route**: `/app/:orgId/subjects/:subjectId/dossier`
- **Purpose**: preview → confirm → download a PDF/Excel dossier for one Subject (P1 item, already
  implemented backend-side, D-205/D-216/D-217).
- **Data**: frozen scope (documents/requirements included), format choice, `scopeHash`, the
  generated run and its download validity window.
- **Actions**: `docarchive:dossier-export` (**ADMIN_ROLES exclusively** — no assignee exception,
  deliberate per D-205; a MEMBER who is the Subject's assignee still cannot export the dossier).
- **States**: the underlying scope changed after preview (stale `scopeHash`); generation
  pending/failed; the export itself expired (30-day TTL, D-235) after being generated; a presigned
  download URL expired and must be regenerated.
- **Connects to**: A09 (both ways).
- **Responsive**: full parity; long previews use collapsible sections, never a desktop-only view.

### A18 — My Notification Preferences
- **Route**: `/app/:orgId/settings/notifications`
- **Purpose**: per-user reminder channel settings, always self-scoped (never configurable for
  another user from this screen).
- **Data**: email-enabled flag, locale, quiet hours, consent source; channel availability
  (entitlement) shown read-only when relevant.
- **Actions**: `notification:configure` (READ_ONLY_ROLES — every real Membership tier, including
  VIEWER, since this ties to being a legitimate reminder recipient, not to workspace
  administration).
- **⚠ NAMED BACKEND GAP — see §9, G5 (non-blocking deferral)**: do not render an actionable
  WhatsApp opt-in toggle. `WhatsAppOptInService.recordOptIn()` has no HTTP route yet. If the
  product wants to explain the channel, show it as "currently unavailable," never as a working
  preference that silently does nothing when toggled.
- **States**: defaults not yet persisted for a new user; invalid or midnight-crossing quiet hours;
  a channel unavailable due to tenant-level entitlement/kill-switch (must render distinctly from
  "you personally turned this off").
- **Connects to**: reachable from account/settings menu and from A06.
- **Responsive**: full parity.

### A19 — Team & Organization Settings
- **Route**: `/app/:orgId/settings/team`, `/app/:orgId/settings/organization`
- **Purpose**: members, invitations, organization identity, leave, close.
- **Data**: `Organization` (displayName, timezone, an implicit owner count); `Membership`
  (userId, role, status); `Invitation` (email, role, status, expiry).
- **Actions**: `membership:list-members`/`membership:leave` (READ_ONLY_ROLES — every role sees the
  roster; `leave` only ever targets the caller's own Membership); `membership:invite`/
  `membership:list-invitations`/`membership:revoke-invitation`/`membership:role-change`/
  `membership:remove` (ADMIN_ROLES); **promoting or demoting to/from OWNER additionally requires
  the ACTING user to be OWNER**, not merely ADMIN — the UI must disable that specific role-change
  option for an ADMIN actor rather than let it 403 after submission; `organization:update-
  settings`/`organization:close`/`organization:cancel-close` (OWNER_ROLES — this whole
  "Organization" sub-tab should not even be visible to non-OWNER roles, per the RBAC-aware-nav
  rule in §2.1).
- **States**: cannot remove/demote the last remaining OWNER; a role-change target is the acting
  user themself (blocked, use "leave" instead); duplicate/expired/revoked invitation; a member in
  SUSPENDED/REMOVED status; organization lifecycle ACTIVE/DELETING/HELD_FOR_RECOVERY/DELETED
  (`cancel-close` only reachable during the recovery window); closing requires a strong,
  deliberate confirmation (irreversible-adjacent — highest-consequence action in the system).
- **Connects to**: an issued invitation → accepted at A02; leaving/closing → back to A02.
- **Responsive**: full parity; members as cards on mobile; the close-organization dialog is
  full-screen with forced focus on its confirmation control.

### A20 — Document Types & Metadata Catalog
- **Route**: `/app/:orgId/settings/document-types`, `/.../document-types/:documentTypeId`
- **Purpose**: the shared `DocumentType` catalog and its custom metadata field definitions.
- **Data**: display name, category/description, default validity behavior, ACTIVE/DEPRECATED;
  metadata fields (valueType TEXT/NUMBER/DECIMAL/DATE/BOOLEAN/SINGLE_SELECT, required flag,
  options, archived state). **This screen must also show, per type, whether it is exposed in the
  public guest catalog** (guests read this same catalog anonymously to pick a type when submitting
  evidence, §8/B2) — this is informational today (there is no separate visibility toggle in the
  backend; every ACTIVE type is guest-visible by construction), not a control to invent.
- **Actions**: `docarchive:documenttype-read` (all); create/rename/deprecate/reactivate
  (`docarchive:documenttype-*`, ADMIN_ROLES); `docarchive:documenttype-metadata-manage`
  (ADMIN_ROLES).
- **States**: duplicate name; a DEPRECATED type still referenced by live Documents; an archived
  field/option; OCC conflict; a type with no metadata fields at all; marking a field "required"
  never retroactively invalidates existing Documents that predate the field.
- **Connects to**: settings nav → here; A12 shows and links to a Document's type.
- **Responsive**: full parity; the field builder stacks on mobile; reordering fields has a
  non-drag (button/keyboard) alternative.

### A21 — Requirement Templates
- **Route**: `/app/:orgId/settings/requirement-templates`, `/.../requirement-templates/:templateId`
- **Purpose**: catalog, edit, duplicate, archive/unarchive, preview, and apply (P0.1).
- **Data**: displayName, description, ACTIVE/ARCHIVED, items (stable id, name, notes,
  applicability, position), version.
- **Actions**: `docarchive:requirementtemplate-read` (all); create/update/duplicate/archive/
  unarchive (ADMIN_ROLES); `docarchive:requirementtemplate-apply` (WRITE_ROLES — a lower tier than
  catalog administration, since applying just creates ordinary operational Requirements).
- **States**: an invalid/empty template; a name collision; a per-Subject apply preview
  distinguishing items that will be newly created from ones that will be skipped as
  `DUPLICATE_NAME`; a partial-application conflict; an ARCHIVED template is read-only for
  non-admins.
- **Connects to**: settings nav → here; A09/A11's "apply template" action → this screen's preview
  → back to A11/A09 with the resulting Requirements.
- **Responsive**: full parity; items reorderable by buttons/keyboard, not drag-only.

### A22 — Document Request Delivery Settings
- **Route**: `/app/:orgId/settings/request-delivery`
- **Purpose**: tenant-wide policy for how the initial guest-request invite is delivered
  (email vs. manual) for the legacy request flow.
- **Data**: `initialInviteDeliveryDefault` (MANUAL or EMAIL).
- **Actions**: `tenant:configure-document-request-delivery` (OWNER_ROLES — this is a workspace-
  wide external-communication policy, not visible to non-OWNER roles at all).
- **States**: no default yet set; OCC conflict on change; email temporarily unavailable; a changed
  default only affects NEW invites, never revokes an already-issued link — this must be stated
  explicitly in the UI copy, not just implied.
- **Connects to**: settings nav → here; A10's "request document" action shows the resulting
  delivery mode.
- **Responsive**: full parity.

### A23 — Admin Activity Log
- **Route**: `/app/:orgId/activity`
- **Purpose**: business-readable "who did what, when" audit trail (P0.7, D-149).
- **Data**: actor, action, resource type/id, timestamp, and whatever change detail the endpoint
  provides.
- **Actions**: `activity:read` (ADMIN_ROLES — disclosure-sensitive, same tier as bulk export).
- **States**: no events yet; pagination; the actor has since been removed from the org; the
  referenced resource was itself deleted; a payload that can't be rendered in plain language must
  show a safe, legible fallback rather than raw JSON.
- **Connects to**: admin nav → here; a recognized resource reference → that resource's own detail
  screen.
- **Responsive**: full parity; timeline layout on mobile.

## 5. Screen → Action reverse map (traceability, Stage 1 axis 1 evidence)

| Action family | Screen(s) |
|---|---|
| `item:create/read/update/delete/export/watch` | A04, A05 |
| `reminder:manage` | A06 |
| `document:reserve-upload/read/delete`, `extraction:confirm` | A07 |
| `notification:configure` | A18 |
| `audit:read` | A05 |
| `system:ping` | none — DEFERRED, §9 G1 |
| `subject:create/read/update/delete` | A08, A09 |
| `requirement:assign/read/update/delete/review/request-document` | A10 |
| `tenant:configure-document-request-delivery` | A22 |
| `import:create/read/map/commit` | A15 |
| `membership:*` | A19 (acceptance itself happens in A02) |
| `organization:update-settings/close/cancel-close` | A19 |
| `docarchive:create/read/upload/document-metadata-update` | A12 |
| `docarchive:review` | A13, A12 |
| `docarchive:requirement-*` | A11, with detail surfaced in A09 |
| `docarchive:series-*` | A14 |
| `docarchive:request-create` | A14 — G4 closed, D-248 |
| `docarchive:documenttype-*` + metadata-manage | A20 |
| `docarchive:requirementtemplate-*` | A21, apply surfaced in A09/A11 |
| `docarchive:requirement-export` | A16, A11 |
| `activity:read` | A23 |
| `reports:subscription-manage` | A16 |
| `docarchive:dossier-export` | A17 |

Every `Action` in `authorization.ts` has a row above — none silently omitted.

## 6. Journeys (how the screens connect end-to-end)

| Journey | Screen path |
|---|---|
| Sign in / create or pick organization | A01 → A02 → A03 |
| Track and renew an expiration | A04 → A05 → (A06 and/or A07) → A05 |
| Register a Subject and measure its compliance | A08 → A09 → A11 |
| Build Requirements from a template | A09/A11 → A21 (preview/apply) → A11 |
| Request evidence recurrently from a Subject | A09 → A14 → G02 (guest link) → A13 → A12/A11 |
| Legacy request/upload | A09 → A10 → G01 (guest link) → A10 |
| Upload and version a document | A09/A11 → A12 → A13 → A12 |
| Bulk onboard via CSV | A04/A08/A11 → A15 → the created resources |
| Report / dossier / audit | A16, A17, A23 |
| Administer the team and tenant | A02/A03 → A19 → A02/A03 |
| Configure catalogs | A20/A21 → A12/A11 |
| Configure preferences and channels | A18/A22 → A06/A10/A14 |

No screen is an orphan (unreachable) and no screen is a dead end (every screen names at least one
onward connection above, or is itself a terminal confirmation state within another screen).

## 7. Responsive & accessibility baseline (applies to every screen; per-screen notes above add to
this, never replace it)

- Minimum target: WCAG 2.2 level AA.
- Every table-shaped collection (A04, A08, A11, A16) transforms into cards/list on narrow
  viewports — never just shrinks.
- Keyboard operability, visible focus, and non-color-only status communication apply everywhere.
- File upload (A07, A12, B2) needs a non-drag-and-drop alternative and must work from a mobile
  camera/file picker — the guest upload flow (B2) is the single highest-likelihood-of-mobile-use
  surface in the whole product and should be designed mobile-first, not adapted afterward.
- Destructive/high-consequence actions (A05 delete, A19 close-organization, A11
  requirement-delete, A10 revoke) always require a deliberate confirmation step reachable by
  keyboard, never a single accidental click/tap.

## 8. Guest-facing surface (2 screens) — G01, G02

Structurally separate from the authenticated app (§2.5). No shared shell, no Organization nav, no
Role-based anything — validated purely by an opaque token/credential in the URL.

### G01 — Legacy Guest Upload
- **Route**: `/guest/document-requests/:token`
- **Purpose**: fulfil a legacy `DocumentRequest` (subject module).
- **Data**: request details safe to expose publicly, expected file type, deadline if present,
  upload/submission state.
- **Actions**: none — validated by `GuestTokenService`, not the RBAC matrix.
- **States**: the token's underlying cause of unavailability (invalid/expired/revoked/not-found)
  is never distinguished externally — always one generic "unavailable" message (§2.5); request
  already satisfied; upload reserved-but-not-yet-sent; upload in progress; upload complete (this
  must never be phrased as "approved" — the guest never reaches an observable reviewed state, by
  design); a malware/scan result, when observable; safe retry on failure.
- **Connects to**: reachable only via a link delivered from A10; on success, ends in an in-page
  confirmation (no navigation into the authenticated app, ever).
- **Responsive**: mobile-first, full parity; labeled file/camera picker; upload progress
  announced to assistive tech.

### G02 — Document Archive Guest Request
- **Route**: `/document-archive/guest/document-requests/:token`
- **Purpose**: resolve a credential, start a guest session (with CSRF protection), and submit
  evidence into the newer document-archive `DocumentRequest`.
- **Data**: the permitted request/Requirement/Subject context; the public `DocumentType` catalog
  (guest-readable subset of A20); the file; **`documentTypeId` is a mandatory field** (D-243/
  D-244 — there is no "unspecified type" option anymore); any dates/validity the contract
  requires.
- **Actions**: none — credential + session + CSRF form the entire guest trust boundary.
- **States**: credential invalid/expired/revoked → the same generic anti-enumeration collapse as
  G01; guest session not started or expired; invalid CSRF token; the selected DocumentType has
  since been deprecated or removed; missing `documentTypeId` is a hard validation error, not a
  soft warning; invalid file / quota exceeded / scan pending; a resubmission with the SAME
  idempotency key and a DIFFERENT `documentTypeId` returns the ORIGINAL accepted snapshot
  unchanged (first-write-wins, D-243 Round 2 — never silently re-validate against the new value);
  "submitted" is never shown as "reviewed" — that boundary is structural, not a UI choice; an
  earlier credential-delivery attempt that was `SEND_UNCERTAIN` must never be revealed to the
  guest as a fact one way or the other.
- **Connects to**: reachable only via a link produced by A14's materialization/issuance; success
  ends in an in-page confirmation; the tenant-side operator continues the journey in A13/A12, not
  here.
- **Responsive**: mobile-first, full parity; short stepped flow; a review-before-submit summary;
  the ability to correct a field before final submit.

## 9. Named gaps and deferrals (Stage 1's 6-condition rule applied — nothing silently dropped)

### Former P0 blockers — ALL 3 CLOSED (D-248, 2026-09-09)

The three gaps below were confirmed as real (Codex's original grep-based finding), then fixed as
pure route-wiring of already-decided capabilities (level 2-3, Claude↔Codex protocol dispensed per
`AGENTS.md` §4 — no new Action, no new RBAC tier, no new architecture decision). Full detail:
`docs/architecture/decisions-log.md` D-248.

- **G2 (was: no tenant-facing HTTP route for review-queue listing) — CLOSED.** The GSI5 sparse
  index and `docarchive:read` RBAC already existed; only the query method
  (`DocumentArchiveService.listReviewQueue`) and route (`GET /document-archive/reviews`) were
  missing. Both now exist, wired through the BFF allowlist and Terraform. **A13 is unblocked.**
  (The broader "browse all documents"/`listDocuments`/`searchDocuments` concept implicit in
  A11/A12's connections was NOT built — only the named A13 review-queue blocker was in scope.)
- **G3 (was: the 7 CSV report endpoints missing from the BFF's proxy allowlist) — CLOSED.** Root
  cause was `ProxyService.forward()`'s response-header allowlist dropping
  `content-disposition`/`x-report-truncated` (not a missing route — the Lambda/Terraform routes
  already existed). Both the header-forwarding fix and the 7 allowlist entries are in place.
  **A16's download action is unblocked.**
- **G4 (was: `docarchive:request-create` had no tenant-facing HTTP route) — CLOSED.** The Action
  and application service (`DocumentArchiveService.createDocumentRequest`, D-226) already
  existed; only the route was missing. `POST /document-archive/requirements/{subjectId}/
  {requirementId}/document-requests` now exists, wired through the BFF allowlist and Terraform.
  **The one-off request control inside A14 is unblocked.**

### Legitimate non-blocking deferrals (all 6 conditions satisfied — safe to launch without)

- **G1 — `system:ping`**: a technical M1 diagnostic route, not a user-facing capability; no P0
  journey depends on it having a screen.
- **G5 — WhatsApp opt-in UI** (affects A18): `WhatsAppOptInService.recordOptIn()` has no HTTP
  route yet (D-246's named gap); email remains fully functional without it; destination is after
  the route exists AND the legal/provider prerequisites (E-019: privacy notice, Meta DPA, data
  residency) are resolved — none of which is an engineering blocker for P0 launch itself.
- **G6 — two dashboard counters** ("awaiting client" / "open renewals") from the original roadmap
  mockup: no current data model reliably represents either concept; the 4 implemented counters
  remain a complete, honest dashboard without them; destination is a future milestone after a
  product decision names what data would back these.
- **G7 — `ExternalShareLink`** (P1 item, not P0): only the domain/persistence/service slice is
  implemented (D-241); no HTTP route exists; no P0 journey (including guest upload, which is a
  fully independent mechanism) depends on it. No "Share" control should appear in A12.
- **G8 — internal/operational state** (chasing workers, automatic series materialization,
  notification attempts, entitlements, portfolio quotas, credential delivery internals): none of
  these have a human-facing `Action`/route by design — they are background automation, not consoles
  a tenant user operates. Their observable effects surface through the relevant screens above
  (e.g., a materialization shows up as a new request row in A14); no dedicated admin screen should
  be invented for them.

## 10. Relationship to the existing frontend codebase

`frontend/` (Vite+React+TS+React Router v7+TanStack Query v5) already implements a real, tested,
`APPROVED` vertical slice for the Expiration anchor only: Expiration Collection/Detail/Create/
Renew (`docs/frontend/core-expiration-vertical-slice.md`), on top of a real Full BFF
(`docs/frontend/frontend-production-foundation.md`) and the `APPROVED` "Operational Calm" visual
language/design system (`docs/frontend/design-system.md`). **A04/A05 above are NOT new screens to
design from scratch — they already exist in production-quality form.** Everything else in this
document (A01-A03, A06-A23, G01-G02) is net-new frontend surface to be designed and built against
this same BFF/design-system foundation. Read `design-system.md` for the actual visual language,
tokens, and component patterns before producing any visual design — this document deliberately
made zero layout/visual decisions (per its stated scope, §0).

## 11. Evidence trail

Full Stage 1 (rubric) and Stage 2 (this inventory) round-by-round record, including both blind
proposals, reconciliation rounds, and self-scores, at
`docs/architecture/reviews/p0-frontend-screens-scoping/`. Summarized in
`docs/architecture/decisions-log.md` D-247.
