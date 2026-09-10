# A05 — Expiration Detail — Screen Spec Audit Record

**Process note**: one BLIND Codex pass (`codex exec --skip-git-repo-check`,
`codex-out-A05.txt`) + one Claude reconciliation round (D-249/D-250-style scope reduction, named
explicitly per session brief).

**Reconciliation**: Claude's independent read agreed with Codex's central findings, most severely
the RBAC error — the spec's own RBAC section states "Excluir/Arquivar: MEMBER+", but the ground-truth
plan defines `item:delete` as ADMIN_ROLES-only (OWNER/ADMIN), a strictly narrower tier than
`item:update`/archive (WRITE_ROLES). This is a spec defect that would let an implementer wire the
wrong authorization check for a destructive, irreversible action — treated as Critical, not Moderate,
consistent with the rubric's severity model for RBAC errors on destructive actions. Claude's own
draft scores (Functional ~34/100, Visual ~42/100) were close to Codex's (36/100, 45/100); this record
adopts Codex's figures as reconciled, with axis 3 (RBAC) held at Codex's 4/14 given both auditors
independently flagged the same Critical error.

---

Screen: A05 — Detalhe do vencimento (Expiration Detail)
Route: `/expirations/:id` (spec, pre-revision) — canonical plan route:
`/app/:orgId/expirations/:itemId`
Primary task: manage one `ExpirationItem` — inspect, edit, renew, archive/delete, manage
watchers/reminders/files, review its audit history.
Spec version/date: undated, audited 2026-09-09.

Functional score (applicable-only, renormalized): 36.0/100
Visual specification score: 45.0/100
Consolidated score: 39.6/100
Gate result: **NOT PASS** — Functional floor failed (36.0 < 90.0); Visual floor failed
(45.0 < 85.0); Consolidated floor failed (39.6 < 90.0); axes 3/4/5/8 below 60%; unresolved Critical
RBAC and routing findings.

Visual confidence: HIGH
Classification: SPEC AUDIT — rendered excellence not yet verified (rubric §0).

Perceptual reading order (as described or inferred):
1. Page title, category/issuer subtitle, Edit/Renew actions.
2. Hero: due date + relative urgency text, lifecycle badge + urgency indicator.
3. Identification/tracking detail grid, then link cards to Reminders/Files/Audit, then danger zone.

D-247 axes (applicable / shared-system-level / N/A marked per criterion): 33/92 → normalized 36.0/100
1. Backend-to-interface completeness and traceability — APPLICABLE: 7/18 (description, full date
   set, `renewedFromId`, watchers, explicit file operations, OCC-actionable behavior all missing)
2. Journey, navigation, and screen-graph coherence — APPLICABLE: 7/14 (link cards to A06/A07/A23
   exist but lack concrete destinations; `renewedFromId` predecessor/successor navigation absent)
3. RBAC-aware visibility and action model — APPLICABLE: 4/14 (**Critical**: delete stated as
   MEMBER+, plan requires ADMIN_ROLES; watcher/file-operation/audit tiers unstated)
4. State, feedback, and recovery coverage — APPLICABLE: 3/14 (only ACTIVE/ARCHIVED shown; RENEWED/
   DELETED, OCC conflict, renewal idempotency/retry, loading/failure/success entirely absent)
5. Multi-tenant organization context and isolation UX — APPLICABLE: 1/10 (`:orgId` missing from
   route; no isolation/deep-link behavior stated)
6. Guest/authenticated surface separation — SHARED-SYSTEM-LEVEL (authenticated-only screen)
7. Responsive, mobile, and accessibility planning — APPLICABLE: 7/12 (grid collapse stated; full
   parity, action ordering, keyboard/focus, touch targets unstated)
8. Zero-context handoff quality and internal consistency — APPLICABLE: 4/10 (wrong route, wrong
   RBAC, undefined `tertiary` variant, unexplained "status OCR" note all block zero-context build)

V1 Hierarchy/composition:        12/20  (evidence level 2 — HIGH)
V2 Typography/data legibility:   8/13   (evidence level 2 — HIGH)
V3 Rhythm/alignment/density:     8/14   (evidence level 2 — HIGH)
V4 Color/surface/depth:          5/11   (evidence level 1-2 — HIGH)
V5 Component/state craft:        4/12   (evidence level 1 — HIGH)
V6 Motion/continuity:            0/9    (evidence level 0 — HIGH)
V7 Product authorship:           7/17   (evidence level 1-2 — HIGH)  (counterfactual test: **FAIL**
  — replacing "Vencimento"/"Responsável"/lifecycle nouns with "Item"/"Owner"/"Status" leaves a
  generic detail-page-with-linked-subpages template; capped at 8/17, scored 7.)
V8 Coherence/auditability:       1/4    (evidence level 1 — HIGH)

Findings:
- Critical: RBAC states "Excluir/Arquivar: MEMBER+" — the plan requires `item:delete` = ADMIN_ROLES
  (OWNER/ADMIN only), a materially narrower tier than archive (`item:update`, WRITE_ROLES). An
  implementer following this spec literally would grant MEMBER a destructive, irreversible action.
- Critical: route omits `:orgId`, contradicting the canonical tenant-scoped route and the org-switch/
  isolation contract defined at the AppShell level.
- Major: RENEWED/DELETED lifecycle states, OCC-conflict handling despite showing an OCC version
  field, renewal idempotency/retry feedback, and `renewedFromId` predecessor/successor navigation are
  entirely absent.
- Major: watcher management (`item:watch`) has no UI surface at all despite being a named action.
- Major: no loading/failure/success/not-found/forbidden states anywhere on the screen.
- Major: delete confirmation is described as "recommended, not implemented" for an irreversible
  destructive action — this cannot be left optional.
- Moderate: "Arquivar vencimento" uses the undefined `tertiary` Button variant (SLF-04 cross-ref).
- Moderate: an unexplained "status OCR" note on the Files link card introduces a concept with no
  stated backend traceability.
- Minor: "v4 (OCC)" exposes raw implementation jargon directly in user-facing copy.

Design-system dispositions:
- SPEC GAP: correct RBAC tiers, correct route, full state coverage (RENEWED/DELETED/OCC/idempotent
  renewal/loading/failure/success), watcher management surface, delete confirmation dialog,
  motion/reduced-motion decision, semantic typography roles, focus/keyboard/touch-target detail.
- SYSTEM CONSTRAINT: `tertiary` is not an approved Button variant (SLF-04 cross-reference — do not
  reopen as a new finding, this is the third occurrence in this batch alone).
- SYSTEM GAP: none independently established beyond SLF-01/02/03/04.
- JUSTIFIED EXCEPTION: none.
- SYSTEM EVOLUTION CANDIDATE: an OCC-conflict reload/reconcile pattern and an idempotent-action
  progress/result pattern would generalize across A05/A06/A12/A14 (all name OCC conflicts and/or
  idempotent retries) — noted here as a candidate for a later batch to confirm/escalate, not opened
  as a system-level finding from a single screen.

Evidence excerpts (file:line, pre-revision spec):
- `docs/frontend/prototype-screen-specs/A05-vencimento-detalhe.md:4` (pre-revision) — route
  `/expirations/:id`, no `:orgId` (SLF-03 cross-ref).
- `docs/frontend/prototype-screen-specs/A05-vencimento-detalhe.md:18` (pre-revision) — `tertiary`
  variant on "Arquivar vencimento" (SLF-04 cross-ref).
- `docs/frontend/prototype-screen-specs/A05-vencimento-detalhe.md:29` (pre-revision) — RBAC line
  granting delete to MEMBER+, contradicting `authorization.ts`'s ADMIN_ROLES tier for `item:delete`.
- `docs/frontend/p0-screen-inventory-plan.md:209-225` (A05 entry) — full action/state/responsive
  requirements, most absent from the pre-revision spec.

Required revision: **applied to `A05-vencimento-detalhe.md` in this batch** — see the spec's revision
history note. Summary:
- Reconciled the route to `/app/:orgId/expirations/:itemId`.
- Corrected RBAC: delete restricted to ADMIN_ROLES; archive/edit/renew/watch remain WRITE_ROLES.
- Added RENEWED/DELETED lifecycle presentation, OCC-conflict recovery, idempotent-renewal loading
  state, watcher management surface, and full loading/failure/success coverage.
- Replaced `tertiary` with `ghost`; added a mandatory delete confirmation dialog with initial focus
  on Cancel.
- Authored a temporal-risk-first hero composition (icon+text+color urgency, never color-alone) and a
  severity-weighted link-card treatment (Reminders/Files cards escalate tone when something is
  pending) instead of a flat, equal-weight card grid.
- Named a concrete motion decision (state transitions at `motion.fast`, dialog at `motion.normal`, no
  cross-page navigation animation) with an explicit `prefers-reduced-motion` fallback.

Rendered-review checks to defer to the later gate:
- Whether the hero's urgency treatment reads as calm-but-clear once rendered with real typography.
- Contrast and focus visibility for the danger-zone controls at 320px.
- Whether the "collapsed technical version" disclosure pattern for the OCC version number feels
  discoverable rather than hidden.
