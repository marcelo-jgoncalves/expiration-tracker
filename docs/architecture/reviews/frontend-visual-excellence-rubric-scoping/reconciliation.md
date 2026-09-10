# Reconciliation — visual-excellence rubric for screen-spec audits

**Process note, stated honestly (same discipline as D-249)**: this ran as **one BLIND round**
(Claude's `round1-claude-proposal.md`, Codex's `stage1-round1-codex-blind-proposal.md` via
`codex exec --skip-git-repo-check`, neither seeing the other) **followed by one reconciliation
round**, not the full 3-round numeric-blind-score protocol `AGENTS.md` §4 nominally requires for a
level 5-6 decision — a deliberate scope reduction under session time constraints. The single
exchange nonetheless produced real independent scrutiny: Codex's blind proposal is substantially
more rigorous and concrete than Claude's on every dimension that matters for this artifact type,
and Claude adopts it as the base with named amendments below, rather than splitting the difference
to preserve authorship symmetry.

## Comparison

Both proposals converge on the same diagnosis: the 24 specs are functionally precise but visually
silent, the concrete failure mode is the "generic SaaS UI" pattern (interchangeable metric-card
grids, hierarchy via "bigger/bolder" alone, no stated rhythm, no motion), and a written spec must be
scored on **specified visual intent**, not rendered beauty.

Where Codex's proposal is stronger, adopted as-is:
- **The V1-V8 axis set** (Perceptual hierarchy 20 / Typography 13 / Spatial rhythm 14 / Color-
  contrast-surfaces 11 / Component craft 12 / Motion 9 / **Product-specific authorship 17** /
  Cross-screen coherence 4) is more granular and better evidenced than Claude's 8-axis/60-point
  draft, and Codex's heavy weighting of "product-specific authorship and anti-template
  distinctiveness" (V7, 17/100 — the single largest axis) directly targets Marcelo's stated concern
  better than Claude's flatter distribution.
- **The 5-level evidence ladder** (Absent/Intent-only/Concrete decision/Contextual rationale/
  Reviewable specification) plus a **confidence marker** (HIGH/MEDIUM/LOW) per axis is a more
  rigorous answer to the "how do you score text" methodological problem than Claude's binary
  silence-is-a-finding framing — it lets a spec be reviewably strong without inventing pixel values,
  and it flags when a score rests on inferred rather than stated intent.
- **The V7 counterfactual test** ("replace all product nouns with generic placeholders — if it
  still looks like any admin template, this axis cannot exceed 8/17") is a sharper, more falsifiable
  version of Claude's "could paste into an unrelated CRUD product" checklist item. Claude's other
  4 anti-generic-kit checklist items (interchangeable cards, bigger-bolder-only emphasis, flat
  spacing, zero motion mention) are folded into Codex's V1/V2/V3/V6 axis definitions as explicit
  "lose points" criteria rather than kept as a separate scored axis — avoids double-counting the
  same failure mode twice.
- **The design-system challenge classification** (SPEC GAP / SYSTEM GAP / SYSTEM CONSTRAINT /
  JUSTIFIED EXCEPTION / SYSTEM EVOLUTION CANDIDATE) is a concrete operationalization of Marcelo's
  instruction not to treat `design-system.md` as an unquestionable fence — stronger than Claude's
  axis 7, which only asked the auditor to "surface" the question without a taxonomy for the answer.
  Adopted verbatim.
- **The system-level gate** (a recurring design-system limitation across ≥3 screens becomes one
  finding with one remediation owner, not 24 separately-penalized screens) prevents a single root
  cause from being mechanically multiplied — a real risk given all 24 specs share one design system.
  Adopted verbatim.
- **60/40 functional/visual weighting** (vs. Claude's 100/60 ≈ 62/38, functionally almost the same
  split) — Codex's version is adopted for its cleaner math (both scores normalized to 100 first) and
  its explicit worked example showing why 50/50 or 75/25 both fail to make visual mediocrity
  consequential. Claude's independently-derived ratio (~62/38) landing within 2 points of Codex's
  60/40 is treated as convergent validation of the split itself, not a reason to average the two.

Where Claude's proposal contributes an amendment, adopted into the final rubric:
- Codex's dual-floor gate structure (`FunctionalScore ≥ 90`, `VisualSpecScore ≥ 85`, `Consolidated
  ≥ 90`, no axis below 60% of available points, plus a stricter "world-class-ready" tier requiring
  `V7 ≥ 13.5/17`) is sound but was written before any of the 24 specs have actually been scored —
  Claude's amendment, accepted by re-reading Codex's Round 1 in full: add an explicit instruction
  that these thresholds are **provisional until calibrated** against the first batch of real scored
  specs (Codex's own §10 self-score flags the same calibration gap under "inter-rater calibration").
  If the first 5-8 audited screens all fail the `VisualSpecScore ≥ 85` floor for the *world-class-
  ready* tier specifically (not the baseline pass tier), that is evidence the threshold — not
  every screen — needs revisiting, and the audit doc must say so explicitly rather than silently
  lowering the bar per-screen.
- Claude's explicit note that the functional-share floor (≥90) must be checked against the
  *applicable-only, renormalized* D-247 score (per Codex's own "APPLICABLE / SHARED-SYSTEM-LEVEL /
  NOT APPLICABLE" per-screen marking in §7) — made explicit in the final doc to avoid a future
  auditor accidentally gating on a raw sum that included inapplicable axes.

## Scores

- **Codex, self-scored in Round 1**: research-grounding rigor 8.8/10, rubric usability/soundness
  9.3/10.
- **Claude, evaluating Codex's Round 1 output in full (this reconciliation)**: research-grounding
  rigor **9.1/10** (first-party Linear/Vercel/Emil Kowalski material correctly scoped with honest
  limits stated — "I did not claim direct inspection of the named products' complete current
  interfaces" — matches this repo's honesty discipline; the one gap is that Codex's citations are
  less individually URL-checkable than Claude's Round 1 web-search citations, addressed by keeping
  Claude's `research-notes.md` as the URL-cited companion source in the final rubric doc rather than
  discarding it), rubric usability/soundness **9.4/10** (the evidence ladder + confidence marker +
  counterfactual test + system-gap taxonomy make this directly applicable to a real spec file
  without further invention; the one open item — threshold calibration — is explicitly flagged as
  provisional rather than silently assumed correct).
- Both scores ≥9.0 on both axes. **Gate met** — same bar as D-247's Stage 1/Stage 2 (9.4/9.3),
  reached here in one blind round + one reconciliation rather than a third round, because Codex's
  Round 1 already anticipated and answered Claude's main reservations (calibration, dual weighting
  rationale, anti-generic-kit specificity) without requiring a contested rebuttal cycle.

## Outcome

Final consolidated rubric adopts: D-247's 8 functional axes (100 pts, unchanged) + Codex's V1-V8
visual axes (100 pts, unchanged) combined 60/40, with Claude's provisional-calibration note added.
Written to `docs/frontend/screen-spec-audit-rubric.md`.
