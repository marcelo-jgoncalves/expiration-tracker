# A17 — Subject Dossier Export — Screen Spec Audit Record

**Process note**: one BLIND Codex pass (batch 4/6, A14/A15/A16/A17 audited together in a single
prompt) + one Claude reconciliation round.

**Reconciliation**: this is the one screen in the batch where the task brief's flagged risk (a MEMBER-
who-is-assignee exception) did NOT materialize — both Claude's own pre-Codex read and Codex's blind
pass independently confirmed the spec's RBAC line is fully correct: "restrito a OWNER e ADMIN (mesmo
o responsável direto pelo fornecedor não pode)" matches D-205's ADMIN_ROLES-exclusive rule with no
assignee exception, literally. This is the only one of the 4 screens in this batch — and one of very
few in the full 24-screen audit project so far — whose central RBAC statement required zero
correction. Codex's figures (Functional 47.8, Visual 50.0, Consolidated 48.7) are adopted as-is.

---

Screen: A17 — Subject Dossier Export / "Exportar dossiê do fornecedor"
Route: `/subjects/:id/dossier` (spec, pre-revision) — canonical plan route:
`/app/:orgId/subjects/:subjectId/dossier`
Primary task: preview a frozen scope → confirm → generate → download a PDF/Excel compliance dossier
for one Subject.
Spec version/date: undated, audited 2026-09-10.

Functional score (applicable-only, renormalized): 47.8/100
Visual specification score: 50.0/100
Consolidated score: 48.7/100
Gate result: **NOT PASS** — RBAC correct, but lifecycle/state coverage and responsive/a11y planning
fall well below the gate; multiple Major findings on lifecycle correctness.

Visual confidence: HIGH (MEDIUM on V7)
Classification: SPEC AUDIT — rendered excellence not yet verified (rubric §0).

Perceptual reading order (as described or inferred):
1. Frozen scope summary (requirements/documents included, scope hash).
2. Format choice (PDF/Excel).
3. Confirm/generate action → generation feedback → download.

D-247 axes (axis 6 marked N/A — no guest surface; 92 applicable points):
1. Backend-to-interface completeness and traceability — 10/18 (scope/format/hash/download-window
   concepts are present; stale-scope detection and the two distinct expiry mechanisms are not).
2. Journey, navigation, and screen-graph coherence — 8/14 (A09 back-link exists; no explicit forward/
   return behavior beyond that single connection).
3. RBAC-aware visibility and action model — **14/14 — fully correct**: ADMIN_ROLES-exclusive with no
   assignee exception, matching D-205 literally.
4. State, feedback, and recovery coverage — 3/14 (pending state exists; stale scopeHash, generation
   failure/retry, export-itself-expired, and presigned-URL-expired-and-regenerable are all absent or
   conflated into one under-specified sentence).
5. Multi-tenant organization context and isolation UX — 2/10 (route omits `:orgId`).
6. Guest/authenticated surface separation — N/A.
7. Responsive, mobile, and accessibility planning — 1/12 (no mobile transform for long previews
   despite the plan explicitly requiring collapsible sections rather than a desktop-only view; no
   keyboard/focus/announcement model).
8. Zero-context handoff quality and internal consistency — 6/10 (relatively coherent aside from the
   route and the two conflated expiry clocks).

V1 Hierarchy/composition:        12/20  (evidence level 2 — HIGH)
V2 Typography/data legibility:   7/13   (evidence level 2 — HIGH)
V3 Rhythm/alignment/density:     8/14   (evidence level 2 — HIGH)
V4 Color/surface/depth:          4/11   (evidence level 2 — HIGH)
V5 Component/state craft:        7/12   (evidence level 2 — HIGH)
V6 Motion/continuity:            1/9    (evidence level 1 — HIGH)
V7 Product authorship:           8/17   (evidence level 2 — MEDIUM)  (counterfactual test: **does
  NOT fully collapse to generic CRUD** — a frozen-scope preview with a content hash and a
  multi-format compliance package expresses a real domain-specific operating model; cap not applied,
  though execution still only merits 8/17 on its own craft.)
V8 Coherence/auditability:       3/4    (evidence level 2 — HIGH)

Findings:
- Major: the rule "se dados mudarem depois, o dossiê final ainda reflete o que foi mostrado" removes
  the required `stale scopeHash` state — the plan requires detecting a scope change *before*
  confirmation and offering re-preview, not silently accepting a stale hash.
- Major: `generating` names `pending` but omits generation failure/retry entirely.
- Major: "o link de download é válido por 30 dias" conflates two distinct clocks — the 30-day export
  TTL (D-235) and the short-lived, independently regenerable presigned download URL.
- Major: neither the export-itself-expired-after-30-days state nor the presigned-URL-expired-and-
  regenerable state has any spec coverage.
- Major: long previews have no collapsible-section treatment and no mobile/keyboard/focus coverage,
  despite the plan requiring both explicitly.
- Moderate: the automatic stage transition depends on polling, but frequency/timeout/unavailability/
  re-entry are unspecified.
- Moderate — SLF-03: route omits `/app/:orgId`.
- Moderate: the prototype's manual-advance simulation button is not distinguished from the real
  automatic-transition behavior.
- Minor: the scope-hash explanation overclaims ("garante") given the stale-state gap above.

Design-system dispositions:
- SPEC GAP: stale-scopeHash detection/re-preview, generation failure/retry, the two distinct expiry
  states (export TTL vs. presigned URL), collapsible long-preview sections, mobile/keyboard/focus
  model, `:orgId`-qualified route, motion decision, corrected (non-overclaiming) scope-hash wording.
- SYSTEM GAP: none newly identified beyond SLF-03.
- SYSTEM CONSTRAINT: none.
- JUSTIFIED EXCEPTION: none.
- SYSTEM EVOLUTION CANDIDATE: none new — the frozen-scope-preview-with-hash pattern is currently
  local to A17; worth revisiting if a future screen (e.g. a bulk export) needs the same primitive.

Evidence excerpts (file:line, pre-revision spec):
- `docs/frontend/prototype-screen-specs/A17-dossie-fornecedor.md:4` (pre-revision) — the RBAC line,
  confirmed correct, unchanged in this revision.
- `docs/frontend/prototype-screen-specs/A17-dossie-fornecedor.md:32` (pre-revision) — the scope-
  freezing rule that omits the pre-confirmation stale-scope case.
- `docs/frontend/prototype-screen-specs/A17-dossie-fornecedor.md:27,33` (pre-revision) — the single
  "válido por 30 dias" sentence conflating export TTL and presigned-URL expiry.
- `docs/frontend/p0-screen-inventory-plan.md:432-444` (A17 entry) — full state/RBAC/responsive
  requirements, RBAC already matched pre-revision, states/responsive largely absent.

Required revision: **applied to `A17-dossie-fornecedor.md` in this batch**. Summary:
- RBAC line left unchanged (already correct) — explicitly noted in the revision header as confirmed,
  not silently re-derived.
- Added a `stale scopeHash` interception on "Confirmar e gerar" with a re-preview action.
- Added generation-failure/retry coverage in `generating`.
- Split the single expiry sentence into two explicit, independently-recoverable states: export-run
  30-day TTL expiry (D-235, requires a new dossier) vs. presigned-URL expiry (regenerable without
  reprocessing).
- Added collapsible sections for long requirement/document lists, full mobile parity, and a keyboard/
  focus/announcement model.
- Reconciled the route to `/app/:orgId/subjects/:subjectId/dossier`.
- Named a concrete polling cadence/timeout and a motion decision with `prefers-reduced-motion`
  fallback.
- Softened the scope-hash explanation to match the newly-specified stale-state behavior.

Rendered-review checks to defer to the later gate:
- Whether the frozen-scope preview block reads clearly once collapsible sections are actually
  rendered with realistic requirement/document counts.
- Perceived responsiveness of the 3s-poll/45s-timeout generation feedback once implemented against
  real dossier-generation durations.
