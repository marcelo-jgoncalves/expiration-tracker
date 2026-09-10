---
status: APPROVED — converged via Claude↔Codex protocol (AGENTS.md §4), one blind round +
  reconciliation, Claude 9.3/10, Codex 9.3/10 (both self-scored blind, ≥9.0 without rounding,
  genuine fast convergence — see AGENTS.md §4's own carve-out against forcing unneeded rounds)
owner: Marcelo
authority: this document is what the next implementation session follows directly to build the
  remaining screens of docs/frontend/p0-screen-inventory-plan.md. It does not re-decide any RBAC
  tier, route, or state named in that plan or in the audited specs in
  docs/frontend/prototype-screen-specs/ — it only sequences and tiers the work.
date: 2026-09-10
evidence: docs/architecture/reviews/frontend-implementation-sequencing-scoping/
  (claude-round1-proposal.md, codex-round1-prompt.txt, codex-round1-output.txt,
  reconciliation.md)
---

# Frontend Implementation Sequencing Plan

## 0. Why this document exists, and a correction to the record it starts from

Backend for the P0 roadmap is complete. All 25 frontend screens (A01-A23, G01-G02) now have an
audited/revised spec (`docs/architecture/reviews/screen-spec-audit-2026-09-09/`), but the audit
explicitly named "implementation-sequencing is not decided" as the one remaining open item before
writing frontend code (§6 of `estado-final-consolidado.md`). This document closes that gap.

**Correction, verified by direct code inspection (not assumed from docs)**: the premise repeated
in `p0-screen-inventory-plan.md` §10 and `core-expiration-vertical-slice.md` — that only A04/A05
(Expiration Collection/Detail/Create/Renew) exist as real frontend code — is stale. Both the Claude
and Codex blind proposals independently verified more real, shipped, tested code exists:

| Real file(s) in `frontend/src/routes/` | Maps to plan screen | Real state today |
|---|---|---|
| `items/{ItemsCollection,ItemDetail,CreateItem,RenewItem}.tsx` | A04/A05 | Full CRUD+renew, OCC, idempotency — the flagship slice, unchanged by this plan |
| `Overview.tsx` | precursor to A03 | Read-only, thinner than A03's spec (missing 4 of 5 cards) |
| `Onboarding.tsx`, `AcceptInvitation.tsx` | A02 | Partial |
| `subjects/{SubjectsCollection,SubjectDetail}.tsx` | A08/A09 | Partial, explicitly scoped narrow ("no create subject affordance yet", BLOCKER-C Variante B) |
| `Members.tsx`, `Settings.tsx` | A19 | Partial — roster, org displayName/timezone, leave, close (D-120/D-122/D-125) exist; **the 3 CRITICAL RBAC findings from the audit (roster wrongly ADMIN-gated in spec vs. code's single `canManage` flag, Organization tab RBAC, OWNER-promotion gating) have NOT been reconciled against this real code yet** |
| `ActivityLog.tsx` | A23 | Real, `GET /activity` (D-149), described in its own code as a minimal implementation |
| `NotImplementedPlaceholder.tsx` | everything else not listed above | Explicit honest stub, not a silent 404 |

Also verified: real routes today are **global paths** (`/items`, `/subjects`, `/overview`,
`/members`, `/settings`, `/activity`) — **not** the plan's `/app/:orgId/...` contract. This is a
real, load-bearing gap (not just a spec-authoring nit — see SLF-03 in §5) that must close before
more routes are added under the old pattern.

Design-system components already real (`frontend/src/components/ui/`): `Button`, `Checkbox`,
`DataTable`, `Divider`, `IconButton`, `InlineNotice`, `Layout`, `Link`, `RadioGroup`,
`StatusBadge`, `Switch`, `UrgencyIndicator`; motion tokens already exist
(`design-system.md` §21, `fast/normal/slow`). No risk-prioritized metric-card variant (SLF-01) and
no shared `GuestLinkUnavailable` (SLF-05) exist yet as components.

**Implication for every block below**: "build screen X" means, for the 7 partially-real screens
above, *reconcile and complete the existing real implementation against its audited spec* — never
a from-scratch rewrite, and never treated as a already-done checkbox either.

## 1. Block structure (11 blocks, ordered)

A "block" is a coherent 2-4 screen slice, grouped by shared journey + shared component/data DNA —
not one screen per block (too much review overhead, doesn't prove transitions) and not a fixed
batch size (arbitrary screens grouped together prove nothing about a journey). Two blocks are
deliberately single-screen because each is its own operational unit with all its integrations
already built by the time it's reached (A18, A15) — this exception is itself part of the
convergence, not a deviation from it.

### Block 0 — Cross-cutting foundation (no new full screens)

- Migrate authenticated routing from today's global paths to the plan's `/app/:orgId/...` contract
  (real code change, not a spec-only fix — SLF-03's most material instance). Covers redirects,
  breadcrumbs, existing tests/mocks/Playwright specs, and visual-regression snapshots that
  currently assume tenant-less paths.
  order switching (per §3 of `p0-screen-inventory-plan.md`: URL `:orgId` changes, cache/filter
  reset, no flash of previous org's data).
- Make AppShell navigation declarative and RBAC-aware (replace the hard-coded `NavLink` list with
  a model that filters by role, per the RBAC-aware-nav rule in the plan's §2.1) rather than adding
  nav items ad hoc per block.
- Build the SLF-01 risk-prioritized compliance-summary card pattern as a real, reusable component
  (needed by A03 and A09, both reached in Block 1/3).
- Build the SLF-05 `GuestLinkUnavailable` shared component (needed by G01/G02 in Block 6/7) —
  built once here, only *integrated* later, to avoid two divergent copies.
- Process-only fixes (near-zero cost, do here, not "foundation work" in the heavyweight sense):
  add a "Motion" prompt to the spec-authoring template (SLF-02) and add the `:orgId`-qualified
  route pattern to the shared route-naming checklist (SLF-03, spec-authoring half).
- New tests: shell contract tests (org switch, cache segregation, no stale-org flash, role-based
  nav visibility) — these become the standing regression gate alongside the existing Core
  Expiration E2E suite.

### Block 1 — Entry and administration — COMPLETE (D-255 A19/A03, D-256 A01/A02 + block Codex review)

A01 (Sign-in/Session) · A02 (Onboarding/picker/invitation) · A03 (Dashboard) · A19 (Team &
Organization)

All 4 screens implemented, tested, and covered by one Codex block-review round (D-256; findings
fixed same session). A19's 3 CRITICAL RBAC findings (roster visibility, Organization-tab OWNER
gating, OWNER-promotion restriction) and its storage subsection were fixed/built in D-255. A01's
audited spec described a client-side password form contradicting the already-APPROVED BFF/Cognito
Hosted UI architecture (D-053/D-054) — the spec was corrected to the real redirect/state-machine
flow, not rewritten as a form (D-256). A02's 3 spec-required operational fields (per-org attention
count, suspended-Membership badge, session-level pending-invitation banner) were investigated and
confirmed as genuine new backend capabilities, not mechanical wiring — implemented with graceful
degradation (real fields only) and the gap recorded precisely in A02-onboarding.md and D-256; a
future session should treat closing that backend gap as new scoped work, not part of this block.

### Block 2 — Expirations, completed

A05 already exists (extend, don't touch its passing test suite) · A06 (Reminder Policy) · A07
(Generic Document/OCR attachment)

Closes the "Track and renew an expiration" journey (§6, journey 2) fully. Smallest incremental
surface — both A06/A07 attach directly onto the already-shipped A05.

### Block 3 — Subject compliance core — COMPLETE (D-259, 2026-09-10)

A08 (complete CRUD, currently read/review-only) · A09 (Subject Hub, replacing the narrow
`SubjectDetail` with the full hub + SLF-01 compliance card) · A11 (Requirements, tenant-wide)

Closes journey 3 ("Register a Subject and measure its compliance") end-to-end; establishes the
collection/hub/filter/contextual-action patterns reused by every later collection screen.

All 3 screens implemented, tested (247/247), and covered by one Codex block-review round (5.2/10
blind, 8 blocking findings, all fixed same session — see D-259). Named, real (not mechanical) gaps
carried forward: A08 has no pending-first sort (TrackedSubject carries no pending-count
aggregation, a deliberate prior decision, D-194); A11 has no CSV export (no backend route/handler
exists anywhere for `docarchive:requirement-export`); A09's dossier export stops at the real
preview step (the backend's own generation/download fatia isn't built yet either). A10 (Block 7)
still has no frontend, so the legacy `RequirementAssignment` review/link/unlink journey the old
`SubjectDetail` offered is temporarily unavailable until A10 ships — an accepted consequence of
this block's replace-not-extend instruction, not a silent regression. E2E/Playwright and
accessibility verification were NOT run for these 3 screens this session (process gap, recorded
in `NEXT_SESSION_PROMPT.md` — run before starting Block 5, do not let it accumulate further).

### Block 4 — Catalogs and templates

A20 (Document Types & Metadata Catalog) · A21 (Requirement Templates)

A20 must precede Block 6 (G02 requires `documentTypeId` from this same public catalog). A21 closes
journey 4 (template apply).

### Block 5 — Document and review

A12 (Document Detail/Version History) · A13 (Review Queue)

Reviewed together because a claim/decision started in A13 must produce a coherent resulting state
in A12/A11 — shared version/review/claim-lifecycle DNA.

### Block 6 — Modern request loop, end-to-end

A14 (Requests & Recurrence) · G02 (Document Archive Guest Request)

Verified as one property, not two isolated screens: A14 → G02 → A13/A12 (issuance → guest
submission with CSRF/session → operator continuation), including the anti-enumeration collapse
(now integrating Block 0's `GuestLinkUnavailable`) and the "submitted ≠ reviewed" epistemic
boundary.

### Block 7 — Legacy flow, complete

A10 (Legacy Tracked Requirements — the only WORLD-CLASS-READY spec, 92.4/100) · A22 (Request
Delivery Settings) · G01 (Legacy Guest Upload)

A10's high spec score reduces specification risk but not execution risk — full rigor still
applies. A22 is a direct dependency of A10's request-delivery behavior. G01 closes the legacy
guest journey and reuses Block 0's shared anti-enumeration component (now proven once in Block 6).

### Block 8 — Preferences and channels

A18 (My Notification Preferences) — single-screen block, deliberately: by now A06/A10/A14 exist to
verify integration against, and it's a self-contained unit. WhatsApp stays non-actionable per G5
(no route exists) — never fabricate a working toggle.

### Block 9 — Bulk onboarding

A15 (CSV Import) — single-screen block: only makes sense once A04/A08/A11 (its creation targets)
are mature enough to validate dedupe, partial success, and links to materialized resources.

### Block 10 — Managerial evidence

A16 (Reports & Exports) · A17 (Subject Dossier Export) · A23 (converge existing minimal
implementation with the revised spec)

A23 already has real code — this block is its convergence pass, not first authorship. A16/A23
share the ADMIN-only/disclosure-sensitive gate; A17's gate is narrower (ADMIN_ROLES exclusively,
no assignee exception, D-205) and must not inherit A16/A23's pattern blindly.

## 2. AppShell / BFF / design-system integration approach

- The existing composition (`ProtectedRoute → ActiveOrganizationProvider → OnboardingGate →
  AppShell → Outlet`) stays — this is a routing/navigation evolution, not an architectural
  rewrite.
- The `/app/:orgId` migration (Block 0) is the one genuinely invasive change: real regression risk
  to already-shipped screens (A04/A05, Subjects, Members, Settings, ActivityLog) via absolute
  links, redirects, breadcrumbs, existing unit/E2E tests, and Playwright visual-regression
  snapshots that all currently assume tenant-less paths, plus any TanStack Query cache keys that
  don't yet key on `orgId` (risk of stale cross-org data surviving an org switch).
- Mitigation: do this migration once, fully, in Block 0, verified against every already-shipped
  route (A04/A05, Subjects, Members, Settings, ActivityLog) before any new route is added under the
  new pattern — never migrate incrementally per block (that would mean living with two routing
  conventions simultaneously for 10 blocks).
- `ApiClient` remains the single point of backend communication; no component ever calls `fetch()`
  directly. Every new screen family gets its own typed API module + TanStack Query hooks + an
  explicit retry policy (never inherit a default retry no one chose, per the existing
  `retryPolicyFor` convention).
- Design-system primitives (`Button`, `DataTable`, `AsyncStates`, form controls, notices, layouts)
  are extended only when a journey demonstrates the need — not spec-driven speculatively ahead of
  the block that needs them, except for the two SLF components (metric-card, GuestLinkUnavailable)
  built in Block 0 because two *different* later blocks each need one.
- The existing Core Expiration E2E suite (`expiration-vertical-slice.spec.ts`,
  `visual-regression.spec.ts`, `accessibility.spec.ts`) is the standing regression gate for the
  flagship slice specifically — it must stay green after every block, and is never edited to make
  a new screen's tests pass.

## 3. Testing tiers

The flagship precedent (A04/A05: 96 unit/component + 12 E2E for 4 screens) does not scale
mechanically to 24 more screens (would be several hundred tests of uneven value) — both blind
proposals converged on the same 3-tier structure independently.

### Tier 1 — Critical boundaries and complex mutations
A01, A02, A05-A07, A10, A12-A15, A19, G01, G02.

- Unit tests for mappings, validation, derived state, presentation-layer RBAC, retry policy.
- Component tests: happy path, every relevant error class, OCC conflict, idempotency/unknown
  outcome, the destructive-action path, keyboard/focus.
- 2-4 E2E per journey/block (not per screen): success, one meaningful recovery, one
  denial/security-boundary case.
- Guest screens (G01/G02) additionally require an explicit test proving every internal failure
  cause collapses to the same external state (anti-enumeration).
- A15 (Import) sits in this tier for its async-state/partial-success complexity even though its
  RBAC surface is lighter than the tier's other members — flagged explicitly so it isn't
  under-tested by tier-label pattern-matching alone.

### Tier 2 — Collections, administration, and RBAC/OCC-bearing configuration
A08/A09/A11, A16, A20/A21/A22, A23.

- ~4-8 component scenarios per screen, matched to real states named in its spec.
- At least one journey-level E2E per block, plus one more whenever the block includes a
  mutation/OCC/RBAC action of real consequence.
- Role-matrix coverage via parametrized tests, never a fully duplicated test per role.
- Density/pagination/filter/mobile behavior tested once on the shared primitive plus once on a
  representative screen; other screens only prove their own configuration of it.

### Tier 3 — Read-mostly or simple-preference screens
A03, A17, A18.

- 2-5 component scenarios per screen.
- E2E only when it completes a larger journey (e.g., A17 as the terminus of the dossier journey).
- A03 still requires its own visual/responsive test for the SLF-01 card pattern regression — "Tier
  3" does not mean skipping the shared visual-system check.

A04/A05 keep their existing suite unchanged. Visual/accessibility tests should grow by
**archetype** (collection, detail, form, dashboard, guest wizard) rather than by full combinatorial
coverage of all 25 screens.

## 4. Block-boundary Claude↔Codex review — what it checks

Run after every block (not once at the start, not per-screen), against the block's real diff and
its actual test execution, never a re-read of the spec alone:

1. Screen → Action → role conformance, including correct hide/disable and real backend
   authorization (not just UI-level gating).
2. Canonical `:orgId`-qualified routes, org-switch behavior, query-key scoping, no stale-org
   cache/data survives a switch.
3. Real BFF/backend contracts, OCC/idempotency headers, correct error-category mapping.
4. Every state named in the screen's audited spec is actually implemented — including empty,
   permission-limited, partial-success, conflict, and unknown-outcome.
5. Epistemic integrity: the UI never claims "created"/"delivered"/"approved"/"reviewed" without
   real evidence for it.
6. Cross-screen journey integrity: deep links, return-context, refresh/recovery, keyboard
   navigation between the block's screens and their named connections.
7. WCAG 2.2 AA, mobile parity, and density treatment appropriate to the screen's archetype.
8. Only approved design-system components/tokens used; motion and `prefers-reduced-motion`
   respected; no ad hoc one-off variant introduced.
9. New tests are non-tautological — proven to fail against pre-fix code, especially for RBAC and
   anti-enumeration findings (same experimental-verification discipline already used in
   `frontend-production-foundation.md` Rodada D).
10. Regression: previously-approved journeys/blocks still pass, and each closed item has its
    `DoD:` evidence line per `AGENTS.md` §1's Definition of Done discipline.

A defect that contaminates a shared foundation (Block 0's routing, the SLF-01/SLF-05 components,
AppShell nav model) blocks moving to the next block until fixed. A defect strictly local to one
screen in the block can be fixed and re-verified within the same review round without blocking the
next block's start.

## 5. Design-system-foundation sequencing decision

Not all up front, and not treated as one undifferentiated "foundation" bucket:

- **SLF-01 (metric-card pattern)** — build once, in Block 0, as a real component. A03 and A09 both
  need it (2 confirmed recurrences already named in the audit); building it once avoids two
  divergent implementations. Concrete application is still verified in Blocks 1 and 3.
- **SLF-05 (guest anti-enumeration component)** — build once, in Block 0, as a real
  `GuestLinkUnavailable` component; only *integrated and proven against all failure causes* later,
  in Blocks 6-7 (G02, then G01). Building it before either guest screen exists avoids the
  duplication risk the audit specifically flagged (G01/G02 each writing their own copy of the same
  spec text).
- **SLF-02 (motion) and SLF-03 (`:orgId` route pattern)** — process/checklist fixes, not new
  components (motion tokens already exist; `:orgId` is a naming convention). Fix the authoring
  template/checklist once in Block 0; SLF-03's real-code half (the actual routing migration) is
  Block 0's single largest item, not a checklist edit (see §0/§2).
- Rationale for not front-loading everything: only these two items are genuinely blocking (a
  screen in an early block cannot be built correctly without them); a full design-system-v2 pass
  up front would risk the classic "redesign before any real screen ships" trap this project has
  explicitly avoided elsewhere (`frontend-production-foundation.md` §28's deferred-visual-decisions
  discipline). Both SLF-01 and SLF-05 are single, small, real components — cheap enough to build
  first without that risk.

## 6. Evidence trail

Round-by-round record: `docs/architecture/reviews/frontend-implementation-sequencing-scoping/`
(`claude-round1-proposal.md`, `codex-round1-prompt.txt`, `codex-round1-output.txt`,
`reconciliation.md`). Decision log: `docs/architecture/decisions-log.md` D-253.
