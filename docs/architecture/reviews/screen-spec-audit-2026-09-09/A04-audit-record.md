# A04 — Expiration Collection — Screen Spec Audit Record

**Process note**: one BLIND Codex pass + one Claude reconciliation round (D-249/D-250-style scope
reduction, named explicitly per session brief).

**Reconciliation**: Claude's independent read agreed with Codex's verdict — the lowest-scoring
screen of this batch, NOT PASS by the widest margin — and the same primary cause: the spec covers
only a fraction of A04's real capability surface named in `p0-screen-inventory-plan.md` (update,
delete, export, watch, search, priority, tags are all missing; RBAC is stated only for create/
import, omitting delete/export/watch tiers entirely). Claude's own draft scores (Functional
~24/82≈29, Visual ~28/100) were slightly more severe than Codex's on the functional side (Claude
weighted the missing bulk/RBAC/state coverage more heavily, since axis 1's traceability criterion
is worth 18 of 100 applicable points and this screen is missing roughly half its named actions).
Given Codex's score is already the lowest of the batch and the substantive findings are identical,
this record adopts Codex's numbers with one adjustment: Functional axis 1 is lowered slightly
(7→6/18) to reflect that more than half of A04's seven named `item:*` actions in the plan
(`create/read/update/delete/export/watch`, plus import) have no corresponding UI surface at all in
this spec, not just incomplete detail — a materially larger gap than a routine deduction.

---

Screen: A04 — Vencimentos (lista)
Route: `/expirations` (spec) — canonical plan route: `/app/:orgId/expirations` (SLF-03)
Primary task: find, filter, and operate on tenant-wide `ExpirationItem` records by temporal status.
Spec version/date: undated, audited 2026-09-09. Per `p0-screen-inventory-plan.md` §10, A04/A05
already exist in production-quality form in the real frontend codebase — this record audits the
prototype spec's own written quality regardless of that fact, per the task brief.

Functional score (applicable-only, renormalized): 33.0/100
Visual specification score: 32/100
Consolidated score: 32.6/100
Gate result: **NOT PASS** — every gate floor fails; single-axis 60% floor fails on 6 of 8 visual
axes and on 3 of 5 applicable functional axes; unresolved Major (S3-equivalent) findings on
capability/RBAC/state coverage.

Visual confidence: HIGH
Classification: SPEC AUDIT — rendered excellence not yet verified (rubric §0).

Perceptual reading order (as described or inferred):
1. Page title, description, and creation/import actions.
2. Record count and status filters.
3. Compact table led by item identity, then responsibility, date, and urgency.

D-247 axes (applicable / shared-system-level / N/A marked per criterion): 27/82 → normalized 33.0/100
1. Backend-to-interface completeness and traceability — APPLICABLE: 6/18 (only create/import/read
   have any UI surface; update/delete/export/watch and the priority/tags fields are entirely
   unaddressed)
2. Journey, navigation, and screen-graph coherence — APPLICABLE: 8/14
3. RBAC-aware visibility and action model — APPLICABLE: 7/14 (covers only VIEWER vs. MEMBER+ for
   create/import; omits ADMIN-tier delete/export entirely)
4. State, feedback, and recovery coverage — APPLICABLE: 2/14
5. Multi-tenant organization context and isolation UX — SHARED-SYSTEM-LEVEL (AppShell org-switch
   contract applies; local route nevertheless contradicts the canonical org-scoped route, SLF-03)
6. Guest/authenticated surface separation — NOT APPLICABLE
7. Responsive, mobile, and accessibility planning — APPLICABLE: 1/12
8. Zero-context handoff quality and internal consistency — APPLICABLE: 3/10

V1 Hierarchy/composition:        8/20   (evidence level 2 — HIGH)
V2 Typography/data legibility:   5/13   (evidence level 2 — HIGH)
V3 Rhythm/alignment/density:     5/14   (evidence level 2 — HIGH)
V4 Color/surface/depth:          4/11   (evidence level 2 — HIGH)
V5 Component/state craft:        3/12   (evidence level 1 — HIGH)
V6 Motion/continuity:            0/9    (evidence level 0 — HIGH)
V7 Product authorship:           6/17   (evidence level 1 — HIGH)  (counterfactual test: **FAIL**
  — replacing "Vencimento"/"Responsável"/urgency nouns with "Item"/"Owner"/"Status" leaves a
  generic filterable admin-CRUD table; capped at 8/17.)
V8 Coherence/auditability:       1/4    (evidence level 1 — HIGH)

Findings:
- Major: `item:update`, `item:delete`, `item:export`, `item:watch`, search, priority, and tags are
  named in the plan's A04 entry but have no UI surface at all in this spec; bulk-action
  partial-success reporting and export-truncation are unaddressed.
- Major: RBAC coverage names only the create/import boundary (VIEWER vs. MEMBER+); the plan's
  ADMIN-tier delete/export distinction is entirely absent, risking an implementer inventing the
  wrong tier.
- Major: no loading/`EMPTY_TRUE`/`EMPTY_FILTERED`/failure/retry/unavailable/success/recovery state
  is specified anywhere.
- Major: the plan's required desktop-table-to-mobile-selectable-cards transformation, bulk-selection
  flow, and sticky bulk toolbar are entirely unaddressed (this screen's own responsive section says
  only "table on desktop, selectable cards on mobile" as a one-line aspiration with zero detail).
- Moderate: no task-led temporal-risk composition beyond a status filter and colored indicator; no
  typography roles, tabular-date treatment, alignment anchors, or density-stress behavior.
- Moderate: filter changes have no stated loading/continuity, focus-restoration, or reduced-motion
  behavior.
- Minor: `tertiary` is not an approved Button variant (SLF-04); the page title is duplicated between
  `PageHeader` and the panel header with no explained hierarchy; "client-side (or query param)"
  leaves persistence/deep-linking/back-navigation unresolved.

Design-system dispositions:
- SPEC GAP: apply existing Table/DataTable empty/loading/responsive-state rules, WCAG keyboard/
  focus/reflow/target-size/non-color-only requirements, typography and local-date guidance, and
  motion/reduced-motion tokens; replace `tertiary` with `ghost` (SLF-04).
- SYSTEM GAP: no reusable temporal-risk collection pattern exists that shapes hierarchy/scanning for
  overdue vs. near-due work beyond ordinary status filters and semantic colors — recorded here as
  screen-specific for now; watch for recurrence across A08/A11 (similar collection screens) in a
  later batch before promoting to `system-level-findings.md`.
- SYSTEM CONSTRAINT: none identified.
- JUSTIFIED EXCEPTION: none.
- SYSTEM EVOLUTION CANDIDATE: none yet — the spec must first author and validate a temporal-risk-
  first composition before proposing it as reusable.

Evidence excerpts (file:line):
- `docs/frontend/prototype-screen-specs/A04-vencimentos.md:3` — route `/expirations`, contradicts
  the canonical tenant-scoped route (SLF-03).
- `docs/frontend/prototype-screen-specs/A04-vencimentos.md:9` — header names only import/create
  actions, using the undefined `tertiary` variant.
- `docs/frontend/prototype-screen-specs/A04-vencimentos.md:16` — table anatomy omits search,
  selection, bulk operations, priority, tags, sorting, and pagination.
- `docs/frontend/prototype-screen-specs/A04-vencimentos.md:40` — RBAC section covers only
  VIEWER/MEMBER+ for creation/import.
- `docs/frontend/p0-screen-inventory-plan.md:194-207` (A04 entry) — full action/state/responsive
  requirements, most of which are absent from the spec.

Required revision: **applied to `A04-vencimentos.md` in this batch** — see the spec's revision
history note. Summary:
- Reconciled the route to `/app/:orgId/expirations`.
- Restored the full capability/RBAC surface (update/delete/export/watch, priority, tags) with
  correct role tiers per the plan.
- Specified loading/`EMPTY_TRUE`/`EMPTY_FILTERED`/failure/retry/export-unavailable/bulk-partial-
  success states.
- Authored a temporal-risk-first composition (see the revised spec's ordering/grouping notes)
  distinguishing this from a generic filterable admin table.
- Defined the mobile card transformation concretely (fields shown, order, disclosure) instead of
  the one-line aspiration.
- Added an explicit motion/continuity decision and replaced `tertiary` with `ghost`.

Rendered-review checks to defer to the later gate:
- Actual scanning speed and whether overdue/near-due rows draw attention without the whole screen
  feeling alarming.
- Typography, tabular-date alignment, long PT-BR names, and touch targets with real, dense data.
- Sticky-toolbar obstruction and 320px card reflow in the browser.
