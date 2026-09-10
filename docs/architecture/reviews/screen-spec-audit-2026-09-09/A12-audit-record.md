# A12 — Document Detail / Version History — Screen Spec Audit Record

**Process note**: one BLIND Codex pass (`codex exec --skip-git-repo-check`, prompt/output archived in
session scratchpad) + one Claude reconciliation round.

**Reconciliation**: Claude's independent read agreed with Codex on the central finding — the spec's
"Acesso: todos os papéis; revisão restrita a MEMBER+" line is too coarse. `docarchive:review` is
indeed WRITE_ROLES (MEMBER+), but `document-archive-service.ts`'s `assertReviewerOrAdmin` (~line 2710)
adds a service-level gate beyond the RBAC tier the spec never mentions: OWNER/ADMIN can always decide
any RECEIVED/UNDER_REVIEW version, but a MEMBER may only decide a version they personally claimed (or
one nobody has claimed yet) — a MEMBER who tries to decide someone else's claim gets an
`AuthorizationError`. The spec's "Revisar" link is presented uniformly with no such distinction,
meaning an implementer following it literally would either wire the wrong check or surface an
actionable-looking control that 403s for a MEMBER. Treated as Major (not Critical, since it degrades
gracefully to a denied action rather than granting excess privilege) — same severity class as A05's
prior-batch RBAC gap, but this direction (under-granting/misleading UI, not over-granting a
destructive action) is one notch less severe than A05's true Critical over-grant. Claude's own draft
scores (Functional ~41/100, Visual ~39/100) were close to Codex's (43.5/100, 41.0/100); this record
adopts Codex's figures as reconciled.

---

Screen: A12 — Document Detail / Version History (Detalhe do documento)
Route: `/documents/:id` (spec, pre-revision) — canonical plan route:
`/app/:orgId/documents/:documentId`
Primary task: inspect one `Document`'s current state and version lineage, edit metadata, upload a new
version, and enter review from a claimable version.
Spec version/date: undated, audited 2026-09-09.

Functional score (applicable-only, renormalized): 43.5/100
Visual specification score: 41.0/100
Consolidated score: 42.5/100
Gate result: **NOT PASS** — Functional floor failed (43.5 < 90.0); Visual floor failed
(41.0 < 85.0); Consolidated floor failed (42.5 < 90.0); V7 below the 13.5 world-class floor; multiple
axes below 60%; unresolved Major findings.

Visual confidence: HIGH
Classification: SPEC AUDIT — rendered excellence not yet verified (rubric §0).

Perceptual reading order (as described or inferred):
1. Header, document identity, "Editar metadados"/"Enviar nova versão" actions.
2. In-progress-version notice, then Document/Metadata two-column summary.
3. Version-history table with per-row review/view actions.

D-247 axes (applicable / shared-system-level / N/A marked per criterion): 40/92 → normalized 43.5/100
1. Backend-to-interface completeness and traceability — APPLICABLE: 10/18 (summary, metadata, partial
   history, upload, and core transitions covered; files, scan counters, DRAFT/WITHDRAWN, per-version
   validity, rejection reason, and lost/expired claim are all absent; "Ver arquivo" has no defined
   anatomy or destination).
2. Journey, navigation, and screen-graph coherence — APPLICABLE: 7/14 (return-to-requirement, A13,
   A20 named only in prose; entries from A09/A11/direct-link and "stays on this screen for new
   version" are unaddressed; route contradicts the canonical tenant-aware one).
3. RBAC-aware visibility and action model — APPLICABLE: 6/14 (**Major**: the service-level
   reviewer-or-admin gate beyond the RBAC tier is entirely unaddressed — see reconciliation above; no
   VIEWER-hides-write-actions rule stated for edit/upload either).
4. State, feedback, and recovery coverage — APPLICABLE: 5/14 (independent per-step upload failure,
   in-progress version, and incomplete-metadata indicator are named; loading/fetch-error/retry, OCC,
   scan pending/infected, claim lost/expired, and file-set-sealed are absent).
5. Multi-tenant organization context and isolation UX — APPLICABLE: 4/10 (`:orgId` missing from
   route; no active-org/stale-cross-org-link behavior).
6. Guest/authenticated surface separation — NOT APPLICABLE (authenticated screen; "Solicitação
   (guest)" is historical provenance text, not a guest surface).
7. Responsive, mobile, and accessibility planning — APPLICABLE: 3/12 (only the 1-column grid
   collapse is concrete; the mandatory table→timeline mobile transform, full-screen file preview, and
   review-action parity on mobile are all absent).
8. Zero-context handoff quality and internal consistency — APPLICABLE: 5/10 (happy-path structure and
   sample data are usable; route, RBAC nuance, states, and mobile behavior all require implementer
   invention).

V1 Hierarchy/composition:        10/20  (evidence level 2 — HIGH)
V2 Typography/data legibility:   5/13   (evidence level 1 — HIGH)
V3 Rhythm/alignment/density:     7/14   (evidence level 2 — HIGH)
V4 Color/surface/depth:          5/11   (evidence level 2 — HIGH)
V5 Component/state craft:        4/12   (evidence level 1 — HIGH)
V6 Motion/continuity:            0/9    (evidence level 0 — HIGH)
V7 Product authorship:           8/17   (evidence level 2 — HIGH)  (counterfactual test: **FAIL** —
  replacing "Documento"/"Fornecedor"/"Requisito"/"Versão"/"Revisor" with "Item"/"Category"/"Owner"
  leaves a conventional CRUD-detail-with-history template; version lineage/provenance/review data give
  some domain content, but the layout doesn't turn validity, review responsibility, or scan trust into
  a distinctive visual thesis; capped at 8/17, scored 8.)
V8 Coherence/auditability:       2/4    (evidence level 2 — HIGH)

Findings:
- Major: RBAC description omits the service-level `assertReviewerOrAdmin` gate — MEMBER may decide
  only a version they claimed (or nobody claimed); OWNER/ADMIN always bypass. The uniform "Revisar"
  link as specified would surface an actionable-looking control that 403s for a MEMBER on someone
  else's claim.
- Major: functional contract is substantially incomplete — files, scan pending/infected, file-set
  sealed precondition, lost/expired claim, OCC on concurrent metadata edit, rejection reason, and
  upload-step recovery are all named in the plan but absent from the spec.
- Major: route omits `/app/:orgId` (SLF-03 cross-ref).
- Major: no mobile table→timeline transform, no full-screen preview, and review actions are not
  guaranteed parity on mobile — all explicitly required by the plan's A12 entry.
- Major: "each step can fail independently" is stated but never operationalized — no way to identify
  which step completed, resume, safely retry, or recover focus/context.
- Moderate: VIEWER sees the same write-action affordances ("Editar metadados", "Enviar nova versão")
  as WRITE_ROLES with no hide/disable rule.
- Moderate: "Revisar" action only appears for RECEIVED rows; UNDER_REVIEW (including a version the
  actor themself claimed) has no defined row action.
- Moderate: RECEIVED/UNDER_REVIEW share one `warning` tone and ACCEPTED/SUPERSEDED share one
  `neutral` tone with no further distinction, despite being operationally different states.
- Minor: no spec version/date; "Situação=Ativo" risks being confused with version state without
  clearer labeling.

Design-system dispositions:
- SPEC GAP: correct route, full action-by-role matrix including the reviewer-or-admin nuance, full
  state coverage (files/scan/claim/OCC/rejection), mobile timeline+preview transform, motion decision,
  typography roles for long PT-BR names/metadata.
- SYSTEM GAP: a reusable "Version Lineage/Review Timeline" primitive (state + validity + scan +
  provenance + claim + decision, replacing a plain badge-and-table treatment) and a "claim-aware
  action gate" pattern (available-to-me / claimed-by-other-with-admin-override / unclaimed) would
  generalize across A12/A13 — candidate, not yet confirmed across enough screens to promote.
- SYSTEM CONSTRAINT: none proven — the defect is under-specification, not a system rule forcing a bad
  outcome.
- JUSTIFIED EXCEPTION: the mobile table→timeline transform is a locally justified departure from the
  desktop tabular presentation, already required by the plan's own A12 entry — not a new local
  invention needing separate escalation.
- SYSTEM EVOLUTION CANDIDATE: same Version Lineage/claim-aware-gate candidates as above, to be
  confirmed once A13's own audit (this batch) and A14 (a later batch) are compared.

Evidence excerpts (file:line, pre-revision spec):
- `docs/frontend/prototype-screen-specs/A12-documento-detalhe.md:3-5` (pre-revision) — route without
  `:orgId`; access reduced to "todos" + "MEMBER+" with no reviewer-or-admin nuance.
- `docs/frontend/prototype-screen-specs/A12-documento-detalhe.md:9` (pre-revision) — write actions
  shown with no per-role gate.
- `docs/frontend/prototype-screen-specs/A12-documento-detalhe.md:20` (pre-revision) — "Revisar" only
  for RECEIVED.
- `src/modules/document-archive/application/document-archive-service.ts:2705-2718` —
  `assertReviewerOrAdmin`: OWNER/ADMIN always bypass; MEMBER blocked when `reviewerId` belongs to
  someone else.
- `src/modules/identity/domain/authorization.ts:316-319` — `docarchive:read` READ_ONLY_ROLES;
  `docarchive:create`/`-upload`/`-review` WRITE_ROLES.
- `docs/frontend/p0-screen-inventory-plan.md:323-350` (A12 entry) — full data/action/state/connection
  requirements, most absent from the pre-revision spec.

Required revision: **applied to `A12-documento-detalhe.md` in this batch** — see the spec's revision
history note. Summary:
- Reconciled the route to `/app/:orgId/documents/:documentId`.
- Added an explicit action-by-role table for read/metadata-update/upload/review, and for review named
  the reviewer-or-admin nuance concretely: OWNER/ADMIN can decide any eligible version; a MEMBER can
  decide only a version they claimed themselves or one still unclaimed; a MEMBER facing another
  reviewer's claim sees no "Revisar" affordance at all (not a disabled one, to avoid implying a
  temporary block); VIEWER never sees write affordances.
- Extended "Revisar" to also cover UNDER_REVIEW rows the current actor claimed.
- Added files/scan/file-set-sealed/OCC/rejection-reason/claim-lost-or-expired states and named the
  3-step upload's resumability explicitly (which step completed, how to retry safely).
- Specified the mobile table→timeline transform and full-screen file preview with review-action
  parity.
- Distinguished RECEIVED from UNDER_REVIEW and ACCEPTED from SUPERSEDED visually (icon + secondary
  text alongside tone, not tone alone).
- Named a concrete motion decision (version-history rows animate on accept/reject at `motion.fast`;
  no motion on tab/panel switch) with a `prefers-reduced-motion` fallback.

Rendered-review checks to defer to the later gate:
- Whether the claim-aware "Revisar" absence (vs. a disabled control) reads as clear rather than
  confusing once rendered.
- Timeline legibility on mobile with a long version history and long PT-BR metadata values.
- Contrast/salience of RECEIVED vs. UNDER_REVIEW and ACCEPTED vs. SUPERSEDED once distinguished.
