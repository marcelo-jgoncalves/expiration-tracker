# A03 — Dashboard / Compliance Overview — Screen Spec Audit Record

**Process note**: one BLIND Codex pass + one Claude reconciliation round (D-249/D-250-style scope
reduction, named explicitly per session brief). This screen is one of the rubric's two named
hypothesis-confirmation targets (§5) — see `system-level-findings.md` SLF-01/SLF-02 for the
consolidated cross-screen findings this record feeds.

**Reconciliation**: Claude's independent read confirmed both of Codex's central conclusions: (1)
the 2026-09-09 storage-quota addendum's conditional 5th card (`p0-screen-inventory-plan.md`'s A03
entry) is entirely absent from the prototype spec, which predates that addendum and was never
updated; (2) the flat, equal-weight 4-card grid is the clearest concrete instance of the rubric's
first named hypothesis (metric-card pattern as generic-dashboard failure mode) — both auditors
independently capped V7 at the counterfactual ceiling. Claude's own draft scores (Functional
~46/92≈50, Visual ~32/100) were within a few points of Codex's on every axis; the largest gap was
V4 (Claude: 4/11 vs Codex: 3/11 — a negligible difference, both LOW/limited-intent readings) and
axis 4 (state coverage) where both independently landed at or near 0/14. This record adopts
Codex's figures as reconciled given its more granular per-axis justification and near-identical
bottom line.

---

Screen: A03 — Visão geral (Dashboard)
Route: `/dashboard` (spec) — canonical plan route: `/app/:orgId/dashboard` (see
`system-level-findings.md` SLF-03)
Primary task: identify what requires immediate tenant-wide compliance attention and navigate to the
relevant filtered work queue.
Spec version/date: prototype package as of 2026-09-09; predates and omits the 2026-09-09
storage-quota addendum to `p0-screen-inventory-plan.md`.

Functional score (applicable-only, renormalized): 54.3/100
Visual specification score: 36.0/100
Consolidated score: 47.0/100
Gate result: **NOT PASS** — FunctionalScore floor failed (54.3 < 90.0); VisualSpecScore floor
failed (36.0 < 85.0); ConsolidatedSpecScore floor failed (47.0 < 90.0); multiple axes below 60%;
world-class-ready V7 floor also fails (6 < 13.5).

Visual confidence: HIGH
Classification: SPEC AUDIT — rendered excellence not yet verified (rubric §0).

Perceptual reading order (as described or inferred):
1. Page title and organization-specific "needs attention now" framing.
2. Four equal-weight linked metric cards.
3. Compact urgency-sorted expiration table and "Ver todos os vencimentos" link.

D-247 axes (applicable / shared-system-level / N/A marked per criterion): 50/92 → normalized 54.3/100
1. Backend-to-interface completeness and traceability — APPLICABLE: 8/18 (4 real counters present;
   the required conditional storage-usage card/endpoint is absent)
2. Journey, navigation, and screen-graph coherence — APPLICABLE: 11/14
3. RBAC-aware visibility and action model — APPLICABLE: 14/14
4. State, feedback, and recovery coverage — APPLICABLE: 0/14 (no independent counter loading/
   failure/retry/unavailable/EMPTY_TRUE treatment)
5. Multi-tenant organization context and isolation UX — APPLICABLE: 6/10
6. Guest/authenticated surface separation — NOT APPLICABLE (authenticated-only)
7. Responsive, mobile, and accessibility planning — APPLICABLE: 8/12
8. Zero-context handoff quality and internal consistency — APPLICABLE: 3/10

V1 Hierarchy/composition:        10/20  (evidence level 2 — HIGH)
V2 Typography/data legibility:   6/13   (evidence level 2 — HIGH)
V3 Rhythm/alignment/density:     7/14   (evidence level 2 — HIGH)
V4 Color/surface/depth:          3/11   (evidence level 1 — HIGH)
V5 Component/state craft:        3/12   (evidence level 1 — HIGH)
V6 Motion/continuity:            0/9    (evidence level 0 — HIGH)
V7 Product authorship:           6/17   (evidence level 1-2 — HIGH)  (counterfactual test:
  **FAIL** — replacing product nouns leaves a generic four-equal-KPI-card-plus-table admin
  dashboard; capped at 8/17.)
V8 Coherence/auditability:       1/4    (evidence level 1 — HIGH)

Findings:
- Major: the required conditional storage-usage warning card (5th card, `WARNING`/`CRITICAL`/
  `OVER` only) is entirely absent — the spec predates the addendum.
- Major: all asynchronous states are absent — no independent per-counter loading/failure/retry, no
  genuine-zero (`EMPTY_TRUE`) treatment distinguished from an error.
- Major: the equal-weight four-card grid does not encode comparative temporal/compliance risk
  through layout — this is the confirmed instance of `system-level-findings.md` SLF-01.
- Major: no motion/transition/continuity treatment of any kind — confirmed instance of SLF-02.
- Moderate: route contradicts the canonical `/app/:orgId/dashboard` (SLF-03); table behavior on
  narrow viewports and under long/dense PT-BR data is unspecified; metric-card hover/focus/pressed/
  failure states and surface hierarchy are left to defaults.
- Minor: "contagem grande" has no named semantic typography role; spacing anchors, container width,
  and stable skeleton dimensions are unspecified.

Design-system dispositions:
- SPEC GAP: apply existing loading, actionable-error, empty-state, focus, semantic typography,
  responsive-table, motion, and reduced-motion guidance; add the storage-quota card required by the
  current plan.
- SYSTEM GAP: none independently established beyond SLF-01/SLF-02/SLF-03.
- SYSTEM CONSTRAINT: **the flat, structurally-identical metric-card grid — see
  `system-level-findings.md` SLF-01.** This screen is the confirming instance for that finding; the
  full remediation (a risk-prioritized compliance-summary pattern) is tracked there, not
  re-derived here.
- JUSTIFIED EXCEPTION: none.
- SYSTEM EVOLUTION CANDIDATE: tracked at SLF-01 (pattern-level remediation), not here.

Evidence excerpts (file:line):
- `docs/frontend/prototype-screen-specs/A03-dashboard.md:3` — route `/dashboard`, contradicts the
  canonical `/app/:orgId/dashboard`.
- `docs/frontend/prototype-screen-specs/A03-dashboard.md:10` — flat four-metric grid, 4→2→1 reflow.
- `docs/frontend/prototype-screen-specs/A03-dashboard.md:16` — compact table follows the metric
  grid with urgency-ordered rows.
- `docs/frontend/p0-screen-inventory-plan.md:180-181` (A03 entry) — counters must load/fail
  independently; a genuine-zero state must read as success.
- `docs/frontend/p0-screen-inventory-plan.md:185-192` (A03 storage-quota addendum) — required
  conditional 5th card, absent from the spec.

Required revision: **applied to `A03-dashboard.md` in this batch** — see the spec's revision
history note. Summary:
- Added the conditional storage-usage card per the addendum (`WARNING`/`CRITICAL`/`OVER` only,
  used/reserved/limit bar, OVER consequence copy, link to A19).
- Reconciled the route to `/app/:orgId/dashboard`.
- Specified independent loading/failure/retry/`EMPTY_TRUE` states per counter and for the attention
  table.
- Applied a **local, screen-level mitigation within the SYSTEM CONSTRAINT** (SLF-01): reordered and
  visually differentiated the 4 (or 5, conditionally) cards by severity rather than leaving them
  structurally identical — this does not redesign the shared metric-card component from within one
  screen's spec (that remains SLF-01's job), but does apply the legitimate local latitude the
  rubric's JUSTIFIED-EXCEPTION path allows while the system-level fix is pending.
- Named a concrete motion decision and semantic typography roles.

Rendered-review checks to defer to the later gate:
- Whether the revised hierarchy actually reads as risk-prioritized once rendered, without feeling
  artificially alarming.
- Contrast, focus visibility, and reflow at 320px with long PT-BR names and organization titles.
- Whether Operational Calm is preserved once the severity-differentiated cards are implemented.
