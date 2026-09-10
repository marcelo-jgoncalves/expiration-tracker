# A14 — Requests & Recurrence — Screen Spec Audit Record

**Process note**: one BLIND Codex pass (`codex exec --skip-git-repo-check`, prompt/output archived at
`C:\Users\Usuario\AppData\Local\Temp\claude\...\scratchpad\codex-batch4-prompt.txt` /
`codex-batch4-output.txt` for this session) + one Claude reconciliation round, covering A14/A15/A16/A17
together in a single blind pass (batch 4/6).

**Reconciliation**: Claude's own independent pre-Codex read identified the same core defects
(incomplete creation flows for both one-off and series paths, missing OCC/idempotency/expiry states,
`tertiary` variant, missing `:orgId`, `SENT` epistemic overclaim). Codex's blind figures (Functional
46.0, Visual 41.0, Consolidated 44.0) are adopted as-is — independently derived, well-evidenced, and
consistent with this batch's calibration against prior batches (27.6-50.2/100 NOT PASS range).

---

Screen: A14 — Requests & Recurrence (per Subject) / "Solicitações e recorrência"
Route: `/subjects/:id/requests` (spec, pre-revision) — canonical plan route:
`/app/:orgId/subjects/:subjectId/requests`, `/.../series/:seriesId`
Primary task: create/operate recurring `DocumentRequestSeries` AND one-off document requests per
Subject/Requirement; view materializations and their delivery/link lifecycle.
Spec version/date: undated, audited 2026-09-10.

Functional score (applicable-only, renormalized): 46.0/100
Visual specification score: 41.0/100
Consolidated score: 44.0/100
Gate result: **NOT PASS** — both floors failed (Functional 46.0 < 90.0; Visual 41.0 < 85.0;
Consolidated 44.0 < 90.0); multiple axes below 60%; multiple unresolved Major findings.

Visual confidence: HIGH
Classification: SPEC AUDIT — rendered excellence not yet verified (rubric §0).

Perceptual reading order (as described or inferred):
1. Header actions (create one-off / create series).
2. "Séries recorrentes" panel (status, recurrence, next run, recipient, actions).
3. "Solicitações avulsas e materializações" panel (delivery state, guest-link lifecycle).

D-247 axes (all APPLICABLE, base 100 points):
1. Backend-to-interface completeness and traceability — 9/18 (lists series/materializations
   correctly but specified neither creation form — one-off nor series — nor `series-update`).
2. Journey, navigation, and screen-graph coherence — 8/14 ("Voltar", Requirement link, "Ver" exist;
   G02/A11/A09/A12/A13 destinations and the `/series/:seriesId` detail route are unaddressed).
3. RBAC-aware visibility and action model — 11/14 ("MEMBER+ para criar/gerar/cancelar; VIEWER
   somente leitura" is broadly correct against WRITE_ROLES, but per-action granularity and
   `series-update` are missing).
4. State, feedback, and recovery coverage — 4/14 (ACTIVE/CANCELLED, SEND_UNCERTAIN,
   resolved/expired covered; no-recipient, not-yet-materialized, idempotent retry, OCC conflict,
   and terminal request states all absent).
5. Multi-tenant organization context and isolation UX — 2/10 (route omits `:orgId`; no org-switch
   behavior named).
6. Guest/authenticated surface separation — 5/8 (states the guest link is login-free with
   expiration; no revocation or fail-safe behavior for the G02 boundary).
7. Responsive, mobile, and accessibility planning — 3/12 (cron dual-representation is a real
   decision; no mobile table transform, keyboard, focus, or announcement model despite full mobile
   parity being explicitly required by the plan).
8. Zero-context handoff quality and internal consistency — 4/10 (useful inventory, insufficient to
   implement either creation flow; conflicts with the design system's approved Button variants).

V1 Hierarchy/composition:        9/20   (evidence level 2 — HIGH)
V2 Typography/data legibility:   7/13   (evidence level 2 — HIGH)
V3 Rhythm/alignment/density:     7/14   (evidence level 2 — HIGH)
V4 Color/surface/depth:          4/11   (evidence level 2 — HIGH)
V5 Component/state craft:        6/12   (evidence level 2 — HIGH)
V6 Motion/continuity:            0/9    (evidence level 0 — HIGH)
V7 Product authorship:           6/17   (evidence level 2 — HIGH)  (counterfactual test: **FAIL** —
  swapping "Requisito"/"Fornecedor"/recurrence nouns for generic placeholders leaves two conventional
  admin tables; capped at 8/17, scored 6.)
V8 Coherence/auditability:       2/4    (evidence level 2 — HIGH)

Findings:
- Critical: none.
- Major: neither creation flow ("Nova solicitação avulsa" nor "Nova série recorrente") specified
  beyond a header button — no fields, validation, recipient/requirement selection, confirmation,
  success, or error.
- Major: missing no-recipient, not-yet-materialized, "Gerar agora" idempotency/retry, OCC conflict on
  the series, and terminal (expired/revoked/resolved) request states — all named explicitly in the
  plan's A14 entry.
- Major: `series-update` action entirely absent.
- Moderate: `SENT`="Enviado" overstates certainty — the system confirms provider acceptance, not
  delivery (epistemic-integrity discipline, design-system.md §79).
- Moderate: destinations A11/A09, G02, A12/A13, and the `/series/:seriesId` detail route are all
  unspecified.
- Moderate — SLF-03: route omits `/app/:orgId`.
- Moderate — SLF-04: "Gerar agora"/"Cancelar"/"Ver" all used the non-existent `tertiary` variant.
- Minor: `CANCELLED` badge used `critical` tone, over-signaling a closed, non-actionable history row.

Design-system dispositions:
- SPEC GAP: complete one-off and series creation dialogs, `series-update`, OCC/idempotency/terminal
  states, `:orgId`-qualified routes, epistemic wording for `SENT`, mobile table transform,
  keyboard/focus model, motion decision.
- SYSTEM GAP: none newly identified beyond SLF-02/03/04 (already tracked).
- SYSTEM CONSTRAINT: none.
- JUSTIFIED EXCEPTION: none.
- SYSTEM EVOLUTION CANDIDATE: none new.

Evidence excerpts (file:line, pre-revision spec):
- `docs/frontend/prototype-screen-specs/A14-solicitacoes-recorrencia.md:3-4` (pre-revision) —
  abbreviated route, coarse RBAC line.
- `docs/frontend/prototype-screen-specs/A14-solicitacoes-recorrencia.md:9` (pre-revision) — both
  creation actions named as header buttons only, no flow specified.
- `docs/frontend/prototype-screen-specs/A14-solicitacoes-recorrencia.md:16,22` (pre-revision) —
  `tertiary` variant on row actions.
- `docs/frontend/p0-screen-inventory-plan.md:372-391` (A14 entry) — full data/action/state/connection
  requirements, most absent pre-revision, including explicit G4/D-248 confirmation that the one-off
  path must be built end-to-end alongside the recurring one.

Required revision: **applied to `A14-solicitacoes-recorrencia.md` in this batch**. Summary:
- Reconciled routes to `/app/:orgId/subjects/:subjectId/requests` and `.../series/:seriesId`.
- Specified both creation dialogs (one-off and series) in full — fields, validation, loading,
  success, error — plus a `series-update` edit flow reusing the series dialog.
- Added no-recipient, not-yet-materialized, idempotent "Gerar agora", OCC conflict, and terminal
  request-state coverage.
- Reworded `SENT` to "Aceito para envio" to remove the delivery-confirmation overclaim.
- Replaced `tertiary` with `ghost` (row/header actions) — `Cancelar` kept as `ghost`, not `danger`,
  since cancelling a series is reversible-adjacent (recreatable), not a permanent deletion.
- Changed `CANCELLED` badge tone from `critical` to `neutral`.
- Added mobile card transform, keyboard/focus model (including focus restoration after dialogs), and
  a named motion decision with `prefers-reduced-motion` fallback.
- Named the A09/A11/G02/A12/A13 connections explicitly.

Rendered-review checks to defer to the later gate:
- Whether the two-panel (series / one-off) composition reads with adequate risk hierarchy once
  rendered with realistic row counts.
- Legibility of the dual-representation recurrence cell (natural language + cron) at narrow widths.
- Focus-restoration behavior across the new creation/edit dialogs once implemented.
