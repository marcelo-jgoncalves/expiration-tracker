# A16 — Reports & Exports — Screen Spec Audit Record

**Process note**: one BLIND Codex pass (batch 4/6, A14/A15/A16/A17 audited together in a single
prompt) + one Claude reconciliation round.

**Reconciliation**: this is the batch's most severe finding. Claude's own independent pre-Codex read
had already flagged the RBAC line as suspicious ("todos os papéis para baixar/ver" against a plan
that names `item:export`/`docarchive:requirement-export`/`reports:subscription-manage` as
ADMIN_ROLES-only); Codex's blind pass independently reached the same conclusion with equal severity
(CRITICAL, not Major) and additionally flagged that "Editar"/"Remover" inherit the over-grant with no
separate guard, and that the narrow named-recipient exception the plan requires is simply replaced by
blanket access rather than coexisting with it. Codex's figures (Functional 21.7, Visual 31.0,
Consolidated 25.4) are adopted as-is — this is now the second CRITICAL RBAC finding of the full
24-screen audit project (task brief's calibration note).

**Real-mechanics verification (task-specific requirement)**: CONFIRMED — G3 (D-248) closed all 7
`GET /reports/*` BFF proxy routes (`content-disposition`/`x-report-truncated` header forwarding). The
pre-revision spec already presented the 7 downloads as unconditionally functional (no
blocked/uncertain language), so confirmation (b) from the audit prompt is **partially true on
operability** but **fails on scope** — the spec's RBAC line was critically wrong regardless of the
downloads being real.

---

Screen: A16 — Reports & Exports / "Relatórios e exportações"
Route: `/reports` (spec, pre-revision) — canonical plan route: `/app/:orgId/reports`
Primary task: download 7 fixed CSV compliance reports; manage scheduled `ReportSubscription`s.
Spec version/date: undated, audited 2026-09-10.

Functional score (applicable-only, renormalized): 21.7/100
Visual specification score: 31.0/100
Consolidated score: 25.4/100
Gate result: **NOT PASS** — CRITICAL RBAC over-grant findings; multiple axes far below 60%.

Visual confidence: HIGH
Classification: SPEC AUDIT — rendered excellence not yet verified (rubric §0).

Perceptual reading order (as described or inferred):
1. Report catalog grid (7 equal cards).
2. Subscriptions panel (table).

D-247 axes (axis 6 marked N/A — no guest surface; 92 applicable points):
1. Backend-to-interface completeness and traceability — 8/18 (all 7 reports and subscription concept
   are named; run history, per-run download links, and truncation/expiry states are absent).
2. Journey, navigation, and screen-graph coherence — 5/14 (no deep links back to A04/A11 with
   equivalent filters, despite the plan naming this connection explicitly).
3. RBAC-aware visibility and action model — **0/14 — CRITICAL**: "todos os papéis para baixar/ver;
   criar assinatura MEMBER+" grants MEMBER/VIEWER a tenant-wide ADMIN_ROLES-only export/subscription
   action; the plan's narrow named-recipient-per-run exception is entirely absent, replaced by
   blanket access.
4. State, feedback, and recovery coverage — 1/14 (empty report, generation/download failure,
   truncated CSV, expired-but-regenerable URL, deleted subscription, and orphaned-run-still-
   accessible-to-past-recipient are all absent).
5. Multi-tenant organization context and isolation UX — 1/10 (route omits `:orgId`).
6. Guest/authenticated surface separation — N/A.
7. Responsive, mobile, and accessibility planning — 2/12 (card grid is responsive by construction;
   subscriptions table and the required keyboard-searchable recipient editor have no mobile/a11y
   treatment).
8. Zero-context handoff quality and internal consistency — 3/10 (structure is legible, but the RBAC
   and variant contradictions force implementer invention of the actual security model).

V1 Hierarchy/composition:        7/20   (evidence level 2 — HIGH)
V2 Typography/data legibility:   5/13   (evidence level 2 — HIGH)
V3 Rhythm/alignment/density:     6/14   (evidence level 2 — HIGH)
V4 Color/surface/depth:          3/11   (evidence level 1 — HIGH)
V5 Component/state craft:        4/12   (evidence level 2 — HIGH)
V6 Motion/continuity:            0/9    (evidence level 0 — HIGH)
V7 Product authorship:           4/17   (evidence level 2 — HIGH)  (counterfactual test: **FAIL** —
  seven equal action cards followed by a settings table remains a generic admin template regardless
  of the specific report names; capped at 8/17, scored 4 — the lowest V7 score of this batch.)
V8 Coherence/auditability:       2/4    (evidence level 2 — HIGH)

Findings:
- **Critical — RBAC over-grant**: "todos os papéis para baixar/ver" grants MEMBER and VIEWER a
  tenant-wide `item:export`/`docarchive:requirement-export` action that is ADMIN_ROLES-only per plan.
- **Critical — RBAC over-grant**: "criar assinatura MEMBER+" grants `reports:subscription-manage` to
  MEMBER; the action is ADMIN_ROLES-only.
- **Critical**: "Editar"/"Remover" have no independent role guard and inherit the over-grant from the
  screen-level access line.
- **Critical**: the narrow named-recipient-per-run exception required by the plan does not exist in
  the spec — it is replaced by blanket "todos os papéis" access, which is a strictly broader and
  incorrect grant, not a narrower one.
- Major: missing empty report, generation/download failure, truncated CSV+header signal, expired-but-
  regenerable presigned URL, deleted subscription, and orphaned-run-accessible-to-past-recipient
  states.
- Major: no run history or per-run download links, despite being required data.
- Major: keyboard-searchable recipient editor not specified.
- Major: card responsiveness alone does not satisfy "full parity" — subscriptions table/editor have
  no mobile/a11y treatment.
- Moderate: no deep links back to A04/A11 with equivalent filters.
- Moderate — SLF-03: route omits `/app/:orgId`.
- Moderate — SLF-04: "Editar"/"Remover" used `tertiary`; "Remover" should be `danger` (destructive).
- Moderate: seven structurally identical cards show minimal risk-oriented hierarchy — related to the
  SLF-01 pattern family (flat equal-weight grids), though these are action cards, not metric cards;
  tracked here as a local finding, not promoted to SLF-01 itself.

Design-system dispositions:
- SPEC GAP: correct ADMIN_ROLES-only scoping with the narrow named-recipient exception, run history,
  truncation/expiry/orphaned-run states, `:orgId`-qualified route, `danger` variant on destructive
  removal, mobile/a11y treatment for the subscription editor, motion decision.
- SYSTEM GAP: none newly identified beyond SLF-02/03/04.
- SYSTEM CONSTRAINT: none.
- JUSTIFIED EXCEPTION: none.
- SYSTEM EVOLUTION CANDIDATE: the flat 7-card report catalog is a candidate instance of the SLF-01
  family (equal-weight grid with no risk-based hierarchy) but is not itself a metric-card grid — not
  merged into SLF-01, tracked as a related local finding pending a third confirmed non-metric-card
  instance before considering a broader definition of SLF-01.

Evidence excerpts (file:line, pre-revision spec):
- `docs/frontend/prototype-screen-specs/A16-relatorios-exportacoes.md:3-4` (pre-revision) —
  "todos os papéis para baixar/ver; criar assinatura MEMBER+" (the CRITICAL over-grant).
- `docs/frontend/prototype-screen-specs/A16-relatorios-exportacoes.md:23` (pre-revision) — "Editar" +
  "Remover" both `tertiary`, no role guard named.
- `docs/frontend/p0-screen-inventory-plan.md:411-430` (A16 entry) — G3-closed BFF proxy confirmation,
  ADMIN_ROLES-only action scoping, and the narrow named-recipient-per-run exception, none reflected
  pre-revision.

Required revision: **applied to `A16-relatorios-exportacoes.md` in this batch**. Summary:
- Corrected access line to ADMIN_ROLES-only for downloads and subscription management, with the
  narrow named-recipient-per-run exception stated explicitly and separately from the tenant-wide
  grant.
- Added a MEMBER/VIEWER `EmptyState` view (no catalog with disabled buttons).
- Added empty report, truncated CSV (via header), generation/download failure, expired-but-
  regenerable presigned URL, deleted-subscription, and orphaned-run-accessible-to-past-recipient
  states, plus a per-subscription run-history drawer.
- Replaced `tertiary` with `ghost` (Editar) / `danger` (Remover).
- Grouped the 7 report cards into two named subsections (Vencimentos / Requisitos) as a minimal
  risk-oriented differentiation within the SLF-01-adjacent flat-grid constraint.
- Added deep-link connection back to A04/A11 with equivalent filters, mobile/a11y treatment for the
  subscriptions table and recipient editor, and a motion decision.

Rendered-review checks to defer to the later gate:
- Whether the two-subsection grouping of report cards reads as meaningfully differentiated once
  rendered, or still feels like a flat grid in practice.
- Legibility/behavior of the run-history drawer with realistic run counts and long recipient lists.
