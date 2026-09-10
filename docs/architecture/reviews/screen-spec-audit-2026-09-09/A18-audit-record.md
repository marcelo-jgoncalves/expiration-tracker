# A18 — My Notification Preferences — Screen Spec Audit Record

**Process note**: one BLIND Codex pass (batch 5/6, A18/A19/A20/A21 audited together in a single
prompt) + one Claude reconciliation round.

**Reconciliation**: Claude's own pre-Codex read and Codex's blind pass converged closely (both
independently flagged the missing `:orgId` route, the missing tenant-vs-personal channel-
unavailability distinction, and the absent quiet-hours validation states). Both independently
confirmed the one thing this screen's task brief specifically flagged — the WhatsApp row — is
handled correctly: a non-editable `StatusBadge` "Indisponível" with no toggle, consistent with G5's
non-blocking-deferral requirement. Codex's figures are adopted with no numeric adjustment.

---

Screen: A18 — My Notification Preferences / "Minhas preferências de notificação"
Route: `/settings/notifications` (spec, pre-revision) — canonical plan route:
`/app/:orgId/settings/notifications`
Primary task: view and edit one's own reminder channel/locale/quiet-hours preferences.
Spec version/date: undated, audited 2026-09-10.

Functional score (applicable-only, renormalized): 45/100
Visual specification score: 31/100
Consolidated score: 39/100
Gate result: **NOT PASS** — both floors fail; F4 (states), F5 (tenant context), F7 (responsive/a11y)
all well below 60% of their available points.

Visual confidence: HIGH
Classification: SPEC AUDIT — rendered excellence not yet verified (rubric §0).

Perceptual reading order (as described or inferred):
1. Channel list (email/WhatsApp).
2. Locale.
3. Quiet hours.
4. Save action.

D-247 axes (axis 6 marked N/A — no guest surface; 92 applicable points, renormalized):
1. Backend-to-interface completeness and traceability — 12/18 (email/locale/quiet-hours/unavailable-
   WhatsApp present; consent source, persisted-default state, and tenant-entitlement data absent).
2. Journey, navigation, and screen-graph coherence — 5/14 (route omits `:orgId`; A06 connection
   named but not detailed).
3. RBAC-aware visibility and action model — 12/14 (correctly self-scoped and open to any
   authenticated user; does not name `notification:configure` or explicitly enumerate all 4 roles).
4. State, feedback, and recovery coverage — 3/14 (no default-not-persisted state, no invalid/
   midnight-crossing quiet-hours validation, no save/success/failure/retry/dirty-state behavior).
5. Multi-tenant organization context and isolation UX — 3/10 (personal scope is clear; no tenant-
   level entitlement/kill-switch distinction from personal disablement).
6. Guest/authenticated surface separation — N/A.
7. Responsive, mobile, and accessibility planning — 1/12 (a max-width is named; no mobile parity,
   keyboard/focus model, or error-association behavior).
8. Zero-context handoff quality and internal consistency — 5/10 (structurally clear, but too many
   required states are implicit).

V1 Hierarchy/composition:        9/20   (evidence level 2 — HIGH)
V2 Typography/data legibility:   5/13   (evidence level 1 — HIGH)
V3 Rhythm/alignment/density:     5/14   (evidence level 1 — HIGH)
V4 Color/surface/depth:          2/11   (evidence level 0 — HIGH)
V5 Component/state craft:        5/12   (evidence level 2 — HIGH)
V6 Motion/continuity:            0/9    (evidence level 0 — HIGH)
V7 Product authorship:           3/17   (evidence level 1 — HIGH)  (counterfactual test: **fails** —
  replacing "e-mail/WhatsApp/lembrete/horário silencioso" with generic nouns produces an
  indistinguishable generic settings form; capped at 8/17, actual craft scores below the cap anyway.)
V8 Coherence/auditability:       2/4    (evidence level 1 — HIGH)

Findings:
- Major — SLF-03: route omits `/app/:orgId`.
- Major: no distinction between a tenant-level entitlement/kill-switch disabling a channel and the
  user personally disabling it — plan requires these render distinctly.
- Major: quiet-hours invalid-interval and midnight-crossing behavior entirely unspecified.
- Moderate: no "defaults not yet persisted" state for a new user.
- Moderate: `consentSource` data (plan-required) absent from the spec.
- Moderate: no save-in-progress/success/failure/retry/unsaved-changes behavior.
- Minor (positive): G5 handled correctly — WhatsApp shown as a non-editable "Indisponível" badge,
  never an actionable toggle.

Design-system dispositions:
- SPEC GAP: `:orgId` route, consent source, default-not-persisted state, quiet-hours validation,
  tenant-vs-personal channel distinction, save-state machine, motion decision, responsive/keyboard
  model.
- SYSTEM GAP: none newly identified.
- SYSTEM CONSTRAINT: none.
- JUSTIFIED EXCEPTION: none.
- SYSTEM EVOLUTION CANDIDATE: none.

Evidence excerpts (file:line, pre-revision spec):
- `A18-preferencias-notificacao.md:3` (pre-revision) — `/settings/notifications`, missing `:orgId`.
- `A18-preferencias-notificacao.md:12` (pre-revision) — WhatsApp row, confirmed correct non-
  actionable framing.
- `docs/frontend/p0-screen-inventory-plan.md:446-463` — full A18 plan entry (states/RBAC/route).

Required revision: **applied to `A18-preferencias-notificacao.md` in this batch**. Summary:
- Route corrected to `/app/:orgId/settings/notifications`; RBAC line names
  `notification:configure` + READ_ONLY_ROLES explicitly.
- Added consent-source display, default-not-persisted `InlineNotice`, quiet-hours validation
  (equal-time error, midnight-crossing confirmation note).
- Added a tenant-vs-personal channel-unavailability distinction (badge + tooltip wording differ).
- Added a full save-state machine (saving/success/error) and an unsaved-changes confirm dialog.
- Added a motion decision (button-label transition only, explicit reduced-motion fallback) and a
  responsive/keyboard/aria-live model.

Rendered-review checks to defer to the later gate:
- Whether the stacked mobile layout keeps the quiet-hours "das/até" pair visually paired once
  rendered narrow.
- Perceived clarity of the tenant-vs-personal unavailable-channel distinction once actually styled.
