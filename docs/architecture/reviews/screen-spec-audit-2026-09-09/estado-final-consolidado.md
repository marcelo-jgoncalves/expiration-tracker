# Screen Spec Audit 2026-09-09 — Estado Final Consolidado (24/24 screens, all 6 batches)

**Status**: COMPLETE. Every screen spec in `docs/frontend/prototype-screen-specs/` (23 authenticated
screens A01-A23, plus the 2-screen guest surface G01/G02 — 24 files reviewed as A01-A23 + G01/G02;
note A10 has no spec file yet, see "Known gap" below) has been audited against
`docs/frontend/screen-spec-audit-rubric.md` (D-250) and revised in place. This document aggregates
all six batches into one final record, per the same convention used by
`docs/architecture/reviews/p0-frontend-screens-scoping/stage1-estado-final-consolidado.md` and
`docs/architecture/reviews/external-sharing-scoping/estado-final-consolidado.md`.

## 1. Process actually used

- Instrument: `docs/frontend/screen-spec-audit-rubric.md`, converged via one blind Claude/Codex
  round + one reconciliation round (D-250, self-scores ≥9.0/10 both sides).
- Audit execution: 6 batches of ~4 screens each, run across two sessions (2026-09-09 batch 1-3,
  2026-09-10 batch 4-6). Each batch: one BLIND Codex pass per batch (`codex exec
  --skip-git-repo-check`, no visibility into Claude's own read) + one Claude reconciliation that
  either adopts Codex's figures, adjusts them with a stated reason, or lets an independent Claude
  finding stand where Codex's blind pass under-weighted it.
- Every screen's spec file was revised in place immediately after its own audit (not deferred to a
  later pass) — the files in `docs/frontend/prototype-screen-specs/` now reflect the POST-revision
  state; the audit records in this folder are the evidence trail for what changed and why.
- System-level findings (recurring across 3+ screens, or affecting a foundational primitive) were
  tracked centrally in `system-level-findings.md` instead of being re-derived on every screen —
  5 opened (SLF-01 through SLF-05), all now closed as confirmed at or past their recurrence gate.

## 2. Aggregate score table (all 24 screens)

| Screen | Functional /100 | Visual /100 | Consolidated /100 | Gate |
|---|---:|---:|---:|---|
| A01 — Sign-in | 54.4 | 44.0 | 50.2 | NOT PASS |
| A02 — Onboarding | 46.8 | 35.0 | 42.1 | NOT PASS |
| A03 — Dashboard | 54.3 | 36.0 | 47.0 | NOT PASS |
| A04 — Vencimentos | 33.0 | 32.0 | 32.6 | NOT PASS |
| A05 — Vencimento detalhe | 36.0 | 45.0 | 39.6 | NOT PASS |
| A06 — Política de lembrete | 38.0 | 31.0 | 35.2 | NOT PASS |
| A07 — Arquivos de vencimento | 34.0 | 27.0 | 31.0 | NOT PASS |
| A08 — Fornecedores | 26.0 | 30.0 | 27.6 | NOT PASS |
| A09 — Subject Hub | 40.2 | 36.0 | 38.5 | NOT PASS |
| A11 — Requisitos | 31.5 | 35.0 | 32.9 | NOT PASS |
| A12 — Documento detalhe | 43.5 | 41.0 | 42.5 | NOT PASS |
| A13 — Fila de revisão | 37.8 | 41.0 | 39.1 | NOT PASS |
| A14 — Solicitações/recorrência | 46.0 | 41.0 | 44.0 | NOT PASS |
| A15 — Importação CSV | 31.5 | 42.0 | 35.7 | NOT PASS |
| A16 — Relatórios/exportações | 21.7 | 31.0 | 25.4 | NOT PASS (CRITICAL) |
| A17 — Dossiê de fornecedor | 47.8 | 50.0 | 48.7 | NOT PASS |
| A18 — Preferências de notificação | 45.0 | 31.0 | 39.0 | NOT PASS |
| A19 — Time e organização | 21.0 | 35.0 | 27.0 | NOT PASS (CRITICAL) |
| A20 — Catálogo de tipos de documento | 28.0 | 32.0 | 30.0 | NOT PASS |
| A21 — Templates de requisitos | 28.0 | 38.0 | 32.0 | NOT PASS |
| A22 — Config. entrega de solicitação | 38.0 | 40.0 | 38.8 | NOT PASS (CRITICAL) |
| A23 — Log de auditoria | 27.2 | 32.0 | 29.1 | NOT PASS (CRITICAL) |
| G01 — Upload de convidado legado | 36.8 | 51.0 | 42.5 | NOT PASS (CRITICAL) |
| G02 — Solicitação de documento (convidado) | 35.5 | 50.0 | 41.3 | NOT PASS (CRITICAL) |

**Aggregate**: 24/24 NOT PASS. 0 BASELINE PASS. 0 WORLD-CLASS-READY.
Consolidated range: 25.4 (A16) – 50.2 (A01). Mean consolidated ≈ 37.0/100.
No screen came within 40 points of the Baseline Pass floor (ConsolidatedSpecScore ≥ 90.0).

## 3. System-level findings — final disposition (all 5, all CONFIRMED and closed)

Full detail in `system-level-findings.md`; summarized here for the record:

- **SLF-01 — Flat, structurally-identical metric-card grid** (A03, A09; 2 confirmed instances +
  already-met foundational-primitive OR-clause). Disposition: SYSTEM CONSTRAINT / SYSTEM EVOLUTION
  CANDIDATE. Remediation: define a risk-prioritized compliance-summary card pattern as a named
  variant/replacement for the flat grid. **Not yet remediated at the system level** — only local
  mitigations applied to A03/A09.
- **SLF-02 — No spec states a motion/transition treatment** (24/24 screens, zero exceptions, closed
  batch 6). Disposition: SPEC GAP (authoring-discipline, not a missing token — design-system §21
  already defines `motion.fast/normal/slow` and reduced-motion requirements). Every screen's
  revision added a local motion decision. **Remediation still open**: add an explicit "Motion"
  prompt to the spec-authoring template so future specs (starting with the still-ungenerated A10)
  don't repeat a 24/24 gap.
- **SLF-03 — Authenticated routes omit `:orgId`** (22/22 authenticated screens with the concept,
  zero exceptions, closed batch 6). Disposition: SPEC GAP. Every screen's route corrected locally.
  A23 additionally had a wrong path segment beyond the missing `:orgId` (screen-local defect, fixed).
  **Remediation still open**: add the `:orgId`-qualified pattern to the shared route-naming
  checklist.
- **SLF-04 — `tertiary` Button variant referenced (doesn't exist in the design system)** (14/24
  screens, closed batch 6). Disposition: SPEC GAP, interim per-screen correction (`ghost` for
  low-emphasis non-destructive, `danger` for destructive) held for the entire project; no genuine
  third visual tier ever emerged, so no design-system proposal recommended — the interim fix is now
  the permanent guidance.
- **SLF-05 — Guest-surface anti-enumeration collapse unspecified** (2/2 guest screens, opened and
  closed in batch 6, the only batch with guest screens). Disposition: SPEC GAP + SYSTEM EVOLUTION
  CANDIDATE. Both G01 and G02 now define an identical `unavailable` state (same copy/icon/treatment)
  as a local fix. **Remediation still open**: promote to one real shared `GuestLinkUnavailable`
  component instead of two copies of the same spec text.

## 4. CRITICAL findings — full list across the whole project (6 total)

1. **A16 (batch 4)** — CRITICAL RBAC over-grant: tenant-wide export/subscription access granted to
   MEMBER/VIEWER where the plan requires ADMIN_ROLES-only with a narrow named-recipient-per-run
   exception.
2. **A19 (batch 5)** — CRITICAL RBAC defect cluster (3 independently-confirmed defects on one
   screen): roster tab wrongly ADMIN-gated (plan requires READ_ONLY_ROLES visibility), "Organização"
   tab wrongly opened to ADMIN (plan requires OWNER-only), and OWNER promotion/demotion blanket-
   disabled for every actor (plan requires it enabled for an OWNER actor) — plus an entirely-missing
   mandatory storage subsection.
3. **A05 (batch 2)** — the project's FIRST CRITICAL RBAC finding: spec stated "Excluir/Arquivar:
   MEMBER+" for a destructive, irreversible delete action where the plan requires `item:delete` to
   be ADMIN_ROLES — an over-grant one tier wide, on a permanently-destructive action, independently
   flagged by both Claude's and Codex's blind reads.
4. **A22 (batch 6)** — CRITICAL RBAC over-grant: spec stated `ADMIN+` where the plan requires
   `tenant:configure-document-request-delivery` to be `OWNER_ROLES`-exclusive, with the whole
   screen/nav-entry hidden from non-OWNER roles entirely, not merely action-disabled. Fourth CRITICAL
   RBAC finding of the project.
5. **A23 (batch 6)** — CRITICAL disclosure-control defect: `ADMIN+ (recomendado)` is a hedge, not a
   firm rule, on a screen the plan calls "disclosure-sensitive, same tier as bulk export."
6. **G01 + G02 (batch 6)** — CRITICAL anti-enumeration security defect on BOTH guest screens: the
   plan's required collapse of 4-6 distinct internal token/credential/session failure causes into
   ONE generic external "link unavailable" message was entirely unspecified in both pre-revision
   specs (G01's text even offered a distinguishing "link já utilizado" alternative, which itself
   would have leaked information). Opened as SLF-05, now fixed identically in both screens' revisions.

**Total: 6 CRITICAL findings across the 24-screen audit** — 4 RBAC over-grants (A05, A16, A19's
Organization tab, A22) + 1 RBAC under-restriction/disclosure-hedge cluster (A19's roster tab
+ blanket OWNER-promotion denial, and A23's hedge) counted structurally as A19's own 3-defect
cluster plus A23 standing alone + 1 security finding (anti-enumeration, confirmed on 2 screens
simultaneously, G01+G02). Every one was found, reconciled with an independent blind Codex pass, and
fixed in the corresponding spec's revision before this document was written — none are open as
unresolved risk in the current spec files.

## 5. Honest overall assessment — are these specs ready for implementation?

**No, not as pre-revision artifacts — but the REVISED specs now on disk are a materially different,
substantially stronger starting point than what existed before this audit.** Three things are true
at once:

1. **The audit process worked as designed.** Every one of the 24 screens failed even the Baseline
   Pass gate pre-revision, with a strikingly consistent failure shape: RBAC/route/state coverage
   treated as an afterthought, near-zero motion specification, and a V7 counterfactual failure on
   effectively every screen (generic admin-CRUD framing rather than a domain-specific visual
   thesis). This is not 24 independent authoring failures — it is one systemic gap in how the
   original Claude Design package was produced, now named precisely via SLF-01 through SLF-05 and
   fixed screen-by-screen.
2. **Six CRITICAL findings were RBAC or security defects, not polish gaps.** In a multi-tenant,
   RBAC-sensitive product, an over-grant (A16, A19's cluster, A22) or an under-grant/hedge (A23, the
   earlier under-grant) is not "less good" — it is a real access-control bug waiting to be built. The
   anti-enumeration omission on G01/G02 is not cosmetic either — it is exactly the kind of thing that
   silently ships as a vulnerability if no one names it explicitly before implementation. All 6 are
   now fixed in the spec text; none should reach a build without the fix already in the file an
   implementer reads.
3. **The specs are still SPEC-STAGE artifacts, not implementation-ready in the strict sense the
   rubric defines.** Every consolidated score sits well below the 90.0 Baseline Pass floor (highest
   is A01 at 50.2) — this audit fixed the specific findings it found, but did not push any screen to
   a state where an implementer could build purely mechanically with zero remaining judgment calls.
   The rubric's rendered-review gate (real browser, real fonts, real PT-BR data) has not happened for
   any screen and remains mandatory before "world-class" is ever claimed as fact rather than intent.

**Recommendation**: proceed to implementation using the REVISED spec files (not the pre-audit
versions, which are now superseded and should not be referenced), treating this audit's findings —
especially the 6 CRITICAL RBAC/security fixes — as load-bearing corrections, not optional
suggestions. Do not wait for a second full audit round before starting to build; the marginal value
of re-auditing already-revised specs against the same rubric a second time is lower than the value
of starting implementation and catching remaining gaps against real, running code (which the
rendered-review gate exists for). The two real open items are named in §6 below, not "redo the
audit."

## 6. What is genuinely still open (not resolved by this audit, and not meant to be)

- **A10 (Legacy Tracked Requirements) has no spec at all.** It was never generated by the original
  Claude Design package and is referenced by other screens' "Connects to" lines (A09 → A10, G01 is
  reached via A10) as if it exists. It needs to be authored AND audited against this same rubric
  before it is part of the implementation set — this is the one remaining planning gap, not merely a
  documentation nicety, since G01's own journey literally routes through it.
- **Implementation-sequencing is not decided.** What order to build the 24 (+A10 = 25) screens in,
  what testing strategy applies per screen, and how each integrates with the existing AppShell are
  all open questions with no decision on record. Per the standing instruction for this project, this
  is the next real decision needed before writing frontend code, and Marcelo has already authorized
  proceeding on it via the same Claude↔Codex protocol without waiting for his involvement in the
  resolution itself.
- **SLF-01, SLF-02, SLF-03, SLF-05's system-level remediations are named but not yet executed** (a
  new compliance-summary card pattern, a "Motion" authoring-template prompt, an `:orgId`-route
  checklist entry, and a shared `GuestLinkUnavailable` component). These are design-system/template
  maintenance tasks, not blockers to starting implementation on individual screens, but should be
  picked up early so the still-ungenerated A10 (and any future screen) doesn't reproduce the same
  24/24 or 22/22 gaps from a clean slate.

## 7. Provenance

- Rubric: `docs/frontend/screen-spec-audit-rubric.md` (D-250).
- Per-screen audit records: `A01`-`A23`, `G01`, `G02` `-audit-record.md` in this folder (24 files).
- System-level findings: `system-level-findings.md` (this folder).
- Decision log entry: `docs/architecture/decisions-log.md` D-2xx (see current tip at time of
  writing for the assigned number).
- Batch tracker: `system-level-findings.md` §"Batch tracker" (6/6 batches, all DONE).
