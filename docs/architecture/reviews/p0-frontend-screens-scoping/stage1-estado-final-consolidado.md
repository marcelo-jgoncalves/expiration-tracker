# Stage 1 — Estado Final Consolidado: rubric for grading the P0 screen-inventory plan

**Status: CONVERGED. Codex 9.4/10, Claude 9.3/10 (retrospective, after reading Round 2 in full) — both ≥9.0, no rounding.**

## Process

- Round 1: Claude wrote an independent BLIND proposal (`stage1-round1-claude-proposal.md`, 7 axes/100pts, self-score 8.6/10) without seeing any Codex output. Codex wrote an independent BLIND proposal in the same round (`stage1-round1-codex-blind-proposal.md`, 8 axes/100pts, self-score 9.2/10), via `codex exec --skip-git-repo-check` from the repo root, with no visibility into Claude's proposal.
- Round 2: both proposals revealed to Codex for reconciliation (`stage1-round2-reconciliation.md`). Codex produced one merged 8-axis/100-point rubric, explicitly resolved the 3 named disagreements (tenant/guest axis split vs. combine; whether the "required grading artifacts" checklist is a gate or a scored axis; whether a deliberately-deferred roadmap item counts as an "orphan feature"), and self-scored 9.4/10.
- Claude read Round 2 in full and agrees retrospectively (9.3/10, no residual disagreement) — same pattern as D-243's Round 2 closure, third round dispensed by explicit agreement.

## Final converged rubric — 8 weighted axes, 100 points

1. **Backend-to-interface completeness and traceability — 18** — every backend capability/RBAC `Action` maps to ≥1 screen or is recorded `DEFERRED` under the 6-condition rule below; reverse traceability (surface → capabilities) also required.
2. **Journey, navigation, and screen-graph coherence — 14** — every screen has entry points, exits, next steps; no orphan screens, no dead ends, no unexplained jumps; cross-references agree both directions.
3. **RBAC-aware visibility and action model — 14** — per screen and per meaningful action, which of OWNER/ADMIN/MEMBER/VIEWER can discover/view/invoke/administer it; no actionable-looking affordance for a role that cannot use it (a disabled control with an explanatory, non-sensitive-disclosing tooltip is an acceptable exception, must be justified explicitly).
4. **State, feedback, and recovery coverage — 14** — loading/empty/success/validation/error/retry/unavailable per screen PLUS domain-specific states (OCC conflict, partial import failure, expired/revoked guest link, authorization denial, anti-enumeration collapse); recovery must be actionable, not "handle errors."
5. **Multi-tenant organization context and isolation UX — 10** — active org unambiguous; switch behavior/persistence defined; no misleading cross-tenant transitions; stale links/invitations/insufficient-membership handled.
6. **Guest/authenticated surface separation — 8** — structural (not visual) separation; guest entry/limited capabilities/expiry/revocation/escalation/safe-failure without leaking resource existence.
7. **Responsive, mobile, and accessibility planning — 12** — per-screen responsive treatment (full parity / explicit transformation / justified degradation / desktop-only-with-reason); keyboard/focus/reflow/target-size/non-drag-alternative/status-announcement coverage, not a blanket WCAG claim.
8. **Zero-context handoff quality and internal consistency — 10** — a downstream tool with no session history can build each screen without an avoidable clarifying question; routes/roles/capabilities/states/terminology/assumptions stated consistently and inline.

## Evidence-sufficiency gate (not a 9th scored axis)

The grader must be able to locate, in whatever form (not necessarily 10 separate documents): capability→surface traceability; surface→capability reverse map; role×surface×action rules; route/nav hierarchy; journey×surface coverage; per-screen state coverage; org-context/switching rules; guest/authenticated boundary spec; per-screen responsive/accessibility notes; assumption/gap/deferral register. Missing evidence that cannot be reconstructed unambiguously caps the affected axis below full credit; if it blocks verifying P0 completeness/roles/journeys/security boundaries, the plan cannot score ≥90/100 regardless of prose quality.

## Deferred-capability rule (resolves Claude's Round 1 open question)

A capability is **not an orphan** if, and only if, ALL of: (1) explicitly out of the evaluated P0 scope; (2) has a concrete deferral reason; (3) has a destination milestone or measurable reconsideration trigger; (4) dependencies/consequences on current P0 journeys are named; (5) no P0 journey has a dangling route/control/promise depending on it; (6) the traceability record marks it `DEFERRED` rather than silently omitting it. This applies directly to this repo's own already-recorded deferrals (e.g., P0.5 search fatias 4-5, P0.7 "solicitações pendentes"/business-readable audit trail) — Stage 2 must record these as `DEFERRED`, not silently drop them.

## Sources (real, dated, cited in Round 1 by each side — see the round files for full list)

NN/g "10 Usability Heuristics Applied to Complex Applications"; NN/g "How to Conduct a Heuristic Evaluation"; W3C WCAG 2.2 (Recommendation 2023-10-05) incl. SC 1.4.10/2.4.7/2.4.11/2.5.7/2.5.8/3.3.1/4.1.3; AWS SaaS Architecture Fundamentals whitepaper (tenant isolation, SaaS identity); Pencil & Paper (SaaS navigation UX); WorkOS (RBAC in 2025 B2B SaaS); Orbix (multi-tenant dashboard principles); Logto/Medium (org switcher pattern); Jenny Choi/Medium + DeveloperUX (design handoff checklists). Honesty gap named by both sides: no single authoritative external source scores an entire pre-build screen-inventory PLAN end-to-end (as distinct from heuristic-evaluating a shipped UI) — this rubric is a reasoned synthesis for this specific artifact type, not a citation lookup.

## Next

This rubric governs the grading of Stage 2's actual screen inventory (`docs/architecture/reviews/p0-frontend-screens-scoping/stage2-*`), which must independently converge Claude/Codex ≥9.0/10 against these 8 axes before the final plan document is written.
