# A21 — Requirement Templates — Screen Spec Audit Record

**Process note**: one BLIND Codex pass (batch 5/6, A18/A19/A20/A21 audited together in a single
prompt) + one Claude reconciliation round.

**Reconciliation**: Claude's own pre-Codex read and Codex's blind pass converged on the central
defect: the spec's header ("ADMIN+ para editar; leitura para outros papéis com acesso à tela") never
actually distinguishes the plan's **three** RBAC tiers for this screen — catalog administration
(ADMIN_ROLES), applying a template (WRITE_ROLES, one tier below catalog admin — so MEMBER can apply
but not edit the catalog), and browsing (READ_ONLY_ROLES, including VIEWER). Codex called the
missing apply/admin distinction Critical; the reconciled record keeps it Major, alongside a second,
independently-found defect Codex also flagged: the spec's own business rule that archived templates
"continuam... duplicáveis para referência histórica" for non-admins directly contradicts the plan's
listing of `duplicate` under the ADMIN_ROLES-only catalog-administration action group — an internal
contradiction within the spec itself, not just a gap. Both reads independently confirmed the
apply-preview step (distinguishing `NOVO` from `DUPLICATE_NAME` items) required by the plan is
missing entirely; the spec explicitly punts Subject selection out of scope, which is fine, but that
does not excuse omitting the preview step itself. Codex's numeric figures are adopted with no
adjustment.

---

Screen: A21 — Requirement Templates / "Templates de requisitos"
Route: `/settings/requirement-templates` (spec, pre-revision) — canonical plan routes:
`/app/:orgId/settings/requirement-templates`, `/.../requirement-templates/:templateId` (absent
pre-revision).
Primary task: browse/administer reusable requirement-checklist templates and apply one to a Subject.
Spec version/date: undated, audited 2026-09-10.

Functional score (applicable-only, renormalized): 28/100
Visual specification score: 38/100
Consolidated score: 32/100
Gate result: **NOT PASS** — RBAC tiering collapses two distinct roles into one ambiguous statement;
the apply-preview flow required by the plan is entirely absent; state/responsive coverage both
below 60% of their available points.

Visual confidence: HIGH
Classification: SPEC AUDIT — rendered excellence not yet verified (rubric §0).

Perceptual reading order (as described or inferred):
1. Template catalog (name, status, item count).
2. Selected template's item checklist.
3. Action bar (edit/duplicate/archive vs. apply).

D-247 axes (axis 6 marked N/A — no distinct guest-facing UI; 92 applicable points, renormalized):
1. Backend-to-interface completeness and traceability — 8/18 (catalog/items/duplicate/archive/apply
   concepts present; version, notes, applicability, and stable item IDs absent).
2. Journey, navigation, and screen-graph coherence — 4/14 (in-page selection is clear; no
   `:templateId` route, no A09/A11 preview/return-flow detail).
3. RBAC-aware visibility and action model — 5/14 (read access acknowledged only vaguely; the
   catalog-admin vs. apply tier distinction — a plan-required three-tier model — is entirely
   collapsed into "ADMIN+ para editar; leitura para outros"; the spec's own archived-template rule
   contradicts the plan's ADMIN-only duplicate action).
4. State, feedback, and recovery coverage — 2/14 (Active/Archived shown; invalid/empty template,
   name collision, apply-preview `DUPLICATE_NAME` distinction, and partial-application conflict all
   absent).
5. Multi-tenant organization context and isolation UX — 3/10 (Subject-application concept named;
   route omits `:orgId`).
6. Guest/authenticated surface separation — N/A.
7. Responsive, mobile, and accessibility planning — 0/12 (no mobile parity, no non-drag reorder
   alternative for items).
8. Zero-context handoff quality and internal consistency — 4/10 (the basic layout is implementable,
   but the RBAC tiering and the core apply flow are materially ambiguous/contradictory).

V1 Hierarchy/composition:        11/20  (evidence level 2 — HIGH)
V2 Typography/data legibility:   5/13   (evidence level 1 — HIGH)
V3 Rhythm/alignment/density:     7/14   (evidence level 2 — HIGH)
V4 Color/surface/depth:          3/11   (evidence level 1 — HIGH)
V5 Component/state craft:        6/12   (evidence level 2 — HIGH)
V6 Motion/continuity:            0/9    (evidence level 0 — HIGH)
V7 Product authorship:           4/17   (evidence level 1 — HIGH)  (counterfactual test: **fails** —
  replacing template/requirement/fornecedor nouns yields a generic master-detail CRUD catalog; capped
  at 8/17, actual craft scores below the cap anyway.)
V8 Coherence/auditability:       2/4    (evidence level 1 — HIGH)

Findings:
- Major: RBAC tiering collapses the plan's three distinct tiers (catalog-admin ADMIN_ROLES / apply
  WRITE_ROLES / browse READ_ONLY_ROLES) into one ambiguous line — never establishes that MEMBER can
  apply a template while being unable to edit the catalog.
- Major: mutation controls (Editar/Duplicar/Arquivar/Reativar) have no stated role-conditioned
  visibility separate from the browsing surface.
- Major: internal contradiction — the spec's own rule that non-admins may duplicate an archived
  template "para referência histórica" contradicts the plan's ADMIN_ROLES-only `duplicate` action.
- Major: the required apply-preview step (distinguishing `NOVO` from `DUPLICATE_NAME` items) is
  entirely absent — the spec defers Subject selection out of scope (acceptable) but also omits the
  preview step itself (not acceptable, it is plan-required regardless of where selection happens).
- Major: no partial-application-conflict recovery behavior.
- Major: invalid/empty template and name-collision states absent.
- Major: item data omits stable id, notes, applicability, and version.
- Moderate — SLF-03: route omits `/app/:orgId`; `:templateId` detail route absent.
- Moderate: no responsive/mobile plan and no non-drag reorder alternative for checklist items.
- Moderate — SLF-04: "Arquivar"/"Reativar" used the nonexistent `tertiary` variant.

Design-system dispositions:
- SPEC GAP: RBAC three-tier split, apply-preview flow, partial-conflict recovery, missing item data,
  `:orgId`/detail routes, responsive/keyboard reorder, motion decision, `tertiary`→`ghost`
  correction, internal archived-duplicate contradiction.
- SYSTEM GAP: none newly identified beyond SLF-02/03/04 (all confirmed recurring here too).
- SYSTEM CONSTRAINT: none.
- JUSTIFIED EXCEPTION: none.
- SYSTEM EVOLUTION CANDIDATE: none new — the catalog-over-detail selection pattern (name-as-button
  updating a lower detail panel without page navigation) is a reasonable local pattern; worth
  revisiting as a shared pattern only if a future screen needs the identical shape.

Evidence excerpts (file:line, pre-revision spec):
- `A21-templates-requisitos.md:4` (pre-revision) — "ADMIN+ para editar; leitura para outros papéis
  com acesso à tela" — collapses the plan's three RBAC tiers into one ambiguous statement.
- `A21-templates-requisitos.md:33` (pre-revision) — "Aplicar a fornecedor" business rule, entirely
  missing the required preview step.
- `A21-templates-requisitos.md:34` (pre-revision) — archived-duplicate rule contradicting the plan's
  ADMIN_ROLES-only `duplicate` action.
- `docs/frontend/p0-screen-inventory-plan.md:525-539` — full A21 plan entry.

Required revision: **applied to `A21-templates-requisitos.md` in this batch**. Summary:
- Explicit three-tier RBAC: READ_ONLY_ROLES browse, WRITE_ROLES (excludes VIEWER) apply,
  ADMIN_ROLES administer the catalog (including duplicating an archived template — the prior
  non-admin exception removed as a direct contradiction of the plan).
- Added the apply-preview step (`NOVO`/`DUPLICATE_NAME` per item, disabled confirm when nothing is
  new) and a partial-application-conflict recovery path ("tentar novamente apenas os pendentes").
- Added invalid/empty-template and name-collision states.
- Added item data (notes, applicability, version) and button/keyboard reordering.
- Added `:orgId`-qualified routes (including a `:templateId` deep link), mobile reflow, and a motion
  decision.
- Corrected `tertiary` to `ghost` for Arquivar/Reativar with rationale stated.

Rendered-review checks to defer to the later gate:
- Whether the apply-preview list (potentially many items, mixed NOVO/DUPLICATE_NAME) stays scannable
  once rendered with a realistic template size.
- Whether the two-zone action bar's role-conditional zones (admin-only left, WRITE_ROLES-only right)
  read as intentional rather than inconsistent once actually styled per role.
