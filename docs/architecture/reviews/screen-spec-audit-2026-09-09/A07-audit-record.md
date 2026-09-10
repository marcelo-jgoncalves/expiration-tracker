# A07 — Generic Document / OCR Attachment (Expiration module) — Screen Spec Audit Record

**Process note**: one BLIND Codex pass (`codex exec --skip-git-repo-check`,
`codex-out-A07.txt`) + one Claude reconciliation round.

**Reconciliation**: Claude's independent read agreed with Codex on both Critical findings — the
RBAC line grants file deletion to MEMBER+ when the plan defines `document:delete` as ADMIN_ROLES-only,
and the two-phase upload (reservation vs. actual byte transfer, named explicitly in the plan as
separately-failable steps) is entirely collapsed into a single "Adicionar arquivo" action with no
`PENDING_UPLOAD` state. Claude's own draft scores (Functional ~32/100, Visual ~25/100) were close to
Codex's (34/100, 27/100); this record adopts Codex's figures as reconciled.

---

Screen: A07 — Arquivos do vencimento (Generic Document/OCR attachment, Expiration module)
Route: `/expirations/:id/files` (spec, pre-revision) — canonical plan route:
`/app/:orgId/expirations/:itemId/files/:documentId?`
Primary task: upload, inspect, delete legacy file attachments tied to one `ExpirationItem`, and
review/confirm OCR-extracted fields.
Spec version/date: undated, audited 2026-09-09.

Functional score (applicable-only, renormalized): 34.0/100
Visual specification score: 27.0/100
Consolidated score: 31.0/100
Gate result: **NOT PASS** — all three floors fail; every visual axis below 60%; unresolved Critical
RBAC and upload-lifecycle findings, plus an epistemic-integrity gap (malware scan vs. approval).

Visual confidence: HIGH
Classification: SPEC AUDIT — rendered excellence not yet verified (rubric §0).

Perceptual reading order (as described or inferred):
1. Page title/description, "Adicionar arquivo" primary action.
2. Attachments table (name, type, size, security status, delete).
3. OCR-extracted fields panel with confidence and confirm action.

D-247 axes (applicable / shared-system-level / N/A marked per criterion): 31/92 → normalized 34.0/100
1. Backend-to-interface completeness and traceability — APPLICABLE: 7/18 (`PENDING_UPLOAD`/
   `DELETED` statuses, reservation/transfer phases, extraction origin, and concurrent-confirmation
   handling all absent)
2. Journey, navigation, and screen-graph coherence — APPLICABLE: 7/14 (`:orgId`/`:documentId`
   missing; selected-document/file-open behavior undefined)
3. RBAC-aware visibility and action model — APPLICABLE: 4/14 (**Critical**: delete exposed to
   MEMBER+, plan requires ADMIN_ROLES)
4. State, feedback, and recovery coverage — APPLICABLE: 5/14 (SCANNING/REJECTED/UNSUPPORTED/TIMEOUT/
   pending-OCR named; two-phase upload feedback, `PENDING_UPLOAD`, `DELETED`, retry/recovery, empty/
   loading states, concurrent-confirmation conflict all absent)
5. Multi-tenant organization context and isolation UX — APPLICABLE: 0/10 (`:orgId` entirely absent)
6. Guest/authenticated surface separation — SHARED-SYSTEM-LEVEL (authenticated-only screen)
7. Responsive, mobile, and accessibility planning — APPLICABLE: 3/12 (max-width stated; required
   mobile stacking of suggested-vs-confirmed comparison and full parity unaddressed)
8. Zero-context handoff quality and internal consistency — APPLICABLE: 5/10 (wrong route, wrong
   RBAC tier, undefined `tertiary` variant, incomplete status enum)

V1 Hierarchy/composition:        7/20   (evidence level 2 — HIGH)
V2 Typography/data legibility:   5/13   (evidence level 2 — HIGH)
V3 Rhythm/alignment/density:     5/14   (evidence level 2 — HIGH)
V4 Color/surface/depth:          3/11   (evidence level 1 — HIGH)
V5 Component/state craft:        3/12   (evidence level 1 — HIGH)
V6 Motion/continuity:            0/9    (evidence level 0 — HIGH)
V7 Product authorship:           3/17   (evidence level 0-1 — HIGH)  (counterfactual test: **FAIL**
  — a generic file-table with a status column and a generic "extracted fields" list; capped at 8/17,
  scored 3 given how little of even the domain-specific epistemic-integrity discipline is realized
  visually.)
V8 Coherence/auditability:       1/4    (evidence level 1 — HIGH)

Findings:
- Critical: RBAC states "MEMBER+ para upload/edição" with an unrestricted "Excluir" row action —
  the plan requires `document:delete` = ADMIN_ROLES (OWNER/ADMIN only).
- Critical: the two-phase upload model (reserve vs. actually-sent bytes, named explicitly in the plan
  as independently failable) is entirely collapsed into one "Adicionar arquivo" action with no
  `PENDING_UPLOAD` status and no distinct reservation-failure vs. transfer-failure recovery.
- Major: route omits `:orgId` and `:documentId`.
- Major: status enum omits `PENDING_UPLOAD` and `DELETED`, both named in the plan.
- Major: "Todo arquivo passa por verificação... antes de ficar disponível" risks conflating malware-
  scan clearance with document approval/correctness — an epistemic-integrity violation per the design
  system's own §79 principle.
- Major: concurrent OCR-confirmation conflict has no handling at all.
- Major: OCR field presentation lacks explicit origin/provenance (which file it came from).
- Moderate: no loading/empty/upload-progress/transfer-failure/generic-error/delete-confirmation
  states anywhere.
- Moderate: "Excluir" uses the undefined `tertiary` Button variant (SLF-04 cross-ref, second
  occurrence with a destructive action specifically — should be `danger`, not `ghost`, given this one
  destroys data rather than being merely low-emphasis).
- Minor: no mobile stacking behavior for the suggested-vs-confirmed OCR comparison despite the plan
  naming it explicitly.

Design-system dispositions:
- SPEC GAP: correct route, correct RBAC tier, complete status enum, two-phase upload feedback,
  concurrent-confirmation handling, OCR origin/provenance, loading/empty/error states, mobile
  stacking, motion.
- SYSTEM CONSTRAINT: `document:delete` is ADMIN_ROLES-only per `authorization.ts` (SLF cross-check,
  not a system-level finding by itself — a screen-local RBAC error, same class as A05's).
- SYSTEM CONSTRAINT: `tertiary` not an approved variant (SLF-04 cross-reference, not reopened).
- JUSTIFIED EXCEPTION: none.
- SYSTEM EVOLUTION CANDIDATE: a reusable two-phase upload/progress/retry pattern and an "OCR
  suggested-vs-confirmed with origin" comparison pattern would generalize beyond this one legacy
  module — noted as a candidate, not opened as a system-level finding from a single screen.

Evidence excerpts (file:line, pre-revision spec):
- `docs/frontend/prototype-screen-specs/A07-arquivos-vencimento.md:3` (pre-revision) — route
  `/expirations/:id/files`, no `:orgId`/`:documentId` (SLF-03 cross-ref).
- `docs/frontend/prototype-screen-specs/A07-arquivos-vencimento.md:21` (pre-revision) — `tertiary`
  variant on "Excluir", visible without an ADMIN_ROLES gate.
- `docs/frontend/prototype-screen-specs/A07-arquivos-vencimento.md:15-20` (pre-revision) — status
  enum missing `PENDING_UPLOAD`/`DELETED`; no two-phase upload state.
- `docs/frontend/p0-screen-inventory-plan.md:239-254` (A07 entry) — full status enum, two-phase
  upload discipline, and RBAC tiers, most contradicted or absent in the pre-revision spec.

Required revision: **applied to `A07-arquivos-vencimento.md` in this batch** — see the spec's
revision history note. Summary:
- Reconciled the route to `/app/:orgId/expirations/:itemId/files/:documentId?`.
- Corrected RBAC: delete restricted to ADMIN_ROLES (`danger` variant, icon-only with accessible name).
- Added `PENDING_UPLOAD` and `DELETED` to the status model with concrete presentation/recovery for
  each, and made the file-name link conditional on `CLEAN` status only.
- Made "CLEAN ≠ approved" explicit in both business-rules copy and the status badge's meaning.
- Added OCR field origin/provenance and concurrent-confirmation conflict handling.
- Named a concrete motion decision for status transitions and OCR confirmation with layout-shift-free
  behavior, plus a `prefers-reduced-motion` fallback.

Rendered-review checks to defer to the later gate:
- Whether the file-name-becomes-a-link-only-when-CLEAN behavior reads as intuitive or confusing once
  rendered.
- Real-world scan latency and whether the auto-updating row (no manual reload) actually feels
  responsive.
