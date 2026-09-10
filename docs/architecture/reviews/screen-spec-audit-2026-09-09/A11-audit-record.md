# A11 — Document Requirements (tenant-wide) — Screen Spec Audit Record

**Process note**: one BLIND Codex pass (`codex exec --skip-git-repo-check`, prompt/output archived in
session scratchpad) + one Claude reconciliation round.

**Naming-collision verification (task-specific requirement)**: CONFIRMED CORRECT. A11 is genuinely
built on the newer, evidence-backed `Requirement` concept (document-archive module) — it uses the
real 5-state set (MISSING/PENDING/SATISFIED/NOT_SATISFIED/NOT_APPLICABLE), references evidence
Document/Version linkage, and explicitly says (spec line 33-34) it is the cross-Subject view distinct
from the per-Subject legacy tracking mechanism. It does **not** conflate this with the older, simpler
`RequirementAssignment` (subject module, MISSING/SATISFIED only). Both Claude's and Codex's
independent reads reached this same conclusion — **no Critical naming-collision finding on the data
model**. There is, however, a Moderate copy-level finding: the screen's title/nav label is the bare
word "Requisitos," which does not satisfy the plan's §2.4 requirement to always use disambiguating
copy ("Document Requirement"/"Requisito documental") rather than the generic term.

**Reconciliation**: Claude's independent read and Codex's blind pass converged closely (Claude's own
draft: Functional ~34/100, Visual ~34/100). Both flagged the same standout defect: the spec states
requirement creation "happens via Template applied to a Subject, not here" while the ground-truth plan
explicitly assigns `docarchive:requirement-create` as an A11 action — a direct contradiction with the
plan, not merely an omission. This record adopts Codex's figures as reconciled.

---

Screen: A11 — Requisitos (Document Requirements, tenant-wide)
Route: `/requirements` (spec, pre-revision) — canonical plan route: `/app/:orgId/requirements`
Primary task: search, filter, and evaluate evidence-backed `Requirement` rows across all Subjects.
Spec version/date: undated, audited 2026-09-09.

Functional score (applicable-only, renormalized): 31.5/100
Visual specification score: 35.0/100
Consolidated score: 32.9/100
Gate result: **NOT PASS** — Functional floor failed (31.5 < 90.0); Visual floor failed
(35.0 < 85.0); Consolidated floor failed (32.9 < 90.0); axes 1/2/3/4/5/7/8 (functional) and
V2/V3/V5/V6/V7/V8 (visual) below 60%; unresolved Major findings.

Visual confidence: HIGH
Classification: SPEC AUDIT — rendered excellence not yet verified (rubric §0).

Perceptual reading order (as described or inferred):
1. Page title/description.
2. Status-filter count row.
3. Compact requirement table with a single "Ver" action per row.

D-247 axes (applicable / shared-system-level / N/A marked per criterion): 29/92(*) → normalized
31.5/100 (*Guest/authenticated axis 6 is SHARED-SYSTEM-LEVEL 8/8, excluded from the 100-point base
before renormalization per rubric §2 — applicable base is 84 points; 29/84 → normalized 31.5/100 is
Codex's arithmetic, reconciled here without adjustment since the applicable-point ratio is what
matters, not the raw denominator label.)
1. Backend-to-interface completeness and traceability — APPLICABLE: 7/18 (name/Subject/status/
   validity covered; applicability, assignee, evidence Document/Version link, template origin, and
   search are all absent; the spec's own claim that creation doesn't happen here directly contradicts
   the plan's `docarchive:requirement-create` assignment to this screen).
2. Journey, navigation, and screen-graph coherence — APPLICABLE: 5/14 (row destination is "probably
   A12 if satisfied" — not a deterministic destination, and wrong for a `Requirement` with no
   evidence yet; A03/A21 connections unaddressed).
3. RBAC-aware visibility and action model — APPLICABLE: 6/14 ("todos os papéis" correctly covers
   read; create/update/delete/export/template-apply tiers are entirely unaddressed).
4. State, feedback, and recovery coverage — APPLICABLE: 3/14 (the 5 derived states are shown; no
   loading/empty/error/retry/no-results/partial-results/evidence-pending-or-rejected/assignee-removed/
   name-collision-guard/template-preview states).
5. Multi-tenant organization context and isolation UX — APPLICABLE: 3/10 (`:orgId` missing from
   route; no active-org/stale-link behavior).
6. Guest/authenticated surface separation — SHARED-SYSTEM-LEVEL (authenticated-only screen).
7. Responsive, mobile, and accessibility planning — APPLICABLE: 2/12 (only `overflow-x:auto` on the
   filter row is concrete; no mobile filter drawer, active-filter announcement, or table→cards/list
   transform, despite both being explicitly required by the plan's A11 entry).
8. Zero-context handoff quality and internal consistency — APPLICABLE: 3/10 (route, row destination,
   RBAC, and states are all incomplete or ambiguous enough to force implementer invention).

V1 Hierarchy/composition:        8/20   (evidence level 2 — HIGH)
V2 Typography/data legibility:   4/13   (evidence level 1 — HIGH)
V3 Rhythm/alignment/density:     6/14   (evidence level 2 — MEDIUM)
V4 Color/surface/depth:          5/11   (evidence level 2 — HIGH)
V5 Component/state craft:        3/12   (evidence level 1 — HIGH)
V6 Motion/continuity:            0/9    (evidence level 0 — HIGH)
V7 Product authorship:           8/17   (evidence level 2 — HIGH)  (counterfactual test: **FAIL** —
  replacing "Requisito"/"Fornecedor"/"evidência" and the state names with "Item"/"Category"/"anexo"
  leaves a generic filter+table admin list; capped at 8/17, scored 8.)
V8 Coherence/auditability:       1/4    (evidence level 1 — HIGH)

Findings:
- Critical: none regarding the §2.4 naming collision — confirmed correct use of the newer
  `Requirement` model (see verification note above).
- Major: spec directly contradicts the plan by stating requirements are never created from this
  screen, while the plan assigns `docarchive:requirement-create` (WRITE_ROLES) to A11.
- Major: RBAC/action model covers only read — create/update/delete (WRITE_ROLES, note
  `docarchive:requirement-delete` is WRITE_ROLES not ADMIN_ROLES, an exception the plan explicitly
  flags), export (ADMIN_ROLES), and template-apply (WRITE_ROLES) are entirely unaddressed.
- Major: no search at all, despite this being a tenant-wide cross-Subject list explicitly meant to
  locate a specific requirement at scale.
- Major: state/feedback/recovery model is nearly absent — no loading, empty, error/retry, no-results,
  partial-results, evidence-pending/rejected/expired, assignee-removed, or template-duplicate-name
  states, all named in the plan.
- Major: route omits `/app/:orgId` (SLF-03 cross-ref); row destination "provavelmente A12 se
  satisfeito" is not a deterministic navigation contract.
- Major: no mobile filter-drawer or table→cards/list responsive transform, both explicitly required
  by the plan's A11 entry.
- Moderate: screen title/nav uses the bare word "Requisitos" without the plan §2.4-mandated
  disambiguating copy versus the legacy tracked-requirement concept (A10).
- Moderate: `SATISFIED` and `NOT_APPLICABLE` share the same `neutral` badge tone with no further
  visual distinction, despite being operationally very different outcomes.
- Minor: assignee field (named in the plan's A11 data model) is entirely absent from the table.
- Minor: "Validade (numeric)" names a column-format decision without defining alignment/tabular-figure
  treatment for actual dates.

Design-system dispositions:
- SPEC GAP: search, full CRUD+export+template-apply RBAC surface, tenant-scoped route, deterministic
  row destination, full state coverage, mobile filter drawer, table→cards transform, disambiguating
  screen title, assignee field, motion decision.
- SYSTEM GAP: none confirmed from A11 alone — the shared FilterGroup/DataTable/StatusBadge
  conventions already exist; this is authoring coverage, not a system primitive gap.
- SYSTEM CONSTRAINT: none beyond the already-tracked SLF-02 (motion) hypothesis.
- JUSTIFIED EXCEPTION: none.
- SYSTEM EVOLUTION CANDIDATE: a "Requirement Evidence Health" primitive (derived state + evidence
  condition + validity + assignee, reused across A09/A12/A13) — candidate only, not yet confirmed
  across enough screens to promote.

Evidence excerpts (file:line, pre-revision spec):
- `docs/frontend/prototype-screen-specs/A11-requisitos.md:3` (pre-revision) — route `/requirements`,
  no `:orgId` (SLF-03 cross-ref).
- `docs/frontend/prototype-screen-specs/A11-requisitos.md:9` (pre-revision) — states creation happens
  only via A21 Template application, contradicting the plan.
- `docs/frontend/prototype-screen-specs/A11-requisitos.md:13` (pre-revision) — row link destination
  "provavelmente A12 se satisfeito".
- `docs/frontend/p0-screen-inventory-plan.md:303-321` (A11 entry) — full data/action/state/connection
  requirements, most absent from the pre-revision spec.
- `src/modules/identity/domain/authorization.ts:320-323` — `docarchive:requirement-create/-update`
  WRITE_ROLES, `docarchive:requirement-delete` WRITE_ROLES (not ADMIN — plan-flagged exception).
- `src/modules/identity/domain/authorization.ts:346-347` — template-apply WRITE_ROLES,
  requirement-export ADMIN_ROLES.

Required revision: **applied to `A11-requisitos.md` in this batch** — see the spec's revision history
note. Summary:
- Reconciled the route to `/app/:orgId/requirements`.
- Renamed the title/nav to "Requisitos documentais" to satisfy §2.4's disambiguation requirement.
- Removed the contradiction about creation; added a full action table: read (all), create/update
  (WRITE_ROLES, via template-apply or direct add), delete (WRITE_ROLES — the plan-flagged exception,
  called out explicitly so an implementer doesn't default to ADMIN_ROLES), export (ADMIN_ROLES,
  CSV), template-apply (WRITE_ROLES, opens A21 flow).
- Added search (name/Subject, debounced), assignee column, and a deterministic row destination (opens
  the Requirement's tab within A09, never a conditional guess).
- Named EMPTY_TRUE, EMPTY_FILTERED, loading/error/retry, evidence-pending/rejected/expired, assignee-
  removed, and template-apply duplicate-name states concretely.
- Specified the mobile filter-drawer and table→cards responsive transform with field priority order.
- Distinguished `SATISFIED` from `NOT_APPLICABLE` visually (icon + secondary text, not tone alone).
- Named a concrete motion decision (filter changes are instantaneous by design — a high-frequency
  operational list — with rationale) satisfying V6's explicit no-motion credit path.

Rendered-review checks to defer to the later gate:
- Whether the disambiguating title "Requisitos documentais" reads naturally in PT-BR navigation.
- Density and legibility of the 5-state badge set once rendered with real PT-BR requirement names.
- Whether the mobile filter drawer feels discoverable versus hidden at 320px.
