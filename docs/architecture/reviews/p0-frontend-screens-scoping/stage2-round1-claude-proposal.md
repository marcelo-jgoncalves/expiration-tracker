# Stage 2, Round 1 — Claude's BLIND independent screen inventory proposal

Graded against Stage 1's converged rubric (`stage1-estado-final-consolidado.md`, 8 axes/100pts).
Written before seeing any Codex output on Stage 2. Grounded in the real backend survey: full
`Action` union in `src/modules/identity/domain/authorization.ts` (ground truth for RBAC/roles),
entity survey of `organization`, `document-archive`, `subject`, `expiration`, `notification`
domain folders, and `docs/frontend/` prior planning (`interface-screen-and-state-inventory.md`,
17 `SURF-xxx` — predates document-archive/multi-tenant B2B, now superseded in scope but its state
taxonomy discipline is reused, not reinvented).

Roles referenced throughout: **OWNER > ADMIN > MEMBER > VIEWER** (`Role` type, `authorization.ts`).

## A. Authenticated tenant app

### A1. Dashboard / Compliance Overview
- Route: `/`
- Purpose: answer "what needs attention now" tenant-wide (P0.6).
- Entities: aggregated counts from `GET /dashboard/summary` (overdue, expiringSoon 7-day window, awaitingReview, missingRequirements); per-Subject compliance card (`GET /document-archive/requirements/{subjectId}/compliance`).
- Fields: overdueCount, expiringSoonCount, awaitingReviewCount, missingRequirementsCount; per-Subject totalRequirements/satisfiedCount/expiringSoonCount/missingCount/compliancePercent (null when totalRequirements=0).
- Actions: `item:read`/`docarchive:requirement-read` implicitly (read-only screen); click-through to Expiration Collection / Requirements / Subject Detail. All roles (READ_ONLY_ROLES) see it.
- States: INITIAL_LOADING, error (retry), success, EMPTY_TRUE (new tenant, 0 items). Named gap: "aguardando cliente"/"renovações abertas" counters from the roadmap example are NOT implemented in the backend (no model field covers them) — must render only the 4 implemented counters, never fabricate the other 2.
- Connects to: Expiration Collection (A2), Requirements/Subject Detail (A6), Review Queue (A9).

### A2. Expiration Collection
- Route: `/expirations`
- Purpose: list/filter/sort `ExpirationItem` rows (legacy anchor, still live per D-116 naming-collision note — distinct from document-archive's `Requirement`).
- Entities: `ExpirationItem`.
- Fields: name, category, status (valid/expiring/expired/permanent), dueDate, responsible, linked Subject (if any).
- Actions: `item:create` (WRITE_ROLES) → Create; `item:read` (all roles); `item:update`/`item:delete` (WRITE/ADMIN) from row; `item:export` (ADMIN_ROLES only — bulk CSV, disclosure-asymmetry precedent D-123/D-126); `item:watch` (WRITE_ROLES).
- States: INITIAL_LOADING, BACKGROUND_REFRESH, EMPTY_TRUE, EMPTY_FILTERED, error, LOAD_MORE (pagination PARTIAL per prior planning).
- Connects to: Expiration Detail (A3), Create (A2a), Export (reuses this screen's action, no separate route).

### A3. Expiration Detail
- Route: `/expirations/{itemId}`
- Purpose: hub for one ExpirationItem — renew, watch, reminder policy.
- Entities: `ExpirationItem`, `ItemWatch`, `ReminderPolicy` (via `reminder:manage`).
- Actions: `item:update`, `item:delete` (ADMIN), `item:watch` (WRITE_ROLES), `reminder:manage` (WRITE_ROLES), renew action.
- States: loading/error/success/OCC CONFLICT (expectedVersion mismatch) on any mutation; UNKNOWN_OUTCOME after a timed-out mutation (never auto-retry — reconsult).
- Connects to: A2 (back), Renewal flow (same-screen action, not separate route per current backend).

### A4. Documents Collection
- Route: `/documents`
- Purpose: list/search/filter `Document` (document-archive) tenant-wide — P0.5 search/filters surface.
- Entities: `Document`, joined `DocumentType`, `Requirement` (if linked), `Subject`.
- Fields: name, DocumentType, status (derived from current `DocumentVersion`), validity, assignee, Subject.
- Actions: `docarchive:create` (WRITE_ROLES, new Document), `docarchive:read` (all roles), `docarchive:document-metadata-update` (WRITE_ROLES).
- Filters (P0.5): status (valid/expiring/expired/permanent/awaiting-review/archived), DocumentType, responsible, Subject, tag.
- States: loading/empty (true/filtered)/error; search fatias 4-5 (materialized projection/assignee index) are **DEFERRED** — record explicitly, not silently.
- Connects to: Document Detail (A5), Document Types catalog (A11, admin), Requirement Context (A7).

### A5. Document Detail
- Route: `/documents/{documentId}`
- Purpose: hub for one Document — versions, review, metadata, dossier inclusion.
- Entities: `Document`, `DocumentVersion[]` (current + superseded/history), `DocumentType`, custom metadata fields.
- Actions: `docarchive:upload` (WRITE_ROLES, new version), `docarchive:review` (WRITE_ROLES, claim/accept/reject a pending version), `docarchive:document-metadata-update` (WRITE_ROLES), `docarchive:read` (view, all roles).
- States: version history list; CLEAN/SCANNING/QUARANTINED states per version (malware scan pipeline); review-pending badge; OCC conflict on metadata edit.
- Connects to: A4 (back), A9 Review Queue (if pending), A7 Requirement Context (if this version satisfies a Requirement).

### A6. Subjects Collection & A6a Subject Detail
- Route: `/subjects`, `/subjects/{subjectId}`
- Purpose: TrackedSubject listing + per-subject requirement/compliance view (the "Fornecedor" anchor, dual-anchor IA inherited from prior planning).
- Entities: `TrackedSubject`, `RequirementAssignment` (subject module) — note distinct from document-archive's `Requirement` (D-116 naming collision, must be labeled distinctly in UI copy, e.g. "Legacy Requirement Assignment" vs "Document Requirement").
- Actions: `subject:create/read/update/delete` (WRITE/READ/ADMIN tiers), `requirement:assign/read/update/delete/review` (older subject-module requirement).
- States: compliance % card (same formula as A1); EMPTY_TRUE for new tenant.
- Connects to: A7 Requirement Context, A10 Document Request Context.

### A7. Requirement Context (document-archive)
- Route: `/requirements/{requirementId}`
- Purpose: one document-archive `Requirement` — 5-state derived status, linked evidence (DocumentVersion), request history.
- Entities: `Requirement`, linked `Document`/`DocumentVersion`, `DocumentRequest[]`.
- Actions: `docarchive:requirement-create/read/update/delete` (WRITE/READ/WRITE tiers — note delete is WRITE_ROLES not ADMIN per matrix), `docarchive:request-create` (WRITE_ROLES, avulso request).
- States: 5 derived states (name per domain — satisfied/missing/expiring/expired/awaiting-review, confirm exact enum against `requirement.ts` before Claude Design build), EMPTY_NOT_READY before any request exists.
- Connects to: A8 Requests Collection, A5 Document Detail, A9 Review Queue.

### A8. Requests Collection (tenant-wide)
- Route: `/requests`
- Purpose: cross-Subject/cross-Requirement view of all `DocumentRequest`/`DocumentRequestSeries` — closes the SURF-013 gap the OLD planning marked BLOCKED (query now exists per D-226/D-230 consolidation — verify exact tenant-wide list route before build; if still absent, record `DEFERRED` per Stage-1 rule, not fabricated).
- Entities: `DocumentRequest`, `DocumentRequestSeries`.
- Actions: `docarchive:series-create/read/update/cancel/materialize`, `docarchive:request-create` (avulso).
- States: status per request (REQUESTED/DELIVERED/SUBMITTED/EXPIRED/REVOKED/CANCELLED — confirm enum), recurrence badge for series-backed requests.
- Connects to: A7, A9, credential delivery status (email/WhatsApp channel indicator).

### A9. Review Queue
- Route: `/review-queue`
- Purpose: operator inbox for guest-submitted evidence awaiting `docarchive:review` (claim → accept/reject).
- Entities: `DocumentVersion` in review-pending state, tied `Requirement`/`Document`.
- Actions: `docarchive:review` (WRITE_ROLES) — claim, accept, reject-with-reason.
- States: EMPTY_TRUE (nothing pending — genuine success state, must not read as inactivity/error), claimed-by-another-user (optimistic lock/lease state — reuse D-233's CLAIMED→DELIVERED/SEND_UNCERTAIN discipline naming if a similar lease exists here), OCC conflict.
- Connects to: A5 Document Detail, A7 Requirement Context.

### A10. Requirement Templates
- Route: `/requirement-templates`
- Purpose: catalog CRUD + apply to a Subject (P0.1).
- Entities: `RequirementTemplate`.
- Actions: `docarchive:requirementtemplate-create/update/duplicate/archive/unarchive` (ADMIN_ROLES), `-read` (READ_ONLY_ROLES), `-apply` (WRITE_ROLES — applying creates operational Requirements, lower tier than catalog admin).
- States: archived vs active filter, duplicate-name prevention validation, apply-preview before commit.
- Connects to: A6a Subject Detail (apply target), A7 (resulting Requirements).

### A11. Document Types
- Route: `/document-types`
- Purpose: catalog CRUD + configurable metadata fields (P0.8, P1 metadata item).
- Entities: `DocumentType`, metadata field/option catalog.
- Actions: `docarchive:documenttype-create/rename/deprecate/reactivate` (ADMIN_ROLES), `-read` (READ_ONLY_ROLES), `docarchive:documenttype-metadata-manage` (ADMIN_ROLES, field/option catalog).
- States: ACTIVE/DEPRECATED filter; guest-visible flag (this catalog is publicly readable for guest discovery per repo docs — must show which types are guest-exposed).
- Connects to: A4/A5 (DocumentType picker), Guest Submission (B1, reads same catalog anonymously).

### A12. Bulk Import
- Route: `/import`
- Purpose: CSV import wizard — mapping → preview → dedupe → commit → resume (P0.2).
- Entities: `ImportJob` (or equivalent).
- Actions: `import:create` (WRITE_ROLES), `import:map` (WRITE_ROLES), `import:commit` (WRITE_ROLES), `import:read` (READ_ONLY_ROLES, status polling).
- States: UPLOADED→PARSING→PREVIEW_READY→COMMITTING→COMPLETE/PARTIAL_FAILURE, resumable-failure state, ASYNC_POLLING.
- Connects to: A2/A4 (destination collections), A6 (created Subjects).

### A13. Reports & Exports
- Route: `/reports`
- Purpose: CSV reports (expired/expiring/missing-requirements/by-subject/by-assignee), scheduled subscriptions, dossier export (P0.7 + P1 items 15/16).
- Entities: report run records, `ReportSubscription`, `DossierExportRun`.
- Actions: `docarchive:requirement-export` (ADMIN_ROLES), `reports:subscription-manage` (ADMIN_ROLES), `docarchive:dossier-export` (ADMIN_ROLES exclusively — no assignee tier, D-205).
- States: async generation (ASYNC_POLLING), download-ready, TTL-expired download link (30-day purge, D-235), subscription recipient list.
- Connects to: A6a (dossier export entry point, per-Subject), A14 (recipients drawn from Members).

### A14. Members & Invitations
- Route: `/settings/members`
- Purpose: manage Membership/Invitation (B2B core).
- Entities: `Membership`, `Invitation`.
- Actions: `membership:invite/revoke-invitation/list-invitations` (ADMIN_ROLES), `membership:list-members` (READ_ONLY_ROLES — all roles can see the roster), `membership:role-change/remove` (ADMIN_ROLES, with named OWNER-tier-change exception requiring OWNER), `membership:leave` (READ_ONLY_ROLES — any member acting on themselves only).
- States: pending invitation (expiry countdown), last-owner-guard error (cannot demote/remove the last OWNER), role-change-to-OWNER requires OWNER (not just ADMIN) — UI must disable that specific transition for an ADMIN actor, not just rely on a 403.
- Connects to: A15 Organization Settings, A13 (report recipients).

### A15. Organization Settings
- Route: `/settings/organization`
- Purpose: OWNER-only workspace identity/config + destructive close/cancel-close.
- Entities: `Organization` (displayName, timezone), `TenantLifecycleRecord`.
- Actions: `organization:update-settings` (OWNER_ROLES), `organization:close` (OWNER_ROLES, irreversible-adjacent — HELD_FOR_RECOVERY window), `organization:cancel-close` (OWNER_ROLES, via `authorizeCancelClosure`, only reachable during the recovery window), `tenant:configure-document-request-delivery` (OWNER_ROLES — email/WhatsApp delivery policy for guest invites).
- States: ACTIVE/DELETING/HELD_FOR_RECOVERY/DELETED lifecycle; non-OWNER sees this entire screen as unavailable, not a disabled form (RBAC-aware nav: ADMIN/MEMBER/VIEWER should not even see this nav entry, per Stage-1 axis 3).
- Connects to: A14, A16.

### A16. Notification Preferences
- Route: `/settings/notifications`
- Purpose: per-user reminder channel preferences + WhatsApp opt-in (self-service).
- Entities: `NotificationPreferences` (per-user), `WhatsAppOptIn`, `NotificationEntitlements` (read-only display of plan-level channel availability).
- Actions: `notification:configure` (READ_ONLY_ROLES — any real Membership, tied to being a legitimate reminder recipient, not a workspace-config action).
- States: WhatsApp channel unavailable (kill switch off / entitlement false) must render distinctly from "you turned it off" — never conflate a tenant-level unavailability with a personal preference.
- Named backend gap to record `DEFERRED`, not built: no HTTP route yet exists for `WhatsAppOptInService.recordOptIn()` (D-246) — this screen's WhatsApp opt-in control cannot be wired until that route exists; Stage 2 records this explicitly rather than silently presenting a button with nothing behind it.
- Connects to: A15 (tenant-level channel policy, OWNER-configured, read-only reference from here).

### A17. Activity / Audit Log
- Route: `/settings/activity`
- Purpose: business-readable "who did what when" (P0.7 audit trail, D-149).
- Entities: audit events across modules.
- Actions: `activity:read` (ADMIN_ROLES — disclosure-sensitive, same tier as export).
- States: EMPTY_TRUE (new tenant), filter by actor/action/date, pagination.
- Connects to: entities referenced by each event (deep link back to Document/Requirement/Member row where possible).

### A18. Onboarding / First-Run
- Route: `/onboarding`
- Purpose: create-first-organization flow for a brand-new authenticated user with no Membership yet.
- Entities: `Organization` (create), initial OWNER `Membership`.
- Actions: implicit `organization:update-settings`-equivalent creation path (no Membership exists yet, so this is pre-RBAC by construction — same class of exception as `authorizeCancelClosure`).
- States: no-org vs has-invitation-pending (accept instead of create) branch.
- Connects to: A19 Invitation Acceptance, then into A1 Dashboard.

### A19. Invitation Acceptance
- Route: `/invitations/{token}`
- Purpose: accept a pending `Invitation` — distinct from Guest surface (this IS an authenticated-adjacent flow, requires sign-in but not yet Membership).
- States: invalid/expired/already-accepted/wrong-account-email token states.
- Connects to: A1 (post-accept), A18 (if no invitation, redirected to create).

## B. Guest-facing (unauthenticated) surface — structurally separate shell, no tenant nav

### B1. Guest Request View
- Route: `/g/{shareToken}` or equivalent opaque-token route (public, `authorization_type=NONE`, no `RequestContext`).
- Purpose: External Submitter sees what's being requested and by whom, decides to proceed.
- Entities: `DocumentRequest` (public-safe projection), `DocumentType` (guest-readable catalog entry), requesting Organization's display name (GTR-01 requirement — must show requester identity, not omit it).
- States: valid/expired/revoked/already-submitted/not-found — the anti-enumeration collapse rule applies: INVALID/EXPIRED/REVOKED/NOT_FOUND causes must render as ONE generic "link unavailable" external state (never distinguish, security-load-bearing per prior planning §29).
- Connects to: B2 Guest Upload.

### B2. Guest Upload / Submit Evidence
- Route: same as B1 or a sub-step.
- Purpose: select DocumentType (now mandatory per D-243/D-244), upload file, submit.
- Entities: `Document`/`DocumentVersion` created via `submitEvidence`, keyed by `idempotencyKey`.
- Fields: file, `documentTypeId` (required select from guest-readable catalog — A11's guest-visible subset).
- States: file-type/size validation, upload progress, idempotent-replay-safe resubmit (same key + different `documentTypeId` returns original snapshot, first-write-wins per D-243 Round 2), post-submit confirmation (distinct from "reviewed/accepted" — guest never reaches an observable reviewed state, this is a structural epistemic limit, not a UI omission).
- Connects to: back to B1 on link reuse; no path into the authenticated app (P6 isolation preserved).

### B3. Guest Link Unavailable
- Route: same token route, terminal state.
- Purpose: single generic unavailable page for all 4 collapsed failure causes.
- States: static — one message, no retry (token is dead), a support/contact path if the tenant configured one.

## Deferred / not-yet-buildable (recorded per Stage 1's 6-condition rule, not silently dropped)

- External Share Link (P1 item 8/19) — domain+persistence+service implemented (D-241, slice 1/3), but NO HTTP route exists yet (slices 2/3 paused deliberately, P0 priority). **No screen buildable today.** Destination milestone: after P0 closes (per `NEXT_SESSION_PROMPT.md`).
- WhatsApp opt-in HTTP route (D-246 named gap) — affects A16 above.
- Search fatias 4-5 (materialized projection/assignee index) — affects A4 filter completeness; has a named quantitative trigger in D-194.
- P0.7 "solicitações pendentes" without tenant-wide GSI, and "business-readable audit trail" — the latter is now addressed by A17/D-149; the former is addressed by A8 if the route actually exists (verify before build).
- Submission Review branch-point (old SURF-012, BLOCKER-C) — superseded: D-222/D-226 through D-230 closed the guest consolidation gap for real; A9 Review Queue is the modern equivalent. Not carrying forward as BLOCKED.

## Self-score (before seeing Codex)

Estimated against Stage 1's 8 axes: strong on axis 1 (traceability — every `Action` in the matrix I read maps to a screen or is named a deferral), axis 3 (RBAC stated per screen), axis 6 (guest separation structural). Weaker on axis 4 (I named domain-specific states but did not verify exact enum values against the domain files — flagged inline as "confirm before build" in A7/A8, which is honest but incomplete) and axis 8 (this document assumes the reader already knows `authorization.ts`'s role tiers; the FINAL doc must restate them inline, this round-1 draft does not fully). **Self-score: 8.4/10.**
