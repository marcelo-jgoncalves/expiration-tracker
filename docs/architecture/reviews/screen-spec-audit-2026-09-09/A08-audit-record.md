# A08 — Subject Collection ("Fornecedores") — Screen Spec Audit Record

**Process note**: one BLIND Codex pass (`codex exec --skip-git-repo-check`,
`codex-out-A08.txt`) + one Claude reconciliation round.

**Reconciliation**: Claude's independent read agreed with Codex — this is the lowest-scoring screen
of the batch, for the same structural reason A04 was the lowest scorer in batch 1: a filterable
collection screen with no search, no edit/delete surface, no RBAC granularity beyond
create-visibility, and a type-column that contradicts the backend's actual enum with unmapped
free-text business categories. Claude's own draft scores (Functional ~28/100, Visual ~28/100) were
close to Codex's (26/100, 30/100); this record adopts Codex's figures as reconciled.

---

Screen: A08 — Fornecedores (Subject Collection)
Route: `/subjects` (spec, pre-revision) — canonical plan route: `/app/:orgId/subjects`
Primary task: search, filter, and operate on tenant-wide `TrackedSubject` rows, then navigate to a
Subject Hub.
Spec version/date: undated, audited 2026-09-09.

Functional score (applicable-only, renormalized): 26.0/100
Visual specification score: 30.0/100
Consolidated score: 27.6/100
Gate result: **NOT PASS** — the lowest-scoring screen in this batch; all three floors fail by a wide
margin; 7 of 8 applicable functional axes and all 8 visual axes below 60%; unresolved Critical
tenant-routing and CRUD-surface findings.

Visual confidence: HIGH
Classification: SPEC AUDIT — rendered excellence not yet verified (rubric §0).

Perceptual reading order (as described or inferred):
1. Page title/description, "Novo fornecedor" action.
2. Active/Archived filter with counts.
3. Compact table: name+identifier, type, assignee, requirement count, pending badge.

D-247 axes (applicable / shared-system-level / N/A marked per criterion): 24/92 → normalized 26.0/100
1. Backend-to-interface completeness and traceability — APPLICABLE: 4/18 (no search despite being a
   named primary purpose; contact and tags fields entirely absent; the "Tipo" column's example values
   are free-text business categories with no mapping to the plan's actual enum
   COMPANY/VENDOR/CLIENT/EMPLOYEE/ASSET/LOCATION/CUSTOM)
2. Journey, navigation, and screen-graph coherence — APPLICABLE: 5/14 (create described only as "a
   link," not a defined creation journey; Dashboard/Requirements filtered-entry behavior unaddressed)
3. RBAC-aware visibility and action model — APPLICABLE: 6/14 (only create-visibility stated; no
   update surface at all, no ADMIN_ROLES-only delete model)
4. State, feedback, and recovery coverage — APPLICABLE: 1/14 (only Active/Archived filtering and a
   pending/no-pending cell exist; EMPTY_TRUE, loading, failure, no-search-results, duplicate-
   identifier, DELETED, and delete-blocked-by-business-rule are all absent)
5. Multi-tenant organization context and isolation UX — APPLICABLE: 0/10 (`:orgId` entirely absent)
6. Guest/authenticated surface separation — SHARED-SYSTEM-LEVEL (authenticated-only screen)
7. Responsive, mobile, and accessibility planning — APPLICABLE: 2/12 (only the FilterGroup's
   `overflow-x:auto` is stated; the plan's required table→cards transformation has zero detail —
   this file has no responsive section at all)
8. Zero-context handoff quality and internal consistency — APPLICABLE: 6/10 (structure and sample
   data are implementable in isolation, but the wrong route, unmapped enum, and missing
   interaction/state contracts block a genuinely zero-context build)

V1 Hierarchy/composition:        7/20   (evidence level 2 — HIGH)
V2 Typography/data legibility:   5/13   (evidence level 2 — HIGH)
V3 Rhythm/alignment/density:     5/14   (evidence level 2 — HIGH)
V4 Color/surface/depth:          3/11   (evidence level 1 — HIGH)
V5 Component/state craft:        3/12   (evidence level 1 — HIGH)
V6 Motion/continuity:            0/9    (evidence level 0 — HIGH)
V7 Product authorship:           6/17   (evidence level 1 — HIGH)  (counterfactual test: **FAIL** —
  replacing "Fornecedor"/"Responsável"/"Pendências" with "Item"/"Owner"/"Status" leaves a generic
  filterable admin table, structurally identical to A04's; capped at 8/17, scored 6.)
V8 Coherence/auditability:       1/4    (evidence level 1 — HIGH)

Findings:
- Critical: route omits `/app/:orgId`, contradicting the tenant-isolation contract.
- Critical: no update or delete surface exists at all despite both being named actions in the plan
  (`subject:update`=WRITE_ROLES, `subject:delete`=ADMIN_ROLES) — only creation visibility is
  addressed by the RBAC section.
- Major: no search, despite locating a specific vendor/client by name or CNPJ being this screen's
  primary real-world task at scale.
- Major: the "Tipo" column's example values ("Prestador de serviço", "Seguradora", "Locador",
  "Fornecedor de energia") are free text with no stated mapping to the plan's actual enum
  (COMPANY/VENDOR/CLIENT/EMPLOYEE/ASSET/LOCATION/CUSTOM) — an implementer cannot tell whether these
  are the real enum values or illustrative business labels.
- Major: no EMPTY_TRUE, no-search-results, duplicate-external-identifier, or delete-blocked-by-
  business-rule states, all named in the plan.
- Major: tags field (named in the plan's A08 data model) is entirely absent from the table.
- Major: no table→cards responsive transformation specified at all — the file has no responsive
  section, despite the plan requiring every table-shaped collection to transform on narrow viewports.
- Moderate: contact field (named in the plan) is entirely absent.
- Minor: "Tudo vinculado" describes linkage rather than clearly stating zero pending requirements.

Design-system dispositions:
- SPEC GAP: search, full CRUD surface with correct RBAC tiers, tenant-scoped route, EMPTY_TRUE/
  duplicate/delete-blocked states, tags/contact fields, mobile card transformation, enum mapping,
  motion.
- SYSTEM GAP: none — the shared FilterGroup, Button variants, StatusBadge, and responsive-collection
  conventions already exist; this is authoring, not system, coverage.
- SYSTEM CONSTRAINT: none beyond the already-tracked SLF-01 hypothesis (not directly instantiated
  here — this screen's failure mode is missing coverage, not a flat-metric-grid pattern).
- JUSTIFIED EXCEPTION: none.
- SYSTEM EVOLUTION CANDIDATE: a reusable "risk/pending-prioritized collection" pattern combining
  desktop table + mobile cards + permission-aware row actions + pending-first default sort would
  generalize across A04/A08/A11 (all filterable operational collections) — noted as a candidate for a
  later batch to confirm before promoting to `system-level-findings.md`.

Evidence excerpts (file:line, pre-revision spec):
- `docs/frontend/prototype-screen-specs/A08-fornecedores.md:3` (pre-revision) — route `/subjects`,
  no `:orgId` (SLF-03 cross-ref).
- `docs/frontend/prototype-screen-specs/A08-fornecedores.md:9-16` (pre-revision) — no search, no
  edit/delete affordance, "Tipo" column with unmapped free-text values.
- `docs/frontend/prototype-screen-specs/A08-fornecedores.md:18-26` (pre-revision) — example data
  entirely ACTIVE/ARCHIVED, no DELETED or duplicate-identifier illustration.
- `docs/frontend/p0-screen-inventory-plan.md:256-266` (A08 entry) — full data model, actions, and
  states, most absent from the pre-revision spec.

Required revision: **applied to `A08-fornecedores.md` in this batch** — see the spec's revision
history note. Summary:
- Reconciled the route to `/app/:orgId/subjects`.
- Added search (name/identifier, debounced), an explicit edit/archive/delete row-action menu with
  correct RBAC tiers (delete ADMIN_ROLES-only), tags and contact-adjacent fields, and enum-to-label
  mapping for "Tipo" with the business category demoted to a subtitle.
- Named EMPTY_TRUE, EMPTY_FILTERED, loading/failure, duplicate-identifier, and delete-blocked-by-
  business-rule states concretely.
- Specified the table→cards mobile transformation with field priority order.
- Authored a pending-first default sort (product-specific authorship fix for V7) instead of a flat
  alphabetical/status-only ordering.
- Named a concrete motion decision (no per-row reorder animation, by design, for a high-frequency
  operational list) with rationale, satisfying V6's "explicit no-motion" credit path.

Rendered-review checks to defer to the later gate:
- Whether pending-first default sort actually reads as helpful once real data volume is rendered, or
  whether it disorients users expecting alphabetical order.
- Card layout density and touch-target spacing at 320px with long PT-BR company names and CNPJs.
