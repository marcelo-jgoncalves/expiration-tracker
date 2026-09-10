# A01 — Sign-in / Session — Screen Spec Audit Record

**Process note**: one BLIND Codex pass (`codex exec --skip-git-repo-check`, full transcript at
`.codex-out-A01.txt` locally, not committed — see reconciliation below) + one Claude reconciliation
round, not the full 3-round Claude↔Codex protocol — the same deliberate scope reduction already
used and named explicitly in D-249/D-250, applied here to a docs-only audit task per the session
brief.

**Reconciliation**: Claude's independent read of `A01-sign-in.md` against the rubric (formed before
reading Codex's numbers in full, informed only by the same source documents) converged on the same
verdict — NOT PASS by a wide margin, driven by the same two root causes: (1) the spec only covers
the mock `/sign-in` screen and never addresses the other two routes (`/auth/callback`,
`/session-expired`) and states the mock login "always fails" with no real success/redirect logic
specified; (2) the visual direction is an unremarkable split-screen login template whose only
product-specific content is copy in a decorative, `aria-hidden` aside — this fails the V7
counterfactual test outright. Claude's own draft scores (Functional ~49/90≈54, Visual ~36/100)
landed within a few points of Codex's on every axis except V2 (Claude: 4/13, Codex: 5/13, both LOW
concrete-decision credit) and V6 (both converged on near-zero — motion is entirely unaddressed).
Given the convergence, this record adopts Codex's per-axis figures as the reconciled score, since
its axis-by-axis reasoning was more granular and it independently arrived at nearly the same
numbers.

---

Screen: A01 — Entrar (Sign In)
Route: `/sign-in` (spec) — canonical plan routes: `/login`, `/auth/callback`, `/session-expired`
Primary task: Authenticate an unauthenticated user and route successful access toward organization
onboarding/selection (A02) or the authenticated dashboard (A03).
Spec version/date: undated repository version, audited 2026-09-09.

Functional score (applicable-only, renormalized): 54.4/100
Visual specification score: 44/100
Consolidated score: 50.2/100
Gate result: **NOT PASS** — FunctionalScore floor failed (54.4 < 90.0); VisualSpecScore floor
failed (44 < 85.0); ConsolidatedSpecScore floor failed (50.2 < 90.0); V2/V3/V4/V5/V6/V7/V8 all
below 60% of their available points; unresolved Major findings remain.

Visual confidence: HIGH
Classification: **SPEC AUDIT — rendered excellence not yet verified.** This record scores visual
specification readiness only (rubric §0); it makes no claim about how the screen will look once
implemented/rendered.

Perceptual reading order (as described or inferred):
1. Brand mark, then (conditionally) the critical error notice after a failed attempt.
2. "Entrar" heading, supporting sentence, credential fields, primary submit action.
3. Invitation help-link footer; on desktop, the decorative dark aside (outside the tab order).

D-247 axes (applicable / shared-system-level / N/A marked per criterion): 49/90 → normalized 54.4/100
1. Backend-to-interface completeness and traceability — APPLICABLE: 7/18
2. Journey, navigation, and screen-graph coherence — APPLICABLE: 7/14
3. RBAC-aware visibility and action model — APPLICABLE: 13/14
4. State, feedback, and recovery coverage — APPLICABLE: 5/14
5. Multi-tenant organization context and isolation UX — NOT APPLICABLE (pre-org context)
6. Guest/authenticated surface separation — APPLICABLE: 7/8
7. Responsive, mobile, and accessibility planning — APPLICABLE: 6/12
8. Zero-context handoff quality and internal consistency — APPLICABLE: 4/10

V1 Hierarchy/composition:        12/20  (evidence level 2 — HIGH)
V2 Typography/data legibility:   5/13   (evidence level 1 — HIGH)
V3 Rhythm/alignment/density:     7/14   (evidence level 2 — HIGH)
V4 Color/surface/depth:          5/11   (evidence level 2 — HIGH)
V5 Component/state craft:        6/12   (evidence level 2 — HIGH)
V6 Motion/continuity:            2/9    (evidence level 1 — HIGH)
V7 Product authorship:           6/17   (evidence level 2 — HIGH)  (counterfactual test: **FAIL** —
  replacing product nouns leaves a conventional split-screen login page with a credential form and
  a decorative marketing aside; no distinctive operating model remains. Capped at 8/17; scored 6.)
V8 Coherence/auditability:       1/4    (evidence level 1 — HIGH)

Findings:
- Critical: none.
- Major: the spec covers only `/sign-in`; the plan's `/auth/callback`, `/session-expired`, refresh,
  reauthentication, and `returnPath` open-redirect prevention are entirely unaddressed. The mock
  "always fails," so the real success/session contract is left as an implementation instruction,
  not a reviewable spec.
- Major: state/recovery coverage is materially incomplete — no callback, session-expired, refresh,
  network-failure, retry, success-transition, or org-picker handoff state is named; the plan's
  required post-callback focus movement is absent.
- Major: visual direction is a generic split-login template; product specificity lives only in
  copy inside a decorative `aria-hidden` element, not in an authored composition (V7 fails the
  counterfactual test).
- Moderate: typography names only an H1; no semantic roles for subtitle/help/error/footer/aside
  text, no wrapping/hierarchy behavior under long PT-BR copy.
- Moderate: spacing states columns/max-width/centering but no intra-/inter-group rhythm, no
  short-viewport or on-screen-keyboard behavior, no error-induced layout-shift statement.
- Moderate: component states incomplete — pending only changes the button label; no
  disabled/anti-double-submit, spinner, focus, or preserved-input behavior on error/retry.
- Moderate: motion is nearly silent — no stated position on abrupt vs. animated transitions, no
  reduced-motion equivalent.
- Minor: the 40px compact button height is chosen with no density justification (design system
  default is 44px).
- Minor: local token names (`var(--space-7)`, `--color-action-primary`, `--color-neutral-900`) are
  not reconciled against `tokens.css`'s current authority.

Design-system dispositions:
- SPEC GAP: apply the system's existing focus-visible, field-error, button loading/disabled,
  target-size, motion, and reduced-motion rules; justify the compact 40px button or use the
  supported default.
- SYSTEM GAP: the system has no documented, reusable pre-auth/session-boundary pattern spanning
  login, OAuth callback, transparent refresh, session expiry, safe return paths, and focus
  restoration — this is screen-specific to the A01 role in the plan and not (yet) evidenced as
  recurring across 3+ screens, so it is recorded here rather than promoted to
  `system-level-findings.md`; revisit if a later batch's screen (e.g. any screen reachable only
  post-session-expiry) surfaces the same gap.
- SYSTEM CONSTRAINT: none identified.
- JUSTIFIED EXCEPTION: omitting AppShell/navigation on this pre-auth surface is correct — RBAC and
  tenant context do not exist yet at this point in the journey.
- SYSTEM EVOLUTION CANDIDATE: a reusable "AuthShell" composition (split layout + all
  session-boundary states) would be a legitimate system pattern if/when A01's revision below is
  validated and reused.

Evidence excerpts (file:line):
- `docs/frontend/prototype-screen-specs/A01-sign-in.md:5` — "tela dividida 2 colunas em desktop
  (≥960px), 1 coluna em mobile. Sem AppShell/nav."
- `docs/frontend/prototype-screen-specs/A01-sign-in.md:16` — full-width 40px submit button, label
  changes to "Entrando…" while pending.
- `docs/frontend/prototype-screen-specs/A01-sign-in.md:27` — mock authentication "sempre falha";
  real success path left as a comment, not a spec.
- `docs/frontend/p0-screen-inventory-plan.md:145-155` (A01 entry) — canonical routes `/login`,
  `/auth/callback`, `/session-expired`; required states include invalid callback, transparent
  refresh, refresh failure, reauthentication, safe internal-only `returnPath`; required focus
  movement to title/error after callback.

Required revision: **applied to `A01-sign-in.md` in this batch** — see the spec's revision history
note. Summary of what changed:
- Reconciled routes and named all three plan states (initial, `/auth/callback` processing,
  `/session-expired`) plus refresh/reauthentication, with a validated, allowlisted `returnPath`.
- Named concrete typography roles, spacing rhythm, and interaction states (hover/focus/disabled/
  loading/error) using system tokens, including the density rationale for control height.
- Added an explicit motion decision (button loading transition, focus restoration after error,
  reduced-motion equivalent) rather than leaving V6 silent.
- Authored one product-specific visual decision (the aside's headline sequence tied to "evidence
  before it becomes urgent," reused verbatim as the seed of a future AuthShell pattern) instead of
  leaving all product specificity in copy alone — noted as a candidate, not a claim that this alone
  clears the V7 counterfactual bar; still capped until this is validated as a coherent, reused
  cross-screen vocabulary.

Rendered-review checks to defer to the later gate:
- Actual balance of the 23rem form vs. the aside at the 960px transition.
- Contrast measurement for the near-black aside, error surface, links, and every interactive state.
- Optical typography, wrapping, and clipping with realistic long PT-BR copy at zoom and narrow/short
  viewports.
- Keyboard-only flow, visible focus, error/callback focus transfer, and screen-reader announcements.
- Perceived responsiveness and layout stability of pending/error/session transitions.
