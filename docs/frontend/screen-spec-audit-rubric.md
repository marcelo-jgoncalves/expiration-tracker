---
status: CONVERGED (D-2xx — see decisions-log.md for final number)
owner: Marcelo
authority: instrumento normativo para auditar `docs/frontend/prototype-screen-specs/*.md` (24
  telas) — não substitui D-247 (que grada o plano de inventário de telas), grada as specs
  concretas geradas a partir dele.
---

# Screen Spec Audit Rubric — functional + visual excellence, consolidated

Self-contained: a future auditing agent applies this document directly to one screen spec in
`docs/frontend/prototype-screen-specs/` without needing to re-read this scoping session. Produced
by one BLIND Claude↔Codex round + one reconciliation round (not the full 3-round protocol —
process note and both final scores in `docs/architecture/decisions-log.md` D-2xx and
`docs/architecture/reviews/frontend-visual-excellence-rubric-scoping/`).

## 0. What this rubric does NOT do

- It does not audit any of the 24 screen specs yet — this document is the instrument, not the
  audit. The audit pass is the next session's work (see `NEXT_SESSION_PROMPT.md`).
- It does not replace D-247's rubric — it reuses D-247's 8 functional axes unchanged (§2 below)
  and adds a new 8-axis visual instrument (§3), then defines how to combine them (§4).
- **It scores specified visual intent, not rendered beauty.** A written spec has no pixels. The
  ceiling of this rubric applied to a spec is `SPEC AUDIT` — "visual specification readiness" —
  never `FINAL VISUAL AUDIT`. A rendered/prototype review (browser, real fonts, real data) is a
  separate, later, mandatory gate before anything is called world-class in fact. This distinction
  must appear in every audit record produced from this rubric (see §6 template).

## 1. Methodological answer: how do you grade visual quality from text?

A written spec earns visual-excellence credit **only for deliberate, inspectable visual decisions**.
Naming a component (`DataTable`, `Panel`) or a design-system token proves conformity, not
composition, distinction, or craft. The auditor asks, per axis: does the spec assert a specific,
checkable visual decision, or does it silently let the component library's default carry the
outcome? Silence is a finding, scored low — the same discipline D-247 already applies to an
unmentioned error state.

**Evidence ladder** — every scored criterion is read against this ladder before being converted to
points:

| Level | Evidence in the written spec |
|---|---|
| 0 — Absent/defaulted | No relevant decision; outcome left to the component library or implementer. |
| 1 — Intent only | Adjectives ("clean," "calm," "prominent," "compact") without an operational decision. |
| 2 — Concrete decision | Names hierarchy, grouping, density, component treatment, state behavior, or a specific design-system role. |
| 3 — Contextual rationale | Explains why the decision fits this screen's task/data; covers important variants/edge cases. |
| 4 — Reviewable specification | Enough relational detail, state behavior, and stress conditions for another designer to render and critique it without inventing the core visual concept. |

"Reviewable" does not require hard-coded pixel values — a relational instruction can outrank a
number: *"Use the reading-width container; separate policy groups with the section-spacing token,
label/value pairs use the compact internal gap"* outranks *"16px gap everywhere"*, which outranks
*"good spacing."*

**Confidence marker** — every scored axis also gets `HIGH` / `MEDIUM` / `LOW` confidence. `LOW`
means the auditor inferred plausible visual behavior the spec never actually stated — a plausible
inference must never be silently credited to the author as if it were specified.

**Anti-gaming rule** — a spec earns no points merely for: naming tokens, giving exact pixels,
referencing a famous product, declaring itself "world-class"/"clean"/"premium", adding animation or
dark mode for their own sake, using more components, being long, or copy-pasting design-system
prose into every screen. Only a consequential design decision counts.

**What text alone can and cannot prove** — the auditor CAN assess: reading order and priority,
grouping rationale, intentional compression/expansion, alignment supporting scanning, what changes
under mutation/selection, deviation from the standard pattern and why, behavior under realistic
(ugly, long, PT-BR) data, and what could only plausibly belong to this product. The auditor CANNOT
assess from text alone: whether a composition feels balanced once rendered, whether a 14px label
looks optically weak in the chosen font, whether the palette feels refined in context, whether
motion actually feels responsive, or whether borders/shadows/type harmonize optically. Anything in
the second list is out of scope for this rubric and must wait for the rendered-review gate.

## 2. Functional axes — 100 points (D-247, reused unchanged)

Source: `docs/architecture/reviews/p0-frontend-screens-scoping/stage1-estado-final-consolidado.md`.
These 8 axes were converged to grade the *screen-inventory plan*; applying them to an individual
*screen spec* requires marking each criterion, per screen, as one of:

- `APPLICABLE` — scored normally against this screen.
- `SHARED/SYSTEM-LEVEL` — governed by the AppShell/README-level conventions (nav, RBAC table,
  reused UI conventions) rather than by this screen individually; reference the shared spec instead
  of re-deriving it, do not penalize the screen for not repeating it.
- `NOT APPLICABLE` — the criterion does not apply to this screen's shape (e.g. a form-only screen
  has no relevant "sortable table" criterion).

`APPLICABLE` points are renormalized back to 100 before computing `FunctionalScore`. **This
renormalized, applicable-only figure — not a raw sum that silently includes inapplicable axes — is
what every downstream floor/gate in §4 checks.**

1. Backend-to-interface completeness and traceability — 18
2. Journey, navigation, and screen-graph coherence — 14
3. RBAC-aware visibility and action model — 14
4. State, feedback, and recovery coverage — 14
5. Multi-tenant organization context and isolation UX — 10
6. Guest/authenticated surface separation — 8
7. Responsive, mobile, and accessibility planning — 12
8. Zero-context handoff quality and internal consistency — 10

(Full criterion text per axis: see the source file above — not duplicated here to avoid drift; if
this rubric and that file ever disagree, that file wins per `AGENTS.md` §5 precedence for a
specific-decision document over a later document that reuses it.)

## 3. Visual-excellence axes — 100 points (new, this session)

### V1. Perceptual hierarchy and task-led composition — 20

Deliberate visual reading order tied to the user's actual job on this screen.

Full credit: explicit first/second/third attention priority; dominant entity/deadline/exception/
decision identified; explained summary↔detail relationship; grouping/separation rules; action
placement tied to its object; task topology fits the job (list/detail, wizard, inspector, timeline,
comparison — not defaulted); intentional asymmetry/emphasis/whitespace; hierarchy preserved across
states and viewport transforms.

Loses points: the spec is only a vertical component inventory; every section has equal weight; a
bare `PageHeader + cards + table` pattern with no screen-specific rationale; critical and secondary
information compete; layout mirrors backend entities rather than the user's decision process.

### V2. Typography and numeric/data legibility — 13

Typography treated as an information system, not a font choice.

Full credit: semantic text roles named; disciplined number of hierarchy levels; deliberate weight/
size/line-height relationships; line-length treatment for prose; tabular figures for dates/counts
where useful; mono reserved for genuinely technical values; wrapping/truncation/expansion behavior
stated; hierarchy that does not depend on color alone; behavior with realistic PT-BR organization/
document names (long CNPJ-bearing strings, long fornecedor names).

Loses points: "large/small/muted" with no named role; too many weights/sizes; widespread tiny
metadata; strong emphasis everywhere; arbitrary pairing; fixed-width assumptions based only on the
sample copy shown.

### V3. Spatial rhythm, alignment, and density — 14

Whether spacing creates meaning and density fits the task's frequency/complexity.

Full credit: consistent alignment anchors; distinct intra-group vs inter-group spacing; intentional
container width; density matched to repeated-work screens; compact/expanded regions used
selectively; whitespace around major decisions; explicit behavior under dense/realistic data;
responsive reflow preserving relationships (not just "stacks on mobile").

Loses points: uniform gaps everywhere; excessive card padding; every screen sharing identical width/
density regardless of task; whitespace used only decoratively; dense content solved only by
horizontal scroll; spacing so generous it slows frequent operational work. **An 8pt grid earns no
credit by itself — what is scored is how the scale is composed, not whether it exists.**

### V4. Color, contrast, surfaces, and depth — 11

Semantic sophistication beyond flat primary/neutral/danger, and perceptual discipline.

Full credit: clear surface hierarchy; interactive borders visually distinct from decorative ones;
complete hover/selected/pressed/focus/disabled/read-only role coverage; restrained status salience
(not every state screaming); color used redundantly with text/icon/shape, never alone; elevation
tied to hierarchy, not decoration; dark-mode parity only if claimed (never scored down for not
claiming it).

Loses points: brand accent color doing 100% of the interactive-affordance work; every status given
equal chromatic weight; shadow/card overuse; "subtle" text that is actually low-contrast; ad hoc
one-off colors outside the system; dark mode as a naive inversion; palette depth added with no
semantic purpose.

### V5. Component craft and visual state completeness — 12

Whether components are specified beyond their default library appearance.

Full credit: meaningful anatomy beyond the bundle's default prop list; alignment/density variants
named; hover/focus/selected/loading/error/empty/success states each actually described (not just
"handle errors"); affordance clarity; state transitions without avoidable layout shift; treatment of
inline actions, destructive actions, row/batch selection, overlays, sticky regions; intentional,
named departures from the generic component recorded as reusable pattern candidates.

Loses points: component names substituted for design decisions; every status rendered as a badge;
every container a card; actions visually detached from their target; default library variants
accepted with zero evaluation; error/loading states named functionally (per D-247 axis 4) but never
described visually.

### V6. Micro-interaction, motion, and continuity — 9

The choreography of change — including deliberate non-animation.

Full credit: motion attached to a meaningful state transition; direction/origin consistent with
spatial causality; a duration/easing token or named motion family; loading/progress continuity;
focus restoration and post-action landing spot; interruption/rapid-repeat behavior where relevant;
a reduced-motion equivalent; explicit naming of which transitions stay instantaneous.

Loses points: no stated position on abrupt state changes; generic "subtle animation" language with
no specifics; blanket fades; animation added as decoration; motion that slows down high-frequency
actions; missing reduced-motion behavior. **A quiet, motion-free screen can score full credit if the
spec convincingly states why motion is unnecessary here — silence is scored low, an explicit
"no motion, because X" is scored high.**

### V7. Product-specific authorship and anti-template distinctiveness — 17

**Intentionally the largest single axis — this is the direct proxy for Marcelo's "not yet as
professional and world-class as I'd like."**

Full credit: a screen-specific visual thesis; patterns derived from this product's actual domain
(urgency, evidence lineage, review responsibility, renewal cycles, confidence, missing requirements,
provenance, temporal risk) rather than generic admin-CRUD framing; priority encoded through layout
and comparison, not badge color alone; at least one authored decision where the generic dashboard
pattern would clearly be worse; a coherent visual vocabulary reused across related screens; a
distinctive choice made without novelty for novelty's sake.

Loses points: four (or any N) equal KPI cards followed by a table as the default dashboard shape
with no differentiation by role/risk; interchangeable panels; the same page template with different
nouns; brand identity reduced to "buttons are purple"; decorative gradient/illustration substituted
for actual product-specific structure; one-off visual gimmicks that never form a system.

**Counterfactual test (apply to every screen, record the answer explicitly)**: replace every
product noun in the spec's described layout with a generic placeholder ("Item", "Category", "Owner").
If the composition still reads as indistinguishable from any admin-CRUD template and communicates no
distinctive operating model, **this axis cannot score above 8/17**, regardless of how polished the
rest of the spec is.

### V8. Cross-screen coherence and visual-spec auditability — 4

Deliberately small — documentation verbosity must never outweigh design quality.

Full credit: shared pattern references named explicitly; local departures justified, not silent;
token/variant implications stated; dependencies on unresolved design-system capabilities named;
enough relational detail that another designer could review the intended result without inventing
it; no contradictions with neighboring screens already audited.

## 4. Combining into one consolidated score

```
FunctionalScore   = D-247 applicable-only score, renormalized to /100   (§2)
VisualSpecScore   = V1..V8 sum                                          (§3, out of 100)

ConsolidatedSpecScore = 0.60 × FunctionalScore + 0.40 × VisualSpecScore
```

**Why 60/40, not 50/50**: this is still an implementation spec for an operational, RBAC-sensitive,
multi-tenant product — a beautiful screen missing permissions, states, recovery, or guest isolation
is not merely "less good," it may be unusable or unsafe, so functional correctness keeps majority
weight. But a 75/25 or 80/20 split (visual as a minor tie-breaker) would let a merely-adequate,
generic-template spec pass comfortably on functional strength alone — the exact failure Marcelo is
trying to correct with this whole exercise. Worked example: Functional 96 / Visual 65 scores 88.3 at
75/25 (passes a 9.0-equivalent gate) vs. 83.6 at 60/40 (fails it) — the 60/40 split is the point at
which visual mediocrity becomes materially, not cosmetically, consequential. Independently, Claude's
Round-1-blind draft derived a ~62/38 split by a different chain of reasoning (100/60 point totals);
landing within 2 points of Codex's 60/40 is treated as convergent validation of the ratio itself.

### Gates (non-compensatory — a weighted average alone can hide a severe imbalance)

**Baseline pass** (spec is auditable/adequate, not yet claiming world-class):
```
FunctionalScore        ≥ 90.0
VisualSpecScore         ≥ 85.0
ConsolidatedSpecScore   ≥ 90.0
No single axis (functional or visual) below 60% of its available points
No unresolved S3/S4 finding (D-247's severity model, reused)
```

**World-class-ready at spec stage** (stricter — this is what Marcelo is actually asking for):
```
FunctionalScore          ≥ 90.0
VisualSpecScore          ≥ 90.0
ConsolidatedSpecScore    ≥ 90.0
V7 (product-specific authorship) ≥ 13.5 / 17
Rendered review still pending — this tier is "spec-stage" only, see §0
```

The V7 floor exists specifically to stop a highly systematic, internally consistent, but visibly
generic spec from passing as world-class merely by averaging up on the other 7 axes.

**Provisional-calibration note (Claude's amendment, accepted in reconciliation)**: both numeric
floors above (85.0 / 90.0 / 13.5-of-17) are reasoned estimates, not yet calibrated against any real
scored spec — this session scored zero of the 24 specs. The first batch of 5-8 audited screens
should be treated as a calibration set: if most or all of them fail the *world-class-ready* tier
specifically (not the baseline tier) on the same axis, treat that as evidence the threshold itself
needs revisiting and say so explicitly in the audit write-up, rather than silently lowering the bar
screen-by-screen or silently declaring screens world-class by ignoring the gate.

### Interpretation bands (for `VisualSpecScore` alone)

| Score | Interpretation |
|---:|---|
| 0–39 | Visually unspecified |
| 40–59 | Functional/default-library direction |
| 60–74 | Professional baseline |
| 75–84 | Strong product-design specification |
| 85–89.99 | Highly crafted and implementation-ready |
| ≥90 | Exceptional written visual direction — "world-class intent," pending render validation |

Never announce "world-class" as an accomplished fact from a spec-stage score alone — only as
intent pending the rendered-review gate (§0, §7).

## 5. Design-system-as-precedent, not fence — required disposition per finding

Per Marcelo's explicit instruction, `docs/frontend/design-system.md` ("Operational Calm") is
evidence to reconcile against, not an unquestionable constraint. Every visual finding that conflicts
with the current design system must be classified as exactly one of:

- **SPEC GAP** — the screen simply failed to use an adequate rule the system already provides.
- **SYSTEM GAP** — the system lacks a token, pattern, density mode, typographic role, motion
  behavior, or domain primitive that excellence on this screen would require.
- **SYSTEM CONSTRAINT** — an existing normative system rule actively degrades this screen.
- **JUSTIFIED EXCEPTION** — a local departure from the system is warranted and should stay local,
  not become a new system rule.
- **SYSTEM EVOLUTION CANDIDATE** — a locally-useful departure is good enough that it should become a
  new reusable system pattern (i.e., the design system should change, not just this screen).

**System-level gate**: if the same SYSTEM GAP/CONSTRAINT recurs across 3 or more screens, or affects
a foundational primitive (the type scale, the metric-card pattern, the AppShell), the audit opens
ONE system-level finding with one remediation owner — it must not multiply the same root cause into
24 independent per-screen penalties. Likely candidates already visible without a full audit (named
as hypotheses here, not findings — confirm per-screen during the real audit):
- the flat, structurally-identical metric-card grid pattern (README §"Convenções", A03, A09) is the
  clearest concrete instance of the V7 "generic dashboard" failure mode and recurs by construction
  since the README defines it as a shared convention;
- the design system's type scale/motion tokens exist, but none of the specs sampled during this
  scoping session (A03, A04, A08, A09, A11, A16, A19) state any transition/motion treatment at all —
  worth checking whether this is a spec-authoring gap (SPEC GAP, 24 independent instances) or the
  system genuinely offering no guidance for when to use its own motion tokens (SYSTEM GAP, one
  finding).

## 6. Per-screen audit record template

```
Screen:
Route:
Primary task:
Spec version/date:

Functional score (applicable-only, renormalized): __/100
Visual specification score: __/100
Consolidated score: __/100
Gate result: BASELINE PASS | WORLD-CLASS-READY | NOT PASS (name which floor failed)

Visual confidence: HIGH | MEDIUM | LOW
Classification: SPEC AUDIT — rendered excellence not yet verified

Perceptual reading order (as described or inferred):
1.
2.
3.

D-247 axes (applicable / shared-system-level / N/A marked per criterion): __/100 → normalized __/100

V1 Hierarchy/composition:        __/20
V2 Typography/data legibility:   __/13
V3 Rhythm/alignment/density:     __/14
V4 Color/surface/depth:          __/11
V5 Component/state craft:        __/12
V6 Motion/continuity:            __/9
V7 Product authorship:           __/17   (counterfactual test result: __)
V8 Coherence/auditability:       __/4

Findings:
- Critical:
- Major:
- Moderate:
- Minor:

Design-system dispositions:
- SPEC GAP:
- SYSTEM GAP:
- SYSTEM CONSTRAINT:
- JUSTIFIED EXCEPTION:
- SYSTEM EVOLUTION CANDIDATE:

Evidence excerpts (file:line):
-

Required revision:
-

Rendered-review checks to defer to the later gate:
-
```

## 7. Provenance

- Research: `docs/architecture/reviews/frontend-visual-excellence-rubric-scoping/research-notes.md`
  (Claude, real cited web sources, accessed 2026-09-09).
- Round 1 BLIND proposals: `round1-claude-proposal.md` (Claude, 8 axes/60 pts, self-score 7.8/10),
  `stage1-round1-codex-blind-proposal.md` (Codex, `codex exec --skip-git-repo-check`, V1-V8/100 pts,
  self-score 8.8/9.3).
- Reconciliation: `reconciliation.md` — Claude 9.1/9.4 evaluating Codex's Round 1 in full, both
  ≥9.0, gate met in one blind round + one reconciliation round (process deviation from the nominal
  3-round protocol, stated explicitly, same discipline as D-249).
- This document is the sole normative output; the reviews folder is evidence trail, not itself
  authoritative for future audits.
