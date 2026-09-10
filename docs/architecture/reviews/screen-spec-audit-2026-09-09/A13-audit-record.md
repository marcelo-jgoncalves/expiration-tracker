# A13 — Review Queue — Screen Spec Audit Record

**Process note**: one BLIND Codex pass (`codex exec --skip-git-repo-check`, prompt/output archived in
session scratchpad) + one Claude reconciliation round.

**Real-route-mechanics verification (task-specific requirement)**: CONFIRMED CORRECT. G2 (D-248) closed
`GET /document-archive/reviews?state=RECEIVED|UNDER_REVIEW` — `listReviewQueue`
(`document-archive-service.ts:843-859`) takes exactly one `state` per call against GSI5's per-state
partitioning; there is no server-side merged "ALL" mode. A13's spec uses exactly two tabs
("Recebidas"/"Em revisão") mapping 1:1 onto `RECEIVED`/`UNDER_REVIEW` — this is structurally
compatible with the real mechanics and does **not** assume an invalid merged query. Both Claude's and
Codex's independent reads reached this conclusion. The spec's defect here is that it never explicitly
states the per-tab-one-state-per-call contract or independent pagination/loading-per-tab — a
completeness gap, not a design defect.

**Reconciliation**: Codex's blind pass caught a real RBAC defect Claude's own draft had flagged more
softly: the spec's "Já reivindicado por outro revisor" rule unconditionally hides the entire action
bar, but `assertReviewerOrAdmin` (`document-archive-service.ts:2710-2718`) makes OWNER/ADMIN always
able to decide any version regardless of who claimed it — the spec as written would hide legitimate
administrative review actions from OWNER/ADMIN. Treated as Major (under-granting/misleading UI,
degrades gracefully rather than over-granting — same severity class as A12's analogous finding this
batch). Claude's own draft scores (Functional ~36/100, Visual ~38/100) were close to Codex's
(37.8/100, 41.0/100); this record adopts Codex's figures as reconciled.

---

Screen: A13 — Review Queue (Fila de revisão)
Route: `/reviews` (spec, pre-revision) — canonical plan route: `/app/:orgId/reviews`
Primary task: discover, claim, inspect, and decide (accept/reject) `DocumentVersion`s in
RECEIVED/UNDER_REVIEW state.
Spec version/date: undated, audited 2026-09-09.

Functional score (applicable-only, renormalized): 37.8/100
Visual specification score: 41.0/100
Consolidated score: 39.1/100
Gate result: **NOT PASS** — Functional floor failed (37.8 < 90.0); Visual floor failed
(41.0 < 85.0); Consolidated floor failed (39.1 < 90.0); multiple axes below 60%; unresolved Major
findings.

Visual confidence: HIGH
Classification: SPEC AUDIT — rendered excellence not yet verified (rubric §0).

Perceptual reading order (as described or inferred):
1. Queue-state tabs (Recebidas/Em revisão) and compact list.
2. Selected item's document/Subject/provenance/scan/reviewer detail.
3. Claim/open actions (left) and reject/accept decision actions (right).

D-247 axes (applicable / shared-system-level / N/A marked per criterion): 31/82(*) → normalized
37.8/100 (*axes 5 and 6 both SHARED-SYSTEM-LEVEL/excluded per Codex's blind read — org context is an
AppShell-level convention here and the screen has no guest surface — applicable base is 82 points.)
1. Backend-to-interface completeness and traceability — APPLICABLE: 10/18 (the two real queue states
   and core claim/decision actions are correctly modeled; Subject, scan counters, proposed validity,
   pagination/cursor, and a structured rejection-reason input are absent; the tab design is compatible
   with the real one-state-per-call mechanic but never says so explicitly — see verification above).
2. Journey, navigation, and screen-graph coherence — APPLICABLE: 7/14 ("Abrir documento" exists; entry
   from A03, a version-focused A12 destination, post-decision advance-to-next-item/return-to-A12, and
   mobile list→detail sequencing are all unaddressed; route omits `/app/:orgId`).
3. RBAC-aware visibility and action model — APPLICABLE: 7/14 (**Major**: unconditionally hides the
   action bar from OWNER/ADMIN when another reviewer claimed the item — the service explicitly allows
   OWNER/ADMIN to decide any version; VIEWER-read-only is otherwise correctly stated).
4. State, feedback, and recovery coverage — APPLICABLE: 2/14 (empty queue, initial selection, tab-
   reset, and claimed-by-other notice are named; loading, fetch failure/retry, claim/decision
   conflict, claim expiry, scan-infected/pending-as-blocking, closed-set rejection reason + OTHER,
   pagination exhaustion, and post-decision recovery are all absent).
5. Multi-tenant organization context and isolation UX — SHARED-SYSTEM-LEVEL (AppShell-level
   convention; the incomplete route is still penalized under axes 2/8).
6. Guest/authenticated surface separation — SHARED-SYSTEM-LEVEL ("Solicitação (guest)" is submission
   provenance text, not a guest surface on this screen).
7. Responsive, mobile, and accessibility planning — APPLICABLE: 2/12 (only the clickable-row pattern
   and horizontal filter scroll are concrete; no mobile list→detail sequence, keyboard row-selection
   model, focus transfer/restoration, accessible tab semantics, live announcements, or target-size
   rule, despite full mobile parity being explicitly required by the plan).
8. Zero-context handoff quality and internal consistency — APPLICABLE: 3/10 (basic desktop anatomy
   and sample data are usable; the route and RBAC contradictions plus missing operational states force
   implementer invention).

V1 Hierarchy/composition:        11/20  (evidence level 2 — HIGH)
V2 Typography/data legibility:   5/13   (evidence level 2 — HIGH)
V3 Rhythm/alignment/density:     7/14   (evidence level 2 — HIGH)
V4 Color/surface/depth:          4/11   (evidence level 2 — HIGH)
V5 Component/state craft:        5/12   (evidence level 2 — HIGH)
V6 Motion/continuity:            0/9    (evidence level 0 — HIGH)
V7 Product authorship:           7/17   (evidence level 2 — HIGH)  (counterfactual test: **FAIL** —
  replacing "documento"/"fornecedor"/"revisor" and the review states with "Item"/"Category"/"Owner"
  leaves a conventional tabs+table+detail+action-bar admin workflow; scan/provenance/reviewer data
  supply domain nouns but don't shape a distinctive evidence-review operating model; capped at 8/17,
  scored 7.)
V8 Coherence/auditability:       2/4    (evidence level 2 — HIGH)

Findings:
- Critical: none — no cross-tenant/guest data exposure; backend remains authoritative regardless of
  what the UI shows or hides.
- Major: action bar is unconditionally hidden from OWNER/ADMIN when another reviewer claimed the
  item, contradicting `assertReviewerOrAdmin`'s explicit OWNER/ADMIN bypass — this denies legitimate
  administrative review actions.
- Major: operational-state coverage is grossly incomplete — scan infected/pending-as-blocking, claim
  expiry, concurrent claim/decision conflict, structured rejection-reason validation, loading/error/
  retry, and post-decision progression are all absent.
- Major: no mobile list→detail sequence or keyboard/focus/announcement model, despite full mobile
  parity being explicitly required by the plan's A13 entry.
- Moderate: Subject, scan counters, proposed validity, and pagination are missing from the data
  contract.
- Moderate: route omits `/app/:orgId` (SLF-03 cross-ref).
- Moderate: entry from A03, a version-focused A12 destination, and post-decision next-item/return-to-
  A12 behavior are all unspecified.
- Moderate: selected/hover/focus/pressed/disabled/loading/error/success row and action-bar states are
  unspecified.
- Minor: the warning tone applied uniformly to every claimed item conflates normal single-reviewer
  ownership with a genuine cross-reviewer conflict — these deserve distinct visual semantics,
  especially once the OWNER/ADMIN-bypass fix (above) is applied.
- Minor: "linha inteira é um botão" inside a `DataTable` risks nested-interactive-control markup —
  needs an explicit row-selection semantics decision, not an ad hoc `<button>` wrapper.

Design-system dispositions:
- SPEC GAP: correct OWNER/ADMIN-aware action-bar logic, full operational-state coverage, mobile
  list→detail transform, keyboard/focus/announcement model, tenant-scoped route, typography/legibility
  treatment for long PT-BR names, motion decision.
- SYSTEM GAP: a reusable "claim-aware action-eligibility" pattern (MEMBER-claim-ownership vs.
  OWNER/ADMIN-override, distinctly represented) would generalize across A12/A13 — same candidate
  named in A12's audit record this batch, now confirmed relevant on a second screen; still short of
  the rubric's 3-screen recurrence bar, tracked here as a cross-reference rather than promoted yet.
- SYSTEM CONSTRAINT: none proven from A13 alone.
- JUSTIFIED EXCEPTION: the full-width stacked list-above-detail layout (rather than side-by-side
  split panel) is accepted as a locally justified desktop choice per the spec's own stated rationale
  — pending confirmation at the rendered-review gate that it actually improves evidence inspection
  over a split panel; its mobile list→detail transform still needs to be specified.
- SYSTEM EVOLUTION CANDIDATE: a reusable operational-queue pattern (state-partitioned fetch per tab,
  stable selection, claim ownership + administrative override, decision readiness, automatic
  advancement after disposition) spanning A12/A13 — candidate, not yet promoted.

Evidence excerpts (file:line, pre-revision spec):
- `docs/frontend/prototype-screen-specs/A13-fila-revisao.md:3-6` (pre-revision) — abbreviated route,
  coarse RBAC line, full-width stacked layout.
- `docs/frontend/prototype-screen-specs/A13-fila-revisao.md:11-18` (pre-revision) — two
  singular-state tabs matching the real backend mechanic (correct, per verification above).
- `docs/frontend/prototype-screen-specs/A13-fila-revisao.md:23` (pre-revision) — unconditional
  "oculta a barra de ações" when claimed by another reviewer.
- `src/modules/document-archive/application/document-archive-service.ts:843-859` — `listReviewQueue`
  takes exactly one `state` per call against GSI5 (confirms tab design correctness).
- `src/modules/document-archive/application/document-archive-service.ts:2705-2718` —
  `assertReviewerOrAdmin`: OWNER/ADMIN always bypass claim ownership.
- `docs/frontend/p0-screen-inventory-plan.md:352-370` (A13 entry) — G2-closed route mechanic, full
  data/action/state/connection requirements, most absent from the pre-revision spec.

Required revision: **applied to `A13-fila-revisao.md` in this batch** — see the spec's revision
history note. Summary:
- Reconciled the route to `/app/:orgId/reviews`.
- Made the one-state-per-call contract explicit: each tab issues its own paginated
  `GET .../reviews?state=...` call with independent loading/error/cursor state; no merged "ALL" tab.
- Rewrote the action-eligibility rule by effective role: VIEWER inspects only; MEMBER can accept/
  reject only when unclaimed or claimed by themself; OWNER/ADMIN can always accept/reject any eligible
  version, including one claimed by another reviewer (shown with ownership context, not hidden).
  Claim itself remains available only on a claimable RECEIVED item.
- Added Subject, scan counters/status, proposed validity, and pagination to the data contract.
- Specified decision-readiness gating (disable/explain acceptance while scans are pending/infected),
  claim-expiry, and concurrent-claim/decision conflict recovery.
- Specified rejection as a validated flow using the closed reason set plus conditional `OTHER`.
- Added loading/empty/fetch-error-retry/claim-in-progress/claim-conflict/decision-in-progress/
  decision-conflict/success/post-decision-next-item states.
- Defined the mobile list→detail sequence with full action parity, and replaced the ad hoc clickable-
  row `<button>` wrapper with an explicit row-selection semantics decision (selected `aria-selected`
  row + accessible name, not a nested interactive control).
- Named a concrete motion decision (selection change is instantaneous; a decided item's row fades out
  at `motion.normal` before advancing selection) with a `prefers-reduced-motion` fallback.

Rendered-review checks to defer to the later gate:
- Whether the full-width stacked list/detail layout actually reads better than a split panel once
  rendered with realistic queue lengths (the JUSTIFIED EXCEPTION above is pending this check).
- Contrast/salience distinguishing normal single-reviewer ownership from genuine claim conflict once
  the OWNER/ADMIN-bypass fix changes when the warning tone should even appear.
- Legibility of long PT-BR document/Subject/reviewer names at supported widths.
- Focus behavior and layout stability during tab switches, claims, and decisions.
