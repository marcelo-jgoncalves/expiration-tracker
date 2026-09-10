# A22 — Document Request Delivery Settings — Screen Spec Audit Record

**Process note**: one BLIND Codex pass (batch 6/6, A22/A23/G01/G02 audited together in a single
prompt, `codex exec --skip-git-repo-check`) + one Claude reconciliation round.

**Reconciliation — this screen carries the fourth CRITICAL RBAC finding of the full audit project.**
Claude's own pre-Codex read of the plan text had already flagged that
`tenant:configure-document-request-delivery` is OWNER_ROLES-only and explicitly "not visible to
non-OWNER roles at all," directly contradicting the spec's `Acesso: ADMIN+` line — an over-grant
(ADMIN would see a screen the plan reserves for OWNER). Codex's blind pass, working from the same
plan excerpt with no visibility into Claude's read, independently reached the identical conclusion
and used identical severity language ("Critical — RBAC/security"). Both reads converge with no
adjustment needed to Codex's figures. This is the fourth CRITICAL RBAC finding across the full
24-screen project (after A16's over-grant in batch 4, A19's three-defect cluster in batch 5, and the
under-grant found earlier in the project) — all four are over/under-grant errors, none a missing
Action.

---

Screen: A22 — Document Request Delivery Settings / "Entrega de solicitação"
Route: `/settings/request-delivery` (spec, pre-revision) — canonical plan route:
`/app/:orgId/settings/request-delivery`.
Primary task: set the tenant-wide default delivery mode (email vs. manual) for the legacy guest
request invite (G01).
Spec version/date: undated, audited 2026-09-10.

Functional score (applicable-only, renormalized): 38.0/100
Visual specification score: 40.0/100
Consolidated score: 38.8/100
Gate result: **NOT PASS** — RBAC axis scores 2/14 (CRITICAL over-grant), route omits `:orgId`
(SLF-03), no mutation states specified, V6 scores 0/9.

Visual confidence: HIGH
Classification: SPEC AUDIT — rendered excellence not yet verified (rubric §0).

Perceptual reading order (as described or inferred):
1. PageHeader (title + description).
2. Two radio-cards (Email automático / Entrega manual).
3. Prospective-change InlineNotice.
4. Save button.

D-247 axes (axis 6 marked N/A — no guest surface on this screen; 92 applicable points,
renormalized):
1. Backend-to-interface completeness and traceability — 12/18 (the two delivery modes and the
   prospective-only semantics are captured; no OCC-conflict or "email temporarily unavailable"
   state per the plan).
2. Journey, navigation, and screen-graph coherence — 5/14 (route omits `:orgId`; no stated
   post-save landing spot; nav-entry visibility for non-OWNER roles not addressed).
3. RBAC-aware visibility and action model — **2/14 — CRITICAL**: spec states `Acesso: ADMIN+`;
   plan requires `tenant:configure-document-request-delivery` to be OWNER_ROLES-only and the
   screen/nav-entry to be entirely invisible to non-OWNER roles (RBAC-aware-nav rule, plan §3). As
   written, ADMIN (and by the header's own "ADMIN+" wording, only ADMIN and above, so this is
   narrower than the MEMBER/VIEWER over-grants found elsewhere in the project — but still a
   confirmed over-grant one tier wide).
4. State, feedback, and recovery coverage — 8/14 (no-default-yet, OCC conflict, and
   email-temporarily-unavailable states from the plan are all absent; no loading/saving/duplicate-
   submit/error-retry states for the mutation itself).
5. Multi-tenant organization context and isolation UX — 2/10 (no `:orgId`-qualified route; no
   statement of what happens on org switch).
6. Guest/authenticated surface separation — N/A.
7. Responsive, mobile, and accessibility planning — 2/12 (radio-cards have no `fieldset`/`legend`
   semantics, no keyboard-operation or focus-visible statement, no mobile treatment).
8. Zero-context handoff quality and internal consistency — 4/10 (the prospective-only business rule
   is stated well and consistently in both the UI copy and the business-rules section — a real
   strength — but the RBAC contradiction undermines overall internal consistency).

V1 Hierarchy/composition:        11/20  (evidence level 2 — HIGH)
V2 Typography/data legibility:   5/13   (evidence level 1 — MEDIUM)
V3 Rhythm/alignment/density:     8/14   (evidence level 2 — HIGH)
V4 Color/surface/depth:          4/11   (evidence level 1 — HIGH)
V5 Component/state craft:        5/12   (evidence level 2 — HIGH)
V6 Motion/continuity:            0/9    (evidence level 0 — HIGH)
V7 Product authorship:           5/17   (evidence level 1 — HIGH)  (counterfactual test: **fails** —
  substituting "entrega"/"convite"/"solicitação" for "configuração"/"item"/"operação" leaves a
  generic two-option-plus-save admin form; capped at 8/17, scored 5)
V8 Coherence/auditability:       2/4    (evidence level 1 — MEDIUM)

Findings:
- Critical: `Acesso: ADMIN+` contradicts the plan's OWNER_ROLES-exclusive requirement and the
  RBAC-aware-nav rule (screen must not even be nav-visible to ADMIN/MEMBER/VIEWER).
- Major: route omits `:orgId` (SLF-03, now 24/24 authenticated screens across the whole project).
  No mutation states specified (loading, saving-pending, duplicate-submit prevention, save error/
  retry, OCC conflict, "email temporarily unavailable" per plan).
- Moderate: nav-entry visibility rule for non-OWNER roles not stated; radio-card a11y semantics
  (`fieldset`/`legend`, keyboard, focus-visible) absent; hover/focus/pressed/disabled states for the
  radio-cards not described (border-only selection indicator risks a color/border-only signal); no
  motion/transition treatment (SLF-02).
- Minor: the prospective-only copy ("Alterar este padrão afeta apenas novos convites — nunca revoga
  um link já emitido") is a genuine strength — concrete, explicit, matches the plan's required
  wording almost verbatim.

Design-system dispositions:
- SPEC GAP: RBAC access line, route `:orgId`, mutation states, a11y semantics for radio-cards.
- SYSTEM GAP: SLF-02 (no motion guidance invoked) — tracked at `system-level-findings.md`, not
  re-derived here.
- SYSTEM CONSTRAINT: none new.
- JUSTIFIED EXCEPTION: none.
- SYSTEM EVOLUTION CANDIDATE: none new for this screen alone.

Evidence excerpts (file:line):
- `docs/frontend/prototype-screen-specs/A22-config-entrega-solicitacao.md:4` — `**Acesso:** ADMIN+`.
- `docs/frontend/p0-screen-inventory-plan.md:546` — `tenant:configure-document-request-delivery`
  (OWNER_ROLES — this is a workspace-wide external-communication policy, not visible to non-OWNER
  roles at all).

Required revision:
- Change `Acesso` to `OWNER_ROLES` only, state explicitly that the screen and its nav entry are
  fully hidden from ADMIN/MEMBER/VIEWER (not merely action-disabled).
- Qualify the route with `:orgId`.
- Add mutation states: initial load / load error / saving / save success (toast or inline
  confirmation, stated) / save error with retry / OCC conflict (someone else changed the default
  concurrently) / SES temporarily unavailable.
- Add `fieldset`/`legend` semantics and a stated keyboard/focus-visible behavior for the radio-cards.
- Add one concrete motion decision (or an explicit "no motion, because X").

Rendered-review checks to defer to the later gate:
- Whether the selected-border-only radio-card affordance reads clearly once rendered; whether the
  two-column reading width feels appropriately dense for a single-decision settings screen.
