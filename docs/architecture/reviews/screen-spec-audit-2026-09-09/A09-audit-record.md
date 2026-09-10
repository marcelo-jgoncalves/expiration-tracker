# A09 — Subject Hub — Screen Spec Audit Record

**Process note**: one BLIND Codex pass (`codex exec --skip-git-repo-check`, prompt/output archived in
session scratchpad) + one Claude reconciliation round.

**Reconciliation**: Claude's independent read (route missing `:orgId`, no `subject:delete` surface,
no RBAC beyond dossier export, flat four-card link grid with no severity weighting, missing
loading/error/archived-Subject/removed-linked-resource states) matched Codex's blind findings almost
exactly. Codex additionally caught a real naming-collision-adjacent defect Claude had only partially
flagged: the card labeled simply "Requisitos" sits beside "Rastreamento legado" without the
plan's §2.4-mandated disambiguating copy ("Requisito documental" vs. "Requisito acompanhado") — this
is a Moderate copy finding, not the Critical §2.4 conflation itself (the underlying data model is not
conflated, only the label). This record adopts Codex's figures as reconciled (close to Claude's own
draft: Functional ~38/100, Visual ~35/100).

---

Screen: A09 — Subject Hub (Hub do fornecedor)
Route: `/subjects/:id` (spec, pre-revision) — canonical plan route: `/app/:orgId/subjects/:subjectId`
Primary task: understand one Subject's compliance standing and navigate to its Requirements,
Documents, legacy tracking, requests, and dossier export.
Spec version/date: undated, audited 2026-09-09.

Functional score (applicable-only, renormalized): 40.2/100
Visual specification score: 36.0/100
Consolidated score: 38.5/100
Gate result: **NOT PASS** — Functional floor failed (40.2 < 90.0); Visual floor failed
(36.0 < 85.0); Consolidated floor failed (38.5 < 90.0); axes 4/5/7/8 (functional) and V4/V5/V6/V8
(visual) below 60%; unresolved Major findings.

Visual confidence: HIGH
Classification: SPEC AUDIT — rendered excellence not yet verified (rubric §0).

Perceptual reading order (as described or inferred):
1. Subject identity + Edit/Export actions in the `PageHeader`.
2. Compliance percent, fraction, and 3-item breakdown.
3. Four equal-weight link cards (Requirements, Documents, legacy tracking, Requests).

D-247 axes (applicable / shared-system-level / N/A marked per criterion): 37/92 → normalized 40.2/100
1. Backend-to-interface completeness and traceability — APPLICABLE: 12/18 (compliance figures and
   the four resource families are covered; `subject:update`/`subject:delete` have no stated
   authorization; no removed-linked-resource behavior).
2. Journey, navigation, and screen-graph coherence — APPLICABLE: 8/14 ("Documentos" and "Rastreamento
   legado" destinations lack a concrete route/shape; A10's own spec doesn't exist yet in the package).
3. RBAC-aware visibility and action model — APPLICABLE: 7/14 (dossier export's OWNER/ADMIN gate is
   correct; "Editar fornecedor" is shown with no role gate at all; `subject:delete` — ADMIN_ROLES per
   `authorization.ts:294` — has no affordance or explicit disposition anywhere on the screen).
4. State, feedback, and recovery coverage — APPLICABLE: 3/14 (only `total===0` is handled; loading,
   error/retry, partial-panel failure, archived Subject, and removed-linked-resource are absent).
5. Multi-tenant organization context and isolation UX — APPLICABLE: 2/10 (`:orgId` missing from
   route; no active-org/stale-link/insufficient-membership behavior stated).
6. Guest/authenticated surface separation — NOT APPLICABLE (authenticated-only screen).
7. Responsive, mobile, and accessibility planning — APPLICABLE: 2/12 (only the auto-fill card grid is
   concrete; no mobile header/panel transform, focus, keyboard, target size, or live-update
   announcement).
8. Zero-context handoff quality and internal consistency — APPLICABLE: 3/10 (wrong route, incomplete
   RBAC, undefined destinations, and the "Requisitos"/"Rastreamento legado" label pair violating
   §2.4's disambiguation requirement all block a zero-context build).

V1 Hierarchy/composition:        11/20  (evidence level 2 — HIGH)
V2 Typography/data legibility:   6/13   (evidence level 2 — HIGH)
V3 Rhythm/alignment/density:     5/14   (evidence level 2 — HIGH)
V4 Color/surface/depth:          3/11   (evidence level 1 — HIGH)
V5 Component/state craft:        3/12   (evidence level 1 — HIGH)
V6 Motion/continuity:            0/9    (evidence level 0 — HIGH)
V7 Product authorship:           7/17   (evidence level 2 — HIGH)  (counterfactual test: **FAIL** —
  replacing "Fornecedor"/"Conformidade"/"Requisitos"/"Documentos" with "Item"/"Status"/"Category"
  leaves a generic entity-detail header + one KPI panel + four equal navigation cards; capped at
  8/17, scored 7. This is the second confirmed instance of SLF-01's flat metric/link-card grid
  pattern the rubric itself predicted for A09.)
V8 Coherence/auditability:       1/4    (evidence level 1 — HIGH)

Findings:
- Major: route omits `/app/:orgId`, contradicting the tenant-isolation contract (SLF-03 cross-ref).
- Major: `subject:delete` (ADMIN_ROLES) has no affordance or disposition anywhere on the screen,
  despite being a named action in the plan's A09 entry.
- Major: state/recovery model is almost entirely absent — no loading, error/retry, partial-panel
  failure, archived Subject, or removed-linked-resource treatment.
- Major: "Editar fornecedor" (`subject:update`, WRITE_ROLES) is shown with no role-gating at all —
  a VIEWER would see an actionable-looking edit control.
- Major: the four-card link grid is a flat, equal-weight pattern with no visual distinction between
  a Subject with missing/expiring evidence and one fully compliant — this is the rubric's own
  predicted second instance of SLF-01 (see cross-reference below).
- Moderate: "Requisitos" card label sits next to "Rastreamento legado" without the plan §2.4-mandated
  disambiguating copy ("Requisito documental" vs. legacy "Requisito acompanhado") — the underlying
  data is not conflated (the card correctly counts the newer `Requirement`), only the label pair
  risks user-facing ambiguity between the two naming-collision concepts.
- Moderate: "Documentos" destination is described only as "a list" with no concrete route — there is
  no standalone tenant-wide Documents Collection screen (per A12's plan entry), so this destination
  needs a Subject-filtered document view that doesn't otherwise exist in the inventory.
- Minor: no spec version/date; no motion/reduced-motion decision (SLF-02 cross-ref).

Design-system dispositions:
- SPEC GAP: correct route, full RBAC action table (edit/delete/read tiers), full state coverage
  (loading/error/archived/removed-resource), disambiguating requirement-label copy, motion decision.
- SYSTEM CONSTRAINT: the flat four-card link grid is SLF-01's predicted second confirmed instance
  (do not reopen — cross-reference `system-level-findings.md` SLF-01, updated this batch to mark A09
  CONFIRMED, meeting the rubric's "3+ screens" recurrence bar is not yet met by count alone but SLF-01
  already qualifies via the "foundational primitive" OR-clause).
- SYSTEM GAP: none independently established beyond SLF-01/02/03.
- JUSTIFIED EXCEPTION: none.
- SYSTEM EVOLUTION CANDIDATE: a "Subject Compliance Summary" primitive (percent + numerator/
  denominator + missing/expiring breakdown + partial-data state) and a risk-prioritized destination
  card (elevating missing/expiring resource families over fully-satisfied ones) — noted as candidates
  feeding the same SLF-01 remediation, not a new independent finding.

Evidence excerpts (file:line, pre-revision spec):
- `docs/frontend/prototype-screen-specs/A09-subject-hub.md:3` (pre-revision) — route `/subjects/:id`,
  no `:orgId` (SLF-03 cross-ref).
- `docs/frontend/prototype-screen-specs/A09-subject-hub.md:9` (pre-revision) — "Editar fornecedor"
  and "Exportar dossiê" with no per-action role gate stated for edit.
- `docs/frontend/prototype-screen-specs/A09-subject-hub.md:14-18` (pre-revision) — four link cards as
  an equal auto-fill grid (SLF-01 cross-ref).
- `src/modules/identity/domain/authorization.ts:291-294` — `subject:update`=WRITE_ROLES,
  `subject:delete`=ADMIN_ROLES.
- `docs/frontend/p0-screen-inventory-plan.md:269-283` (A09 entry) — full data/action/state/connection
  requirements, most absent from the pre-revision spec.
- `docs/frontend/p0-screen-inventory-plan.md:104-111` (§2.4) — disambiguation requirement for
  `Requirement` vs. `RequirementAssignment` labels.

Required revision: **applied to `A09-subject-hub.md` in this batch** — see the spec's revision
history note. Summary:
- Reconciled the route to `/app/:orgId/subjects/:subjectId`.
- Added an explicit action table: read (`subject:read`, all), edit (`subject:update`, WRITE_ROLES),
  delete (`subject:delete`, ADMIN_ROLES — surfaced as an overflow-menu action with confirmation, not
  a header button, since it's rarer than edit/export), dossier export (unchanged, ADMIN_ROLES).
- Renamed the requirements card to "Requisitos documentais" and the legacy card kept "Rastreamento
  legado (requisitos acompanhados)" to satisfy §2.4's disambiguation requirement.
- Added loading/error/retry-per-panel, archived-Subject banner, and removed-linked-resource states.
- Authored a severity-led card treatment: the requirements/documents cards escalate visual weight
  (tone + ordering) when `missingCount>0` or `expiringSoonCount>0`, instead of four visually
  identical cards — a local mitigation within SLF-01's constraint, not a new shared component.
- Named a concrete motion decision (panel data settles at `motion.fast`, no cross-card transition) and
  an explicit `prefers-reduced-motion` fallback.

Rendered-review checks to defer to the later gate:
- Whether the severity-escalated card treatment reads as calm rather than alarming once rendered.
- Contrast and legibility of the percent+fraction pairing at 320px with long PT-BR Subject names.
- Whether "Requisitos documentais" reads naturally in the nav/breadcrumb trail once implemented.
