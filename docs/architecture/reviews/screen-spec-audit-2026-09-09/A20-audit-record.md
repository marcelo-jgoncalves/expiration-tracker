# A20 — Document Types & Metadata Catalog — Screen Spec Audit Record

**Process note**: one BLIND Codex pass (batch 5/6, A18/A19/A20/A21 audited together in a single
prompt) + one Claude reconciliation round.

**Reconciliation**: Claude's own pre-Codex read and Codex's blind pass converged on the same central
defect — the spec's header states "Acesso: ADMIN+" for the whole screen, which contradicts the
plan's `docarchive:documenttype-read` READ_ONLY_ROLES requirement (VIEWER/MEMBER must be able to
browse the catalog, only mutation is ADMIN-gated). Codex called this Critical; Claude's independent
read agrees it is a real RBAC-visibility error (an entire browsing surface wrongly hidden from two
roles) but classifies it as Major rather than Critical in the reconciled record, reserving Critical
for a wrong *grant* of a sensitive capability (as in A16's prior over-grant or A19's three defects
this same batch) — this is an over-restriction, not an over-grant, and does not expose any data or
action beyond what the restricted roles should already see elsewhere in the product. Both reads
independently confirmed the guest-visibility column is handled correctly (informational only, no
invented toggle). Codex's numeric figures are adopted with no adjustment.

---

Screen: A20 — Document Types & Metadata Catalog / "Catálogo de tipos de documento"
Route: `/settings/document-types` (spec, pre-revision) — canonical plan routes:
`/app/:orgId/settings/document-types`, `/.../document-types/:documentTypeId` (entirely absent
pre-revision).
Primary task: browse/administer the shared DocumentType catalog and its metadata field definitions.
Spec version/date: undated, audited 2026-09-10.

Functional score (applicable-only, renormalized): 28/100
Visual specification score: 32/100
Consolidated score: 30/100
Gate result: **NOT PASS** — RBAC visibility, state coverage, and responsive planning all below 60%
of their available points; the metadata field builder (a required part of this screen) is
effectively unspecified.

Visual confidence: HIGH
Classification: SPEC AUDIT — rendered excellence not yet verified (rubric §0).

Perceptual reading order (as described or inferred):
1. Catalog table (name, field count, status, guest-visibility, actions).
2. (Field builder/editor — not actually specified pre-revision.)

D-247 axes (axis 6 marked N/A — no distinct guest-facing UI on this screen itself; 92 applicable
points, renormalized):
1. Backend-to-interface completeness and traceability — 7/18 (catalog row fields present; the
   metadata field builder itself — value types, required flag, options, archived fields — is
   essentially unspecified).
2. Journey, navigation, and screen-graph coherence — 4/14 (a link to "editor de campos" is named but
   no detail route or editor screen structure is given; route omits `:orgId`).
3. RBAC-aware visibility and action model — 2/14 (whole-screen "ADMIN+" gate wrongly blocks
   VIEWER/MEMBER browsing; mutation controls have no separate role-conditioned treatment).
4. State, feedback, and recovery coverage — 2/14 (Active/Descontinuado present; duplicate-name, OCC
   conflict, live-Document-reference, no-fields, and non-retroactive-required-field states absent).
5. Multi-tenant organization context and isolation UX — 3/10 (states org-wide sharing correctly;
   route omits `:orgId`).
6. Guest/authenticated surface separation — 6/8 (guest-visibility column correctly informational,
   matches "every ACTIVE type is guest-visible by construction" with no invented toggle).
7. Responsive, mobile, and accessibility planning — 0/12 (no mobile parity, no field-builder stacking,
   no non-drag reorder alternative).
8. Zero-context handoff quality and internal consistency — 4/10 (the catalog row is implementable in
   isolation, but the screen's other required half — the field builder — is not).

V1 Hierarchy/composition:        8/20   (evidence level 2 — HIGH)
V2 Typography/data legibility:   5/13   (evidence level 1 — HIGH)
V3 Rhythm/alignment/density:     6/14   (evidence level 2 — HIGH)
V4 Color/surface/depth:          2/11   (evidence level 0 — HIGH)
V5 Component/state craft:        5/12   (evidence level 2 — HIGH)
V6 Motion/continuity:            0/9    (evidence level 0 — HIGH)
V7 Product authorship:           4/17   (evidence level 1 — HIGH)  (counterfactual test: **fails** —
  reads as a generic configurable-catalog table with no domain-specific structure; capped at 8/17,
  actual craft scores below the cap anyway.)
V8 Coherence/auditability:       2/4    (evidence level 1 — HIGH)

Findings:
- Major: whole-screen "Acesso: ADMIN+" wrongly blocks VIEWER/MEMBER from browsing — the plan
  requires `docarchive:documenttype-read` for all READ_ONLY_ROLES; only mutation is ADMIN-gated.
- Major: mutation controls (Novo tipo / Editar / Descontinuar / Reativar) have no stated
  role-conditioned visibility distinct from the browsing surface.
- Major: the metadata field builder — value types, required flag, options, archived field/option
  state — is effectively unspecified despite being named as required screen content in the plan.
- Major: required states absent — duplicate name, a DEPRECATED type still referenced by live
  Documents, OCC conflict, a type with zero fields, and the non-retroactive-required-field rule.
- Major: no responsive/mobile plan and no non-drag (button/keyboard) reorder alternative for fields.
- Moderate — SLF-03: route omits `/app/:orgId`; the `:documentTypeId` detail route is entirely
  absent.
- Moderate — SLF-04: "Editar"/"Descontinuar"/"Reativar" used the nonexistent `tertiary` variant.
- Minor (positive): guest-visibility column correctly informational, no invented toggle.

Design-system dispositions:
- SPEC GAP: RBAC-visibility split (browse vs. mutate), field builder content, missing states,
  `:orgId`/detail routes, responsive/keyboard model, motion decision, `tertiary`→`ghost` correction.
- SYSTEM GAP: none newly identified beyond SLF-02/03/04 (all confirmed recurring here too).
- SYSTEM CONSTRAINT: none.
- JUSTIFIED EXCEPTION: none.
- SYSTEM EVOLUTION CANDIDATE: none new.

Evidence excerpts (file:line, pre-revision spec):
- `A20-catalogo-tipos-documento.md:4` (pre-revision) — "**Acesso:** ADMIN+" (whole screen), incorrect
  per plan's READ_ONLY_ROLES browsing requirement.
- `A20-catalogo-tipos-documento.md:14` (pre-revision) — guest-visibility column, confirmed correct.
- `docs/frontend/p0-screen-inventory-plan.md:506-523` — full A20 plan entry.

Required revision: **applied to `A20-catalogo-tipos-documento.md` in this batch**. Summary:
- Split RBAC explicitly: READ_ONLY_ROLES browse the catalog and the field editor (read-only);
  ADMIN_ROLES see and use all mutation actions, including the field builder's add/reorder/archive.
- Added a field-builder section (value types, required flag, options, archived-field treatment,
  non-drag button-based reordering) to the editor route.
- Added the required states (duplicate name, referenced-by-live-Documents notice, OCC conflict,
  zero-fields empty state, non-retroactive-required-field note).
- Added `:orgId`-qualified catalog and detail routes, mobile stacking, and a motion decision.
- Corrected `tertiary` to `ghost` for the reversible, non-destructive Descontinuar/Reativar actions.

Rendered-review checks to defer to the later gate:
- Whether the field-builder cards read clearly once a type has many fields and the list needs
  scrolling on a narrow viewport.
- Whether the read-only editor view for MEMBER/VIEWER is visually distinguishable enough from the
  ADMIN edit view once rendered (currently only an `InlineNotice` marks the difference).
