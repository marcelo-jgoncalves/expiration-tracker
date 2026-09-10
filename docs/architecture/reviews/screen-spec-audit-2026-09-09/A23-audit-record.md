# A23 — Admin Activity Log — Screen Spec Audit Record

**Process note**: one BLIND Codex pass (batch 6/6, A22/A23/G01/G02 audited together in a single
prompt, `codex exec --skip-git-repo-check`) + one Claude reconciliation round.

**Reconciliation**: Claude's pre-Codex read flagged the spec's `Acesso: ADMIN+ (recomendado; dado
sensível...)` as a hedge, not a firm access rule, against the plan's unambiguous `activity:read`
(ADMIN_ROLES, "disclosure-sensitive, same tier as bulk export"). Codex's blind pass independently
reached the same conclusion, calling it "uma recomendação ambígua" and rating it Critical for
identical reasons (disclosure-sensitive data must not ship as a recommendation the implementer can
skip). Both reads converge; Codex's figures adopted with no adjustment. This is not counted as a
fifth CRITICAL RBAC over/under-grant (the *intended* role tier is correct — ADMIN+ — unlike A22's
actual tier mismatch), but the ambiguity itself is a disclosure-control defect serious enough to
score at Critical severity on this audit, since a hedged word ("recomendado") in a disclosure-
sensitive spec is exactly the kind of gap an implementer could reasonably read as optional.

---

Screen: A23 — Admin Activity Log / "Log de auditoria"
Route: `/audit-log` (spec, pre-revision) — canonical plan route: `/app/:orgId/activity`.
Primary task: business-readable "who did what, when" audit trail across the tenant.
Spec version/date: undated, audited 2026-09-10.

Functional score (applicable-only, renormalized): 27.2/100
Visual specification score: 32.0/100
Consolidated score: 29.1/100
Gate result: **NOT PASS** — RBAC axis scores 2/14 (Critical: hedged access rule), no
pagination/filter/loading/error states specified despite the log growing indefinitely, V6/V4/V5
each far below 60%.

Visual confidence: HIGH
Classification: SPEC AUDIT — rendered excellence not yet verified (rubric §0).

Perceptual reading order (as described or inferred):
1. PageHeader.
2. "Eventos" panel header (title + count).
3. Compact DataTable (Ator / Ação / Recurso / Quando).

D-247 axes (axis 6 marked N/A — no guest surface; 92 applicable points, renormalized):
1. Backend-to-interface completeness and traceability — 10/18 (four columns and the
   actor-removed/append-only rules are captured; no pagination cursor, no volume/growth handling
   despite the spec's own text flagging that the log "grows indefinitely").
2. Journey, navigation, and screen-graph coherence — 5/14 (route wrong entirely — `/audit-log` vs.
   plan's `/app/:orgId/activity`, not merely missing `:orgId`; "a recognized resource reference →
   that resource's own detail screen" connection from the plan is not specified).
3. RBAC-aware visibility and action model — **2/14 — Critical**: `ADMIN+ (recomendado)` is a hedge,
   not a firm rule, for `activity:read` which the plan states plainly as ADMIN_ROLES,
   "disclosure-sensitive, same tier as bulk export." MEMBER/VIEWER must be structurally unable to
   discover or view this screen/nav entry/data — "recommended" leaves that to implementer judgment.
4. State, feedback, and recovery coverage — 2/14 (no events yet / loading / error / cursor pagination
   / end-of-list / high-volume states are all named in the plan as required and all absent here;
   the spec's own text defers filters/pagination to "consider adding... in the real implementation"
   rather than specifying them now).
5. Multi-tenant organization context and isolation UX — 2/10 (no `:orgId` route; no statement on
   org-switch behavior for this data).
6. Guest/authenticated surface separation — N/A.
7. Responsive, mobile, and accessibility planning — 1/12 (plan explicitly requires a "timeline
   layout on mobile" for this screen; spec is silent on any responsive transform; no table
   caption/headers/scope, no reading-order note for narrow viewports).
8. Zero-context handoff quality and internal consistency — 3/10 (example data is good and concrete,
   but the deferred-filters/pagination note is itself an admission of incompleteness inside the spec).

V1 Hierarchy/composition:        9/20   (evidence level 1 — HIGH)
V2 Typography/data legibility:   6/13   (evidence level 2 — HIGH; no timezone stated for
  dates, no wrap/truncation rule for long action codes or resource descriptions)
V3 Rhythm/alignment/density:     7/14   (evidence level 2 — MEDIUM)
V4 Color/surface/depth:          1/11   (evidence level 0 — HIGH; no color/status treatment
  described at all beyond a plain compact table)
V5 Component/state craft:        2/12   (evidence level 0 — HIGH; no loading/empty/error states
  described despite D-247 axis 4 requiring them)
V6 Motion/continuity:            0/9    (evidence level 0 — HIGH)
V7 Product authorship:           6/17   (evidence level 1 — HIGH)  (counterfactual test: **fails** —
  substituting actor/action/resource for user/operation/item leaves `PageHeader + count + compact
  table`, indistinguishable from a generic admin audit log; capped at 8/17, scored 6)
V8 Coherence/auditability:       1/4    (evidence level 0 — MEDIUM)

Findings:
- Critical: `ADMIN+ (recomendado)` is a hedge on a disclosure-sensitive, ADMIN_ROLES-required screen
  — must be a firm access rule, not a recommendation.
- Major: route is wrong (`/audit-log` vs. plan's `/app/:orgId/activity`) — not just missing
  `:orgId`, the path segment itself diverges (SLF-03-adjacent but a distinct defect, recorded
  locally). No pagination/loading/empty/error/cursor/end-of-list states despite the spec's own text
  acknowledging unbounded growth. No responsive transform despite the plan's explicit requirement of
  a mobile timeline layout.
- Moderate: no timezone stated for timestamps; no wrap/truncation rule for long action codes or
  resource descriptions; no table semantics (caption/headers/scope) or narrow-viewport reading
  order; every event row given equal visual weight (no distinction for a sensitive action, e.g.
  `membership:role-change`, vs. a routine one); no motion/continuity treatment (SLF-02).
- Minor: append-only/read-only and the "Usuário removido" fallback for a deleted account are both
  correctly and concretely stated — a real strength, just not visually differentiated.

Design-system dispositions:
- SPEC GAP: RBAC hedge, wrong route, missing pagination/loading/error states, missing mobile
  timeline transform, missing timezone/truncation rules.
- SYSTEM GAP: SLF-02 (motion) — tracked centrally, not re-derived.
- SYSTEM EVOLUTION CANDIDATE: a reusable "growing audit-trail list" pattern (cursor pagination +
  filter bar + mobile timeline) would benefit any future audit/history screen — noted, not yet
  promoted (first confirmed instance on this screen alone).
- JUSTIFIED EXCEPTION: none.

Evidence excerpts (file:line):
- `docs/frontend/prototype-screen-specs/A23-log-auditoria.md:4` — `**Acesso:** ADMIN+ (recomendado;
  dado sensível de toda a organização)`.
- `docs/frontend/p0-screen-inventory-plan.md:560` — `activity:read` (ADMIN_ROLES — disclosure-
  sensitive, same tier as bulk export).
- `docs/frontend/p0-screen-inventory-plan.md:566` — "Responsive: full parity; timeline layout on
  mobile."

Required revision:
- Change `Acesso` to a firm `ADMIN_ROLES` statement (no "recomendado" hedge); state the screen/nav
  entry is fully hidden from MEMBER/VIEWER.
- Correct the route to `/app/:orgId/activity`.
- Specify: initial load, empty ("nenhum evento ainda"), error+retry, cursor-based pagination ("carregar
  mais" or infinite scroll — name one), end-of-list, and a stated approach for high event volume.
- Specify the required mobile timeline layout (not a shrunk table).
- Name a timezone convention for timestamps and a truncation/expansion rule for long action codes
  and resource descriptions.
- Add one concrete motion decision (or an explicit "no motion, because X").

Rendered-review checks to defer to the later gate:
- Whether the compact table's four-column density reads well at typical viewport widths once real
  long PT-BR names/CNPJ-bearing resource strings are substituted.
