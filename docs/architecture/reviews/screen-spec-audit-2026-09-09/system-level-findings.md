# Screen Spec Audit — System-Level Findings Log

**Status**: LIVE — created during batch 1/6 (A01-A04), updated by every subsequent batch.
**Purpose**: per `docs/frontend/screen-spec-audit-rubric.md` §5's system-level gate, a SYSTEM GAP/
CONSTRAINT that recurs across 3+ screens or affects a foundational primitive (type scale,
metric-card pattern, AppShell) gets ONE finding with one remediation owner here, instead of being
penalized independently on every screen's own audit record. Each screen's own audit record links
back here instead of re-deriving the finding.

Process note: each per-screen audit used one BLIND Codex pass (`codex exec --skip-git-repo-check`)
+ one Claude reconciliation, not the full 3-round protocol — same deliberate scope reduction as
D-249/D-250, named explicitly per the task brief for this audit.

---

## SLF-01 — Flat, structurally-identical metric-card grid pattern (CONFIRMED)

**Status**: CONFIRMED (rubric §5's first named hypothesis).
**Disposition**: SYSTEM CONSTRAINT / SYSTEM EVOLUTION CANDIDATE (the shared convention itself needs
to evolve, not just be avoided locally).
**Evidence**: `docs/frontend/prototype-screen-specs/README.md` §"Convenções" defines the compact
metric-card grid as a shared pattern; A03 (Dashboard) instantiates it as 4 equal-weight linked
cards with identical visual treatment differing only in label/count/link target. Both Claude's and
Codex's independent audits of A03 capped V7 (product-specific authorship) at the counterfactual-test
ceiling (8/17) specifically because the grid gives overdue/critical work the same visual weight as
every other counter — no comparative temporal-risk hierarchy is encoded in layout, only in badge
tone. A09 (Subject Hub) is named in the rubric as a second expected instance; not yet audited in
this batch (scheduled for a later batch).
**Why this is system-level, not screen-level**: the pattern is defined once in the shared README
convention and instantiated identically wherever it's used — fixing A03's copy of it in isolation
would create a one-off divergence from the shared pattern, which the design system's §3.6
("Consistency Over Local Optimization") explicitly discourages. The fix belongs at the pattern
level.
**Remediation owner**: design-system/pattern-library maintainer (next available frontend
design-system revision cycle) — define a **risk-prioritized compliance-summary pattern** as a named
variant of (or replacement for) the flat metric-card grid: cards must be able to carry different
visual weight/size/position based on domain severity (e.g., overdue count visually dominant vs.
missing-requirements count secondary), not just differing badge color, while remaining reusable
across A03/A09/any future compliance-summary screen.
**Interim local mitigation applied**: A03's own audit record (below) applies a JUSTIFIED
LOCAL IMPROVEMENT within the constraint — reordering/sizing guidance and an explicit severity-led
reading order — without inventing a new shared component from within a single screen's spec file.
**Recheck in later batches**: confirm/refute against A09 and any other screen using this pattern;
if 3+ confirmed instances accumulate, this finding's status is already "recurs across a foundational
primitive" per the rubric's OR clause, so the gate is already met regardless of exact count.
**Batch 3 update (2026-09-09)**: CONFIRMED on A09 exactly as the rubric predicted — A09's four-card
link grid (Requirements/Documents/legacy tracking/Requests) gave every destination equal visual
weight regardless of `missingCount`/`expiringSoonCount`, capping V7 at the same 8/17 counterfactual
ceiling as A03. A09's own audit record applies the same class of local mitigation as A03 (severity-led
card tone/ordering within the constraint, not a new shared component). This is now 2 confirmed
screen-level instances (A03, A09) plus the already-met "foundational primitive" OR-clause — remediation
owner and scope unchanged from the original entry above.

---

## SLF-02 — Design-system motion tokens exist, but no spec states when to use them (CONFIRMED, reclassified)

**Status**: CONFIRMED as a recurring pattern — all 4 screens in batch 1 (A01-A04) state zero
motion/transition treatment (V6 evidence level 0 in every one of Claude's and Codex's independent
reads). Batches 2-3 (A05-A08, A09/A11-A13) all applied a local motion decision as part of their
revision (SPEC GAP fix, per-screen), consistent with this finding's remediation note below — the
pre-revision specs in both batches also scored V6=0/9 before revision, continuing to confirm the
pre-revision authoring-discipline gap this finding describes.
**Disposition**: **SPEC GAP** (24 independent instances), not SYSTEM GAP — reclassified from the
rubric's open hypothesis. Rationale: `docs/frontend/design-system.md` §21 already defines concrete
motion tokens (`motion.fast/normal/slow`, easing rules, a `prefers-reduced-motion` requirement) and
a general principle ("Movimento deve explicar mudança de estado"). The system is not missing a
primitive — screen authors have simply never invoked it. This is an authoring-discipline gap, not a
token/pattern gap.
**Why this still gets one entry instead of 4 separate deep findings**: the root cause (spec-authoring
process never prompts for a motion decision) is the same in every screen, even though each screen's
correct motion decision differs. Each per-screen audit record below still names its own concrete
motion requirement (attached to that screen's own state transitions), but the systemic root cause
and its remediation are tracked once, here.
**Remediation owner**: whoever maintains the spec-authoring template/checklist for
`docs/frontend/prototype-screen-specs/*.md` — add an explicit "Motion" subsection prompt to the
template (or to `README.md`'s shared conventions) requiring every screen spec to either name a
concrete transition (trigger, direction, duration/easing token, reduced-motion equivalent) or state
an explicit "no motion, because X" rationale (rubric V6 already scores the latter at full credit —
the gap is that no spec does either).
**Recheck in later batches**: expect this to keep recurring through all 24 screens; if it does,
treat that as confirmation the authoring template itself needs the fix, not each author individually.

---

## SLF-03 — Screen spec routes omit the tenant `:orgId` path segment (CONFIRMED, recurs batch 2)

**Status**: CONFIRMED as recurring — now 8/8 screens across batches 1-2 (A01-A08) omit `:orgId` (and,
where applicable, other required path params like `:policyId?`/`:documentId?`). Batch 2 instances:
A05 (`/expirations/:id` vs. required `/app/:orgId/expirations/:itemId`), A06 (missing `:orgId` and
`:policyId?`), A07 (missing `:orgId` and `:documentId?`), A08 (`/subjects` vs.
`/app/:orgId/subjects`). This finding has now unambiguously met the rubric §5 system-level gate
(recurs across 3+ screens) — every screen audited so far shows the same root cause.
**Disposition**: SPEC GAP, recurring — candidate SYSTEM-LEVEL if it recurs in 1+ more upcoming
batches (already 2/4 screens in this batch: A03 `/dashboard`, A04 `/expirations`, vs. the
`p0-screen-inventory-plan.md`-canonical `/app/:orgId/dashboard` and `/app/:orgId/expirations`).
**Evidence**: `p0-screen-inventory-plan.md` §3 and every per-screen route line in that document use
`/app/:orgId/...` for all authenticated, tenant-scoped screens (organization-switching, isolation,
and "never show a flash of the previous org's data" are all defined relative to that `:orgId`
segment). The prototype specs for A03 and A04 instead use bare routes (`/dashboard`,
`/expirations`) with no tenant segment, silently leaving multi-tenant URL isolation as an implicit
assumption rather than a stated contract.
**Why this matters beyond a naming nitpick**: the org-switcher behavior (URL segment change, cache
clearing, no stale-org flash) specified in the shared AppShell contract is only implementable if
every screen's own route actually carries `:orgId` — a spec that omits it either has to be
re-derived correctly by the implementer (never assumed under this rubric's anti-gaming rule) or
risks the org-switch contract silently not applying to that screen.
**Remediation owner**: whoever owns `docs/frontend/prototype-screen-specs/README.md`'s shared
conventions — add the `:orgId`-qualified route pattern to the shared template/checklist so every
future screen spec states it explicitly rather than each author reproducing the plan's routes from
memory.
**Local fix applied this batch**: A03 and A04's own audit records/revisions below correct their
route line directly (a screen-local, one-line fix — not gated on the system-level template update).
**Local fix applied in batch 2**: A05, A06, A07, A08 all corrected their routes directly (same
screen-local fix, still not gated on the pending system-level template update — see remediation
owner above, unchanged).
**Batch 3 update (2026-09-09)**: A09, A11, A12, A13 (12/12 screens across three batches) all omitted
`:orgId` pre-revision — corrected directly in each screen's own revision this batch, same local fix,
same pending system-level template update as the remediation owner.
**Batch 4 update (2026-09-10)**: A14, A15, A16, A17 (16/16 screens across four batches) all omitted
`:orgId` pre-revision — corrected directly in each screen's own revision this batch, same local fix.

---

## SLF-04 — `tertiary` referenced as a Button variant, but the design system does not define one (CONFIRMED, recurs batch 2)

**Status**: CONFIRMED as recurring. Batch 1: 2/4 screens (A02's "Recusar" button, A04's "Importar
CSV" header action). Batch 2: 3/4 screens (A05's "Arquivar vencimento", A06's "Remover", A07's
"Excluir" — the A07 instance is notable because `tertiary` was applied to a genuinely *destructive*
action, where the correct approved variant is `danger`, not `ghost` as in the other four instances —
this screen author conflated "low emphasis" with "not primary," which are different design axes).
Now 5/8 screens across two batches — this finding has met the rubric §5 system-level gate.
**Disposition**: SPEC GAP — candidate SYSTEM EVOLUTION CANDIDATE if a genuine third-tier action
style (below secondary, above a plain text link) turns out to be a real recurring need once more
screens are audited; not enough evidence yet to justify inventing a new approved variant.
**Evidence**: `docs/frontend/design-system.md` §30 defines exactly four Button variants — `primary`,
`secondary`, `ghost`, `danger` — and its §63 explicitly forbids inventing ad hoc variants. Both
A02-onboarding.md and A04-vencimentos.md call for a `tertiary` button, which does not exist in that
catalog.
**Remediation owner**: interim — each screen's own spec should be corrected to use the closest
approved variant (`ghost` for a low-emphasis non-destructive action; `danger` when the action is
destructive, per the A07 correction) rather than a name the system doesn't define. If a genuine third
visual tier keeps recurring across more screens in later batches, escalate to a real design-system
proposal instead of continuing to patch specs one at a time.
**Local fix applied this batch**: A02 and A04's revisions below replace `tertiary` with `ghost` and
name the semantic role explicitly.
**Local fix applied in batch 2**: A05 and A06 replaced `tertiary` with `ghost`; A07 replaced it with
`danger` (destructive action) — the distinction is now named explicitly in that screen's revision.
**Batch 3 update (2026-09-09)**: A09 ("Exportar dossiê") and A11 ("Ver") both used `tertiary`
pre-revision — now 7/12 screens across three batches. Both corrected this batch: A09's action moved
into the header overflow menu as `secondary` (OWNER/ADMIN only); A11's row action moved into a row
overflow menu with no variant named as `tertiary`. A12 and A13 did not use `tertiary` pre-revision.
This finding remains firmly past the system-level recurrence gate; still tracked as interim
per-screen correction pending a real design-system proposal per the remediation owner note above.
**Batch 4 update (2026-09-10)**: A14 ("Gerar agora"/"Cancelar"/"Ver"), A15 ("Voltar"/"Ver relatório
de erros"), and A16 ("Editar"/"Remover") all used `tertiary` pre-revision — now 10/16 screens across
four batches. A17 did not. All three corrected this batch: `ghost` for low-emphasis non-destructive
actions (A14's "Cancelar" kept as `ghost`, not `danger`, since cancelling a series is
reversible/recreatable, not a permanent deletion); A16's "Remover" (deleting a subscription) moved to
`danger` as a genuinely destructive action, the same distinction A07 established in batch 2.

---

## Batch tracker

| Batch | Screens | Status |
|---|---|---|
| 1/6 | A01, A02, A03, A04 | DONE (this file's originating batch) |
| 2/6 | A05, A06, A07, A08 | DONE — all 4 scored NOT PASS (27.6-39.6/100 consolidated); SLF-03 and
  SLF-04 both confirmed as met the system-level recurrence gate during this batch |
| 3/6 | A09, A11, A12, A13 | DONE — all 4 scored NOT PASS (32.9-42.5/100 consolidated); SLF-01
  confirmed on a second screen (A09); SLF-02/03/04 continued recurring; no new SYSTEM GAP/CONSTRAINT
  opened — two candidate cross-screen patterns (Version Lineage/claim-aware action gate on A12/A13)
  noted as SYSTEM EVOLUTION CANDIDATE, not yet promoted (below the 3-screen bar) |
| 4/6 | A14, A15, A16, A17 | DONE — all 4 scored NOT PASS (25.4-48.7/100 consolidated); A16 carries
  a **CRITICAL RBAC over-grant** (tenant-wide export/subscription access granted to MEMBER/VIEWER
  where the plan requires ADMIN_ROLES-only with a narrow named-recipient-per-run exception) — the
  second CRITICAL RBAC finding of the full audit project; A17's RBAC line was confirmed fully correct
  with no revision needed (no MEMBER-assignee exception, matching D-205 literally); SLF-03/04
  continued recurring on all 4 screens; no new SYSTEM GAP/CONSTRAINT opened |
| 5/6-6/6 | remaining 16 screens | pending, see `NEXT_SESSION_PROMPT.md` |
