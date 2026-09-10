# A15 — Bulk Import (CSV) — Screen Spec Audit Record

**Process note**: one BLIND Codex pass (batch 4/6, A14/A15/A16/A17 audited together in a single
prompt) + one Claude reconciliation round.

**Reconciliation**: Codex's blind read caught a real RBAC under-grant Claude's own draft had also
flagged: the spec's "Acesso: MEMBER+" line excludes VIEWER entirely, but the plan's `import:read` is
explicitly ALL ROLES (status polling) — VIEWER should be able to open/reopen `/imports/:jobId` and
watch status even without create/map/commit rights. Codex's figures (Functional 31.5, Visual 42.0,
Consolidated 35.7) are adopted as-is.

---

Screen: A15 — Bulk Import / "Importação em massa (CSV)"
Route: `/import` (spec, pre-revision) — canonical plan route: `/app/:orgId/imports/new`,
`/app/:orgId/imports/:jobId`
Primary task: CSV upload → column mapping → preview/dedupe → commit → resume, creating
Subjects/Documents/Requirements in bulk.
Spec version/date: undated, audited 2026-09-10.

Functional score (applicable-only, renormalized): 31.5/100
Visual specification score: 42.0/100
Consolidated score: 35.7/100
Gate result: **NOT PASS** — both floors failed; RBAC under-grant and multiple Major findings.

Visual confidence: HIGH
Classification: SPEC AUDIT — rendered excellence not yet verified (rubric §0).

Perceptual reading order (as described or inferred):
1. Step badges (wizard position).
2. Current step's panel content (upload / mapping / preview / commit).
3. Step-transition actions (voltar / avançar).

D-247 axes (axis 6 marked N/A — no guest surface on this screen; 92 applicable points):
1. Backend-to-interface completeness and traceability — 8/18 (upload/mapping/preview/commit are
   named but async parsing, dedupe as a decision, resumability, and commit-idempotency are absent).
2. Journey, navigation, and screen-graph coherence — 6/14 (linear wizard flow is clear; no
   persistent per-job route, no return-to-same-job behavior).
3. RBAC-aware visibility and action model — 5/14 (**Major**: "MEMBER+" excludes VIEWER from
   `import:read`, which the plan grants to all roles for status polling).
4. State, feedback, and recovery coverage — 5/14 (partial-success reporting is real and correct;
   async parsing, invalid mapping, resumable job, idempotent re-commit, quota/size limit, and
   incompatible format are all absent).
5. Multi-tenant organization context and isolation UX — 1/10 (route omits `:orgId`).
6. Guest/authenticated surface separation — N/A (no guest surface on this screen).
7. Responsive, mobile, and accessibility planning — 1/12 (wide grid/table with no mobile transform
   despite the plan explicitly requiring stacked field pairs and a list-based error view).
8. Zero-context handoff quality and internal consistency — 3/10 (wizard shape is implementable at a
   surface level but the RBAC/route/state gaps force implementer invention).

V1 Hierarchy/composition:        11/20  (evidence level 2 — HIGH)
V2 Typography/data legibility:   5/13   (evidence level 2 — HIGH)
V3 Rhythm/alignment/density:     8/14   (evidence level 2 — HIGH)
V4 Color/surface/depth:          3/11   (evidence level 2 — HIGH)
V5 Component/state craft:        6/12   (evidence level 2 — HIGH)
V6 Motion/continuity:            0/9    (evidence level 0 — HIGH)
V7 Product authorship:           7/17   (evidence level 2 — HIGH)  (counterfactual test: **FAIL** —
  becomes a generic CSV import wizard applicable to any SaaS, not specific to compliance-document
  onboarding; capped at 8/17, scored 7.)
V8 Coherence/auditability:       2/4    (evidence level 2 — HIGH)

Findings:
- Major: RBAC under-grant — "Acesso: MEMBER+" excludes VIEWER, contradicting the plan's
  all-roles `import:read` (status-polling) grant.
- Major: no `/app/:orgId/imports/:jobId` route/view, no status polling, no per-job resumability.
- Major: upload jumps straight to mapping — no async parsing, progress, or parse failure/retry.
- Major: dedupe omitted entirely as a step/decision.
- Major: invalid mapping, resumable job, already-committed idempotency, commit failure,
  quota/file-size limit, and incompatible format all absent.
- Major: "Importação concluída" summary collapses Subjects/Documents/Requirements creation into a
  single "fornecedores criados" count.
- Major: no mobile plan at all, despite the plan requiring stacked mapping and a list-based error
  view with full mobile parity.
- Moderate — SLF-03: route `/import` diverges from both tenant-scoped plan routes.
- Moderate: final links don't lead to a persistent per-job summary or detail the created resources.
- Moderate — SLF-04: "Voltar" and "Ver relatório de erros" used `tertiary`.

Design-system dispositions:
- SPEC GAP: VIEWER read access, `:orgId`-qualified routes, async parsing/dedupe/resumability/
  idempotency/quota/format states, three-entity commit summary, mobile transform, motion decision.
- SYSTEM GAP: none newly identified beyond SLF-02/03/04.
- SYSTEM CONSTRAINT: none.
- JUSTIFIED EXCEPTION: none.
- SYSTEM EVOLUTION CANDIDATE: none new.

Evidence excerpts (file:line, pre-revision spec):
- `docs/frontend/prototype-screen-specs/A15-importacao-csv.md:3-4` (pre-revision) — `/import` route,
  "Acesso: MEMBER+" excluding VIEWER.
- `docs/frontend/prototype-screen-specs/A15-importacao-csv.md:16` (pre-revision) — upload → mapping
  transition with no processing step.
- `docs/frontend/prototype-screen-specs/A15-importacao-csv.md:29` (pre-revision) — "fornecedores
  criados" as the only entity counted in the completion summary.
- `docs/frontend/p0-screen-inventory-plan.md:393-409` (A15 entry) — full data/action/state
  requirements, most absent pre-revision, including the explicit all-roles `import:read` grant.

Required revision: **applied to `A15-importacao-csv.md` in this batch**. Summary:
- Reconciled routes to `/app/:orgId/imports/new` and `/app/:orgId/imports/:jobId` (persistent,
  reopenable, resumable).
- Corrected access: `import:read` (view status) for all roles including VIEWER, in a dedicated
  read-only mode; create/map/commit remain WRITE_ROLES.
- Added an explicit `processing` (ASYNC_POLLING) step between upload and mapping, with timeout/retry
  behavior.
- Added dedupe as its own decision block in the preview step (per-row "atualizar existente"/"criar
  como novo").
- Added invalid-mapping-blocks-advance, resumable-job, idempotent re-commit, commit failure, storage
  quota, and incompatible-format states.
- Rewrote the completion summary to count Subjects/Documents/Requirements separately.
- Added the mobile transform (stacked mapping fields, list-based error view) and a keyboard/focus/
  motion model.
- Replaced `tertiary` with `ghost`.

Rendered-review checks to defer to the later gate:
- Whether the 5-step badge header (with the new `processing` step) still reads clearly at narrow
  widths.
- Real-world legibility of the dedupe per-row radio choice at high row counts.
- Timing/UX feel of the 2s/60s polling and timeout thresholds once implemented against real job
  durations.
