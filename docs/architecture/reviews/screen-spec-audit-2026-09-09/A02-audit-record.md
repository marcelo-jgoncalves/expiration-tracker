# A02 — Onboarding / Organization Picker / Invitation Acceptance — Screen Spec Audit Record

**Process note**: one BLIND Codex pass + one Claude reconciliation round (D-249/D-250-style
deliberate scope reduction, named explicitly per session brief).

**Reconciliation**: Claude's independent read converged with Codex's on the same verdict (NOT
PASS, wide margin) and the same two dominant root causes: (1) the primary task the plan assigns to
A02 — creating the first Organization — is explicitly placed "fora do escopo desta tela" with no
route, states, or contract, even though `p0-screen-inventory-plan.md` names organization creation
as one of A02's core purposes; (2) invitation/Membership state coverage is far short of the plan's
named states (already-accepted/revoked/expired/email-mismatch invitations; SUSPENDED/REMOVED
Membership; a previously-selected org that becomes inaccessible; eventual-consistency
"confirming…" state). Claude's own draft scores (Functional ~44/78≈56, Visual ~30/100) were close
to Codex's on every axis; Claude scored V1 slightly higher (card grid is at least legible and
consistently structured) and V7 the same (fails counterfactual, capped). This record adopts
Codex's figures as reconciled, given closer axis-by-axis granularity, with one adjustment: Claude
raises D-247 axis 6 (guest/authenticated separation) from Codex's SHARED-SYSTEM-LEVEL exclusion to
APPLICABLE at a modest score, since A02 is the one authenticated screen in this batch that sits
directly adjacent to the guest/authenticated boundary conceptually (a user arriving with zero
Memberships is functionally similar to an unauthenticated visitor) and the spec never states how
this boundary is visually distinguished from the guest surface — a genuine, if narrow, applicable
finding rather than a purely shared one.

---

Screen: A02 — Organizações / Onboarding
Route: `/organizations` (spec) — canonical plan routes: `/onboarding`, `/organizations`,
`/invitations/accept`
Primary task: choose an accessible Organization, act on a pending Invitation, or create the first
Organization.
Spec version/date: undated, audited 2026-09-09.

Functional score (applicable-only, renormalized): 46.8/100
Visual specification score: 35/100
Consolidated score: 42.1/100
Gate result: **NOT PASS** — FunctionalScore floor failed (46.8 < 90.0); VisualSpecScore floor
failed (35 < 85.0); ConsolidatedSpecScore floor failed (42.1 < 90.0); multiple axes below 60%;
unresolved Major (S3-equivalent) findings on the primary creation flow.

Visual confidence: HIGH
Classification: SPEC AUDIT — rendered excellence not yet verified (rubric §0).

Perceptual reading order (as described or inferred):
1. Logo/wordmark, then (conditionally) the pending-invitation block with its two actions.
2. Title, instruction, and the organization grid or empty state.
3. Footer explanation and "Criar organização" action.

D-247 axes (applicable / shared-system-level / N/A marked per criterion): 41/86 → normalized 46.8/100
1. Backend-to-interface completeness and traceability — APPLICABLE: 8/18
2. Journey, navigation, and screen-graph coherence — APPLICABLE: 9/14
3. RBAC-aware visibility and action model — NOT APPLICABLE (pre-tenant-context, no RBAC Actions)
4. State, feedback, and recovery coverage — APPLICABLE: 3/14
5. Multi-tenant organization context and isolation UX — APPLICABLE: 6/10
6. Guest/authenticated surface separation — APPLICABLE: 4/8 (reclassified from Codex's
   SHARED-SYSTEM-LEVEL — see reconciliation note above; the zero-Membership empty state is never
   visually distinguished from what a guest/unauthenticated visitor might see)
7. Responsive, mobile, and accessibility planning — APPLICABLE: 6/12
8. Zero-context handoff quality and internal consistency — APPLICABLE: 5/10

V1 Hierarchy/composition:        8/20   (evidence level 2 — HIGH)
V2 Typography/data legibility:   4/13   (evidence level 1 — HIGH)
V3 Rhythm/alignment/density:     7/14   (evidence level 2 — HIGH)
V4 Color/surface/depth:          5/11   (evidence level 2 — HIGH)
V5 Component/state craft:        5/12   (evidence level 2 — HIGH)
V6 Motion/continuity:            0/9    (evidence level 0 — HIGH)
V7 Product authorship:           4/17   (evidence level 1 — HIGH)  (counterfactual test: **FAIL**
  — replacing product nouns leaves a generic organization-picker/card-grid; capped at 8/17.)
V8 Coherence/auditability:       2/4    (evidence level 2 — HIGH)

Findings:
- Major (S3-equivalent): the primary task the plan assigns to A02 — organization creation — is
  placed out of scope with no route, form, validation, or return contract; `/onboarding` and
  `/invitations/accept` are unaddressed as distinct routes.
- Major (S3-equivalent): the plan's required invitation/Membership states (already-accepted,
  revoked, expired, email-mismatch; SUSPENDED/REMOVED Membership; a previously-selected org that
  becomes inaccessible; eventual-consistency "confirming…") are all absent.
- Moderate: invitation acceptance has a non-deterministic result ("navega/atualiza a lista") with
  no anti-double-submit, "confirming" state, restored focus, or recovery path; the fixed footer has
  no stated behavior at 320px, on-screen keyboard, or safe-area overlap.
- Moderate: the invitation block outranks the H1 in reading order with no stated rationale, and no
  behavior is defined for multiple simultaneous invitations or long organization names.
- Minor: "padding generoso," "texto pequeno," and border/background hover changes are not
  reviewable decisions (evidence ladder level 1); no wrapping/truncation rule for long PT-BR
  organization names; `tertiary` is not an approved Button variant (see `system-level-findings.md`
  SLF-04); the relative "3 dias" invitation expiry has no paired absolute date, so it ages silently.

Design-system dispositions:
- SPEC GAP: apply existing Skeleton/loading, actionable-error, explanatory-disabled, motion/
  reduced-motion, absolute+relative date, string-expansion, target-size, complete Button-state, and
  320px-reflow guidance; replace `tertiary` with `ghost` (SLF-04).
- SYSTEM GAP: none confirmed as specific to this screen beyond SLF-01/SLF-02/SLF-04 (shared log).
- SYSTEM CONSTRAINT: none confirmed.
- JUSTIFIED EXCEPTION: none.
- SYSTEM EVOLUTION CANDIDATE: none yet — the card-based org picker has not been authored with
  enough distinctiveness to justify promoting it as a reusable pattern.

Evidence excerpts (file:line):
- `docs/frontend/prototype-screen-specs/A02-onboarding.md:4` — "autenticado, sem AppShell" confirms
  pre-tenant positioning.
- `docs/frontend/prototype-screen-specs/A02-onboarding.md:10` — invitation block only describes the
  pending case, no failure/processing variants.
- `docs/frontend/prototype-screen-specs/A02-onboarding.md:34` — organization creation declared out
  of scope.
- `docs/frontend/prototype-screen-specs/A02-onboarding.md:35` — acceptance result described as
  "navega/atualiza," non-deterministic.
- `docs/frontend/p0-screen-inventory-plan.md:156-169` (A02 entry) — canonical routes and required
  invitation/Membership states.

Required revision: **applied to `A02-onboarding.md` in this batch** — see the spec's revision
history note. Summary:
- Specified `/onboarding` (creation), `/organizations` (picker), and `/invitations/accept` as three
  named, connected states of one screen, including a full organization-creation form contract.
- Named all plan-required invitation/Membership states with concrete UI treatment.
- Replaced `tertiary` with `ghost` and gave the invitation-priority ordering an explicit rationale.
- Added a motion decision (acceptance "confirming" transition, reduced-motion equivalent).
- Authored a screen-specific visual thesis distinguishing "a place you're choosing to work" from a
  generic list-picker (see the revised spec's "Tese visual" note) — a local improvement; the
  underlying card-grid pattern itself remains tracked in `system-level-findings.md` where relevant
  (this screen's card grid is a different, simpler shape than A03/A09's metric-card grid, so SLF-01
  does not directly apply here — noted to avoid falsely importing that finding).

Rendered-review checks to defer to the later gate:
- Optical balance between invitation block, title, grid, and footer with/without organizations.
- Contrast of the 0.6-opacity suspended cards and focus visibility across all surfaces.
- Long organization-name wrapping and role-label legibility at 320px and at zoom.
- Whether the whole card reads as clickable vs. a static panel once rendered.
