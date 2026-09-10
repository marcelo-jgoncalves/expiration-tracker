# Claude Round 1 — Implementation Sequencing Proposal (independent, pre-Codex)

## Grounding facts verified directly against code (not assumed from docs)

The task brief's premise ("only A04/A05 exist today") is **stale** — direct inspection of
`frontend/src/routes/` and `git log -- frontend/` shows substantially more real, tested code
already shipped than `core-expiration-vertical-slice.md` alone documents:

| Route (real file) | Maps to plan screen | Real state |
|---|---|---|
| `items/*` (Collection/Detail/Create/Renew) | A04/A05 | Full CRUD+renew, OCC, idempotency — the flagship slice |
| `subjects/SubjectsCollection`, `subjects/SubjectDetail` | A08/A09 | Partial — read/review only, "deliberately no create subject affordance yet" (BLOCKER-C Variante B scope) |
| `Members.tsx` | A19 (roster sub-tab) | Partial — roster list real |
| `Settings.tsx` | A19 (organization sub-tab) | Partial — displayName/timezone update, leave, close (D-120/D-122/D-125) |
| `ActivityLog.tsx` | A23 | Real — `GET /activity`, D-149 |
| `AcceptInvitation.tsx`, `Onboarding.tsx` | A02 | Partial |
| `Overview.tsx` | precursor to A03 | Read-only dashboard, thinner than A03's spec (4+1 counters) |
| `NotImplementedPlaceholder.tsx` | everything else | Explicit honest stub, not a silent 404 |

Design system components already real (`frontend/src/components/ui/`): `Button`, `Checkbox`,
`DataTable`, `Divider`, `IconButton`, `InlineNotice`, `Layout`, `Link`, `RadioGroup`,
`StatusBadge`, `Switch`, `UrgencyIndicator` — plus motion tokens already defined
(`design-system.md` §21, `fast/normal/slow`). No `CompactMetricCard`/risk-prioritized card variant
(SLF-01) and no shared `GuestLinkUnavailable` (SLF-05) component exist yet.

175 commits touch `frontend/`; 27 test files under `frontend/test/`, 5 E2E spec files (including
visual regression with real Windows snapshots) under `frontend/e2e/`.

**Implication for this plan**: build order should be expressed as "finish/harden partially-built
screens first" where a screen already has a real route, not just "build in journey order from
zero" — re-doing discovery on Subjects/Members/Settings/ActivityLog from scratch would waste the
work already done and risk regressing it.

## 1. Build order

Recommend a **hybrid**: group by shared component/data DNA first (minimizes redundant discovery,
per the task's own framing), sequenced so each block also completes one full journey from §6 of
the plan — not pure journey-vertical (too slow to reach re-usable primitives) nor pure ID order
(A06/A07/A10 before A08/A09 makes no sense, since A08/A09 are the anchor most other screens link
back to and are already partially built).

Blocks (see full detail in the final doc): 
0. Foundation — SLF-01 metric-card pattern, SLF-05 `GuestLinkUnavailable`, spec-authoring template
   updates (SLF-02/03 checklist entries) — NOT full up-front, see §5 below for why only these two.
1. Harden the two already-started anchors to their full spec: A08/A09 (Subjects, add
   create/update/delete + real compliance summary card using the new SLF-01 pattern) + A02
   (finish Onboarding/picker) + A01 (Sign-in, currently entirely missing despite being the true
   entry point — surprising gap, first priority).
2. Expiration completion: A06 (Reminder Policy), A07 (generic file attachment) — both attach
   directly onto the already-shipped A05, smallest incremental surface, closes journey "Track and
   renew an expiration" fully.
3. Document-archive core: A11 (Requirements, tenant-wide) → A12 (Document Detail) → A13 (Review
   Queue) — this trio shares the most data/component DNA (DocumentVersion lifecycle, evidence
   linking) and closes 3 of the 12 named journeys.
4. Requests/guest loop: A14 (Requests & Recurrence) → G02 (guest submission) → A10 (Legacy Tracked
   Requirements, our only WORLD-CLASS-READY spec, built with full lessons applied) → G01 (legacy
   guest). A10 last in this block deliberately — by the time we build it we want the guest
   anti-enumeration pattern (SLF-05) already extracted as a shared component from G02, so A10/G01
   consume it rather than re-derive it.
5. Admin/catalog: A20 (Document Types), A21 (Templates), A22 (Delivery Settings) — share the
   "tenant catalog CRUD" shape.
6. Reporting/oversight: A16 (Reports), A17 (Dossier), finish A19 (storage subsection + RBAC fixes
   from the CRITICAL findings), finish A23 if any gaps remain.
7. Personalization/close-out: A18 (Notification Preferences), A15 (Bulk Import — intentionally
   last, highest complexity/lowest urgency, depends on Subjects+Requirements existing first), A03
   (Dashboard — deliberately LAST of the authenticated screens despite being "first thing a user
   sees," because its 5 cards each deep-link into screens that must already exist to wire real
   links, not TODO stubs).

A10 is *not* used to dictate the whole order (task explicitly said it doesn't have to) — it's
placed in block 4 because that's where its natural sibling (G01) sits, not because it's the best
score.

## 2. AppShell/foundation integration

Read real code: `AppShell` nav is currently thinner than §3's 7-item list. Adding items is
additive (new `<Link>` entries + RBAC-aware conditional render, reusing `useCurrentMembershipRole`
which already exists per `Settings.tsx`'s import). Real risk to the shipped Core Expiration slice:
low, if nav additions are colocated with each block (never one big nav rewrite) and the existing
E2E suite (`expiration-vertical-slice.spec.ts`, `visual-regression.spec.ts`) re-runs green after
every block — treat that suite as the regression gate for the Core Expiration slice specifically,
never edited to make new screens pass.

## 3. Testing tiers

Blanket 96-unit+12-E2E-per-4-screens is not sustainable for 24 more screens (would be ~600 unit +
~70 E2E tests, disproportionate to a pre-launch/no-real-user context per `AGENTS.md` §1). Propose
3 tiers:
- **Tier A (flagship rigor, = A04/A05 precedent)**: screens carrying money/destructive/RBAC-
  CRITICAL history — A05 already is one; extend to A19 (3 CRITICAL RBAC findings), A16 (1
  CRITICAL), A17 (dossier export, ADMIN-only), A22, A23, G01/G02 (anti-enumeration security
  property). Full unit+component+E2E, explicit RBAC-matrix test per role.
- **Tier B (standard)**: everything else with real mutations — A02, A08/A09, A11, A12, A13, A14,
  A20, A21. Unit+component coverage for state machine/RBAC, 1 E2E happy-path per screen (not per
  screen-pair).
- **Tier C (light)**: read-mostly or low-consequence — A03, A06, A07, A15 (import has its own
  heavy async-state testing need despite being "light" RBAC-wise — flag as Tier B for async-state
  coverage specifically), A18, A10 (ironically WORLD-CLASS spec but legacy/lower-traffic —
  component+contract tests, E2E only for the guest-link-issuance path shared with Tier A's G01).

## 4. Block-boundary protocol review

A "block" = one of the 8 groups above (not per-screen, not fixed batch-of-4) — sized by shared
DNA/journey completion, typically 2-4 screens. Recurring Claude↔Codex review after each block
checks: (a) implementation fidelity to the audited spec (RBAC tiers, states, route shape) — reuse
the existing rubric's functional axis; (b) real rendered visual review (closes the rubric's own
§0 spec-vs-rendered gap) — screenshot/Playwright visual diff against the design system, not just
code review; (c) regression — the block's own new E2E + the flagship Core Expiration E2E suite
both green; (d) nav/RBAC-visibility correctness for anything newly added to AppShell.

## 5. Design-system foundation work sequencing

NOT all up-front. Only SLF-01 (metric-card pattern) and SLF-05 (GuestLinkUnavailable) block real
work (A03/A09 need the card now-ish, G01/G02 need the shared component before block 4) — build
them as small, real components in Block 0, sized in days not weeks. SLF-02 (motion) and SLF-03
(:orgId route checklist) are process/checklist fixes, not components — apply as authoring-checklist
edits in Block 0 (near-zero cost) rather than "foundation work." Rationale: front-loading all
system-level work risks the classic "redesign before any real screen ships" trap; these two are
small enough (single component each) that doing them first is cheap AND unblocks the screens that
need them, unlike a hypothetical full design-system-v2 pass.
