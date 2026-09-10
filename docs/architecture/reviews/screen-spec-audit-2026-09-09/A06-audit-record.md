# A06 — Reminder Policy — Screen Spec Audit Record

**Process note**: one BLIND Codex pass (`codex exec --skip-git-repo-check`,
`codex-out-A06.txt`) + one Claude reconciliation round.

**Reconciliation**: Claude's independent read agreed with Codex's central conclusion — the spec
describes only "edit offsets and save," not the full create/view/edit/disable lifecycle the plan
names, and every named backend state (no-policy-yet, disabled, OCC conflict, scheduler-unavailable)
is absent. Claude's own draft scores (Functional ~35/100, Visual ~29/100) were within a few points of
Codex's (38/100, 31/100); this record adopts Codex's figures as reconciled given near-identical
bottom line and more granular per-axis justification.

---

Screen: A06 — Política de lembrete (Reminder Policy, per Expiration)
Route: `/expirations/:id/reminders` (spec, pre-revision) — canonical plan route:
`/app/:orgId/expirations/:itemId/reminders/:policyId?`
Primary task: create, view, edit, or disable the reminder policy for one `ExpirationItem`.
Spec version/date: undated, audited 2026-09-09.

Functional score (applicable-only, renormalized): 38.0/100
Visual specification score: 31.0/100
Consolidated score: 35.2/100
Gate result: **NOT PASS** — all three floors fail; axes 1/2/4/5/7/8 below 60%; unresolved Critical
tenant-routing finding and Major lifecycle-coverage gap.

Visual confidence: HIGH
Classification: SPEC AUDIT — rendered excellence not yet verified (rubric §0).

Perceptual reading order (as described or inferred):
1. Page title/description distinguishing "when" from "how" reminders work, Save action.
2. "When to notify" offset list with add/remove.
3. Channel availability list, then an informational quiet-hours notice.

D-247 axes (applicable / shared-system-level / N/A marked per criterion): 35/92 → normalized 38.0/100
1. Backend-to-interface completeness and traceability — APPLICABLE: 6/18 (policy id, enabled flag,
   create-vs-update distinction, disable action, and persistence contract are all absent)
2. Journey, navigation, and screen-graph coherence — APPLICABLE: 7/14 (`:orgId`/`:itemId`/
   `:policyId` params missing from route)
3. RBAC-aware visibility and action model — APPLICABLE: 11/14 (VIEWER correctly read-only; missing
   only explicit enable/disable/creation tiering)
4. State, feedback, and recovery coverage — APPLICABLE: 2/14 (no-policy/disabled/OCC-conflict/
   scheduler-unavailable/loading/save-success/save-failure states all unaddressed)
5. Multi-tenant organization context and isolation UX — APPLICABLE: 2/10 (`:orgId` missing; no
   tenant-boundary behavior stated)
6. Guest/authenticated surface separation — SHARED-SYSTEM-LEVEL (authenticated-only screen)
7. Responsive, mobile, and accessibility planning — APPLICABLE: 3/12 (single-column width stated;
   the plan's required "sequence editor as vertical list on mobile" has zero concrete detail)
8. Zero-context handoff quality and internal consistency — APPLICABLE: 4/10 (wrong route, an
   "active policy" notice with no enabled/disabled state model behind it, `tertiary` variant)

V1 Hierarchy/composition:        8/20   (evidence level 1-2 — HIGH)
V2 Typography/data legibility:   3/13   (evidence level 1 — HIGH)
V3 Rhythm/alignment/density:     5/14   (evidence level 1-2 — HIGH)
V4 Color/surface/depth:          3/11   (evidence level 1 — HIGH)
V5 Component/state craft:        6/12   (evidence level 2 — MEDIUM)
V6 Motion/continuity:            0/9    (evidence level 0 — HIGH)
V7 Product authorship:           5/17   (evidence level 1 — HIGH)  (counterfactual test: **FAIL** —
  replacing "aviso"/"vencimento" with generic placeholders leaves an indistinguishable settings-list
  template with no domain-specific structure; capped at 8/17, scored 5.)
V8 Coherence/auditability:       1/4    (evidence level 1 — HIGH)

Findings:
- Critical: route omits `/app/:orgId` and `:policyId?`, breaking both the tenant-isolation contract
  and the create-vs-edit-existing-policy distinction the plan requires.
- Major: the screen only edits an offset list and saves — no explicit creation flow for a first
  policy, no enabled/disabled lifecycle, no disable/re-enable control despite "disable" being named
  as a first-class purpose in the plan.
- Major: none of the plan's named states (no policy yet, disabled, OCC conflict, scheduler
  dependency unavailable) have any UI representation.
- Major: "Remover" uses the undefined `tertiary` Button variant (SLF-04 cross-ref, third occurrence
  in this batch).
- Moderate: the fixed `InlineNotice` "Política ativa" is stated unconditionally, contradicting the
  absence of an actual enabled/disabled state model — the copy asserts a state the spec never defines.
- Moderate: status badges name tone but not icon, so the non-color-alone rule is only partially met.
- Moderate: no motion/transition treatment anywhere (SLF-02 cross-ref).
- Minor: offset duplicate-prevention, ordering, and singular/plural formatting are unspecified.

Design-system dispositions:
- SPEC GAP: canonical route with `:policyId?`, full policy lifecycle (create/enable/disable),
  required states, save/loading/success/failure feedback, mobile sequence-editor detail, motion.
- SYSTEM CONSTRAINT: `tertiary` not an approved variant (SLF-04 cross-reference, not reopened).
- SYSTEM CONSTRAINT: WhatsApp must remain visibly unavailable/non-interactive — the spec's treatment
  of this specific point is already correct and should be preserved through revision (a rare case of
  the pre-revision spec being right about a specific G5-adjacent detail).
- JUSTIFIED EXCEPTION: none.
- SYSTEM EVOLUTION CANDIDATE: none newly opened — the OCC-conflict/idempotent-action pattern
  candidate named in A05's record would also apply here if confirmed in a later batch.

Evidence excerpts (file:line, pre-revision spec):
- `docs/frontend/prototype-screen-specs/A06-politica-lembrete.md:3` (pre-revision) — route
  `/expirations/:id/reminders`, no `:orgId`/`:policyId` (SLF-03 cross-ref).
- `docs/frontend/prototype-screen-specs/A06-politica-lembrete.md:11` (pre-revision) — `tertiary`
  variant on "Remover" (SLF-04 cross-ref).
- `docs/frontend/prototype-screen-specs/A06-politica-lembrete.md:15` (pre-revision) — unconditional
  "Política ativa" notice with no enabled/disabled state behind it.
- `docs/frontend/p0-screen-inventory-plan.md:227-238` (A06 entry) — full create/view/edit/disable
  purpose and named states, most absent from the pre-revision spec.

Required revision: **applied to `A06-politica-lembrete.md` in this batch** — see the spec's revision
history note. Summary:
- Reconciled the route to `/app/:orgId/expirations/:itemId/reminders/:policyId?`.
- Added a "Política ativa" toggle (real enable/disable control, preserving offsets when disabled)
  and named all missing states (no-policy-yet, disabled, OCC conflict, scheduler-unavailable, save
  loading/success/failure).
- Resolved offsets against the item's real due date in the "when to notify" list instead of showing
  an abstract number list (product-specific authorship fix for V7).
- Replaced `tertiary` with `ghost`, added icons to channel StatusBadges.
- Named a concrete motion decision for add/remove/toggle transitions with a `prefers-reduced-motion`
  fallback.

Rendered-review checks to defer to the later gate:
- Whether the resolved-offset dates ("30 dias antes · 12/12/2026") read as helpful or noisy once
  rendered against the reading-width container.
- Focus-restoration behavior in the browser when adding/removing an offset.
