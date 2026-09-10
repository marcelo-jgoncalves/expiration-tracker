# A19 — Team & Organization Settings — Screen Spec Audit Record

**Process note**: one BLIND Codex pass (batch 5/6, A18/A19/A20/A21 audited together in a single
prompt) + one Claude reconciliation round.

**Reconciliation — this screen carries the third CRITICAL RBAC finding of the full audit project.**
Claude's own pre-Codex read had already identified, from the plan text alone, that
`organization:update-settings/close/cancel-close` are grouped as OWNER_ROLES with the explicit
qualifier "this whole 'Organization' sub-tab should not even be visible to non-OWNER roles" —
directly contradicting the spec's own RBAC section ("aba 'Organização' → ADMIN+"). Codex's blind
pass, working from the same plan excerpt with no visibility into Claude's read, independently
flagged the identical contradiction, plus a second one Claude's first pass had under-weighted: the
plan states `membership:list-members`/`membership:leave` are READ_ONLY_ROLES (every role sees the
roster), but the spec's own RBAC section states "MEMBER/VIEWER: sem acesso a esta tela" for the
*entire* "Membros e convites" tab — a second, independent over-restriction, not merely a missing
grant. Both reads also converged on a third defect that is a functional/RBAC-adjacent under-grant:
the spec blanket-disables promoting anyone to OWNER for all actors, when the plan requires this be
possible for an OWNER actor specifically (only an ADMIN actor should see it disabled). Three
independently-confirmed RBAC-model defects on one screen — two over-restrictions (roster tab,
Organization tab) and one blanket denial of a plan-required capability (OWNER promotion by an OWNER
actor) — is treated as a CRITICAL finding cluster, on top of the entirely-missing mandatory storage
subsection. Codex's numeric figures are adopted with no adjustment; this reconciliation exists to
record that both reads reached the RBAC conclusions independently, not just to endorse the numbers.

---

Screen: A19 — Team & Organization Settings / "Time e organização"
Route: `/settings/team` (spec, pre-revision) — canonical plan routes:
`/app/:orgId/settings/team`, `/app/:orgId/settings/organization`, plus a mandatory third
`/app/:orgId/settings/storage` subsection entirely absent pre-revision.
Primary task: manage team roster/invitations, personal membership (leave), and organization
identity/lifecycle/closure; view storage usage.
Spec version/date: undated, audited 2026-09-10.

Functional score (applicable-only, renormalized): 21/100
Visual specification score: 35/100
Consolidated score: 27/100
Gate result: **NOT PASS** — RBAC axis scores 1/14 (multiple confirmed CRITICAL defects); an entire
mandatory subsection (storage) is missing; F7 (responsive) scores 0/12.

Visual confidence: HIGH
Classification: SPEC AUDIT — rendered excellence not yet verified (rubric §0).

Perceptual reading order (as described or inferred):
1. Tabs (Membros e convites / Organização).
2. Member roster table.
3. Pending invitations.
4. Organization identity / danger zone.

D-247 axes (axis 6 marked N/A — no guest surface; 92 applicable points, renormalized):
1. Backend-to-interface completeness and traceability — 6/18 (storage subsection entirely absent;
   lifecycle states and several membership/invitation operations missing).
2. Journey, navigation, and screen-graph coherence — 3/14 (route omits `:orgId`; no storage route;
   leave/close return-flow underspecified).
3. RBAC-aware visibility and action model — **1/14 — three confirmed CRITICAL/Major defects**: (a)
   entire "Membros e convites" tab wrongly gated to ADMIN+ when the plan requires READ_ONLY_ROLES
   roster visibility; (b) entire "Organização" tab wrongly opened to ADMIN when the plan requires
   OWNER-only visibility, not merely OWNER-only for the close action; (c) OWNER promotion/demotion
   blanket-disabled for every actor, when the plan requires it be enabled specifically for an OWNER
   actor.
4. State, feedback, and recovery coverage — 3/14 (suspended member and one pending invitation shown;
   duplicate/expired/revoked invitation, REMOVED member, lifecycle states, self-target block, and
   last-owner-specific logic all absent or wrong).
5. Multi-tenant organization context and isolation UX — 3/10 (org name shown; no `:orgId` route or
   switch-context behavior).
6. Guest/authenticated surface separation — N/A.
7. Responsive, mobile, and accessibility planning — 0/12 (no mobile member-cards, no full-screen
   forced-focus close dialog).
8. Zero-context handoff quality and internal consistency — 3/10 (table-level detail is concrete, but
   the spec directly contradicts the plan's RBAC ground truth on two axes and leaves the destructive
   close flow unmodeled).

V1 Hierarchy/composition:        10/20  (evidence level 2 — HIGH)
V2 Typography/data legibility:   5/13   (evidence level 1 — HIGH)
V3 Rhythm/alignment/density:     6/14   (evidence level 2 — HIGH)
V4 Color/surface/depth:          3/11   (evidence level 1 — HIGH)
V5 Component/state craft:        5/12   (evidence level 2 — HIGH, but encodes incorrect RBAC states)
V6 Motion/continuity:            0/9    (evidence level 0 — HIGH)
V7 Product authorship:           4/17   (evidence level 1 — HIGH)  (counterfactual test: **fails** —
  reads as a generic team-management/settings screen with no domain-specific structure; capped at
  8/17, actual craft scores below the cap anyway.)
V8 Coherence/auditability:       2/4    (evidence level 1 — HIGH — missing subsection and routes make
  the A19 family unauditable as a complete unit.)

Findings:
- **Critical**: entire "Membros e convites" tab wrongly gated to ADMIN+ — spec's own RBAC line
  ("MEMBER/VIEWER: sem acesso a esta tela") contradicts the plan's `membership:list-members`
  READ_ONLY_ROLES requirement (every role sees the roster).
- **Critical**: entire "Organização" tab wrongly opened to ADMIN — spec's RBAC line ("ADMIN: acessa
  ambas as abas") contradicts the plan's explicit requirement that the whole sub-tab "should not
  even be visible to non-OWNER roles," a stricter rule than gating only the close action.
- **Critical**: OWNER promotion/demotion blanket-disabled for every actor ("opção 'OWNER' sempre
  desabilitada no dropdown") when the plan requires it enabled for an OWNER actor specifically, only
  disabled (never hidden, to avoid a silent-403 illusion) for an ADMIN actor.
- **Major**: the entire mandatory `/app/:orgId/settings/storage` subsection (usage bar, OK/WARNING/
  CRITICAL/OVER states, `reservedBytes` explanation, read-only `limitBytes`) is absent.
- Major: `membership:leave` — a self-only action distinct from admin-driven "remove" — is missing
  entirely from the spec.
- Major: last-remaining-OWNER logic is overbroad — "se papel=OWNER → texto 'Último OWNER'" treats
  every OWNER row identically instead of computing whether this is the *only* active OWNER.
- Major: no block on an acting user changing their own role or removing themselves (should redirect
  to "leave" instead).
- Major: organization lifecycle states (DELETING/HELD_FOR_RECOVERY/DELETED, `cancel-close` reachable
  only during the recovery window) entirely absent.
- Major: the close-organization confirmation is explicitly deferred ("não modelado no protótipo")
  despite being named the highest-consequence action in the system, requiring a full-screen,
  forced-focus interaction per the plan.
- Moderate — SLF-03: route omits `/app/:orgId`.
- Moderate: duplicate/expired/revoked invitation states and a REMOVED member status are absent.
- Moderate — SLF-04: "Remover"/"Revogar" used the nonexistent `tertiary` variant.

Design-system dispositions:
- SPEC GAP: all findings above except the two tab-visibility CRITICALs, which are RBAC-model errors
  rather than mere omissions.
- SYSTEM GAP: none newly identified beyond SLF-02/03/04 (all confirmed recurring on this screen too).
- SYSTEM CONSTRAINT: none.
- JUSTIFIED EXCEPTION: none.
- SYSTEM EVOLUTION CANDIDATE: none new.

Evidence excerpts (file:line, pre-revision spec):
- `A19-time-organizacao.md:4` (pre-revision) — "aba 'Membros e convites' → ADMIN+" and "aba
  'Organização' → ADMIN+" — both contradicted by plan RBAC ground truth.
- `A19-time-organizacao.md:16` (pre-revision) — "opção 'OWNER' sempre desabilitada no dropdown."
- `A19-time-organizacao.md:41-42` (pre-revision) — RBAC section restating both incorrect gates.
- `docs/frontend/p0-screen-inventory-plan.md:465-504` — full A19 plan entry (RBAC, states, storage
  subsection).

Required revision: **applied to `A19-time-organizacao.md` in this batch**. Summary:
- Restructured to three tabs with corrected per-tab RBAC: "Membros e convites" (READ_ONLY_ROLES,
  read-only roster for MEMBER/VIEWER, ADMIN+ sees invite/role-change/remove), "Armazenamento" (new,
  READ_ONLY_ROLES), "Organização" (OWNER-only, tab absent from the DOM for non-OWNER, not merely
  hidden by CSS).
- Added `membership:leave` as a self-only row action, with last-remaining-OWNER and self-target
  guards specified explicitly (computed, not hardcoded to "any OWNER row").
- Corrected OWNER-promotion gating to be actor-role-conditional (enabled for OWNER actor, disabled
  with a tooltip — never hidden — for ADMIN actor).
- Added organization lifecycle states, `cancel-close` window, and a full-screen forced-focus close
  confirmation description.
- Added the full storage subsection (usage bar, OK/WARNING/CRITICAL/OVER, `reservedBytes` framing,
  read-only `limitBytes`).
- Corrected `tertiary` to `ghost`/`danger` per action semantics (SLF-04) with rationale stated.
- Added mobile member-card layout, motion decision, `:orgId`-qualified routes.

Rendered-review checks to defer to the later gate:
- Whether the three-tab layout (with one tab entirely absent for most actors) reads clearly rather
  than looking like a broken/incomplete settings page once rendered.
- Legibility of the storage percentage bar's reserved-bytes sub-segment at narrow widths.
