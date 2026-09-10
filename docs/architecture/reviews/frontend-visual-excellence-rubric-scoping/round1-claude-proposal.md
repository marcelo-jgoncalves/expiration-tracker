# Round 1 (BLIND) — Claude's visual-excellence rubric proposal

Written before seeing any Codex output. Grounded in `research-notes.md` (same file, this
directory).

## Methodological challenge, addressed directly

A written spec has no pixels, so no axis below can be scored by looking at a rendered screen. Every
axis is instead scored by asking: **does the spec assert a specific, checkable visual decision, or
does it only name a component and let the design system's default carry the outcome silently?**
A screen spec that never mentions type scale, rhythm, or hierarchy technique is not "neutral" on
this rubric — it scores low, the same way a functional spec that never mentions an error state
scores low on D-247's State axis. Silence is a finding, not an N/A, for every axis below except
Motion/Micro-interaction (§4), where "explicitly no motion, stated as a deliberate choice" is
distinguished from and scored higher than "motion never mentioned."

## Proposed axes (8 axes, 60 points — see §"Weighting" for why 60, not 100, on this half)

1. **Typographic hierarchy discipline (8)** — does the spec assert which type-scale step, weight,
   and color each text element uses, and do at least two hierarchy techniques (scale, weight,
   color/opacity) combine rather than relying on "bigger and bolder" alone for every emphasized
   element? (research §1, §5)
2. **Spacing/rhythm as a deliberate tool (8)** — beyond a single flat padding value, does the spec
   describe any intentional variation in spacing to create grouping or emphasis (not just "uses the
   design system's spacing tokens")? (research §2)
3. **Color system sophistication and restraint (8)** — does the spec use color only where semantic
   (status/urgency) rather than decoratively, and does it avoid introducing ad hoc color while still
   using color-family depth (not one flat swatch per state) where the design system provides it?
   (research §3)
4. **Micro-interaction / motion intentionality (6)** — is any state transition (loading→result,
   panel open/close, list reorder) given an explicit, purposeful treatment, or explicitly and
   justifiably declared static — vs. simply unmentioned? (research §4)
5. **Density and hierarchy technique diversity (8)** — for screens with multiple simultaneous
   information units (dashboards, list views), does the spec differentiate them structurally/
   visually by role (e.g., a risk-carrying metric treated differently from a neutral navigation
   count), or are all such units interchangeable in the "generic stat-card grid" pattern named in
   research §6? This is the single most direct proxy for the "not yet world-class" complaint.
6. **Anti-generic-kit checklist (10)** — apply the 5-point checklist from research §6 verbatim
   (interchangeable cards / bigger-bolder-only emphasis / flat spacing / zero motion mention /
   "could paste into an unrelated CRUD product unchanged") — each failed check costs 2 points.
7. **Design-system-as-precedent honesty (6)** — does the audit (of this spec) surface, where
   relevant, whether the *design system itself* (not just the screen's application of it) caps
   achievable visual quality on this screen — required to satisfy Marcelo's explicit instruction not
   to treat `design-system.md` as an unquestionable fence.
8. **Internal visual consistency across the 24 specs (6)** — are the same visual decisions (e.g. how
   a metric-card grid is treated) applied identically across screens that share a pattern, or does
   visual treatment silently drift screen to screen with no shared rationale?

Total: 8+8+8+6+8+10+6+6 = 60.

## Weighting rationale (visual 60 vs. functional 100 → not 50/50)

D-247's functional rubric is 100 points and already gates P0 launch-readiness (can a screen be built
end-to-end, correctly, safely). Visual excellence is real and explicitly prioritized by Marcelo for
this pass, but it is a *quality ceiling*, not a *correctness floor* — a visually mediocre but
functionally complete and safe screen can still ship and be improved later; a functionally broken
screen (missing RBAC, missing error state) cannot ship regardless of how polished it looks. I
propose combining as **functional 100 + visual 60 = 160 total, functional retaining ~62% weight**,
preserving D-247's 9.0/10-equivalent gate on the functional share alone as a hard floor, with the
visual score reported both combined and separately so a screen can be flagged "functionally ready,
visually needs work" without conflating the two. Final proposed combined threshold: total ≥ 144/160
(90%) AND functional share alone ≥ 90/100, so visual quality cannot be used to average away a
functional gap, matching this repo's "no rounding, no averaging past a gate" discipline (AGENTS.md
§4).

## Self-score

7.8/10 — confident in the research grounding and the anti-generic-kit checklist (most concrete,
directly actionable part), less confident the weighting rationale is the only defensible split, and
aware 8 axes at these point values is one plausible carve-up among several.
