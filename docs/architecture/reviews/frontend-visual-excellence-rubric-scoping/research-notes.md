# Research notes — what separates "professional/world-class" SaaS visual design from merely functional design

Real web sources, accessed 2026-09-09 via WebSearch. Honesty discipline (D-225/D-247 precedent): where
a claim below has no single checkable citation, it is marked as synthesis, not sourced fact.

## 1. Typography systems

- **Linear** — typography built on Inter Variable with OpenType features `cv01`/`ss03` enabled
  globally, weight range 300 (light body) to 510 (medium, Linear's signature weight) to 590
  (semibold emphasis); tighter line-heights on headings + slight negative letter-spacing for
  scannability at high information density. Source: [Linear Design Tokens, Typography & CSS
  Variables — DesignMD](https://designmd.cc/benchmarks/linear), [Design System Inspiration of
  Linear — hagicode](https://design.hagicode.com/designs/linear.app/DESIGN.md), accessed
  2026-09-09.
- **Stripe** — typography exclusively `sohne-var` at weight 300 even at 56px display size,
  described as "confident restraint rather than corporate shouting"; deep-navy (not pure black)
  heading color for warmth; no shadows anywhere, depth from background-tint shifts only. Source:
  [Stripe design system — Refero Styles](https://styles.refero.design/style/48e5de76-05d5-4c4e-a269-c7c245b291ec),
  [Stripe Design System, Tokens and DESIGN.md](https://www.designmd.co/d/stripe), accessed
  2026-09-09.
- **Modular type scale** — a base size multiplied by a consistent ratio (e.g. 16px × 1.25 Major
  Third → 16/20/25/31.25/39/48.8) is the standard mechanism cited for "sizes relate to each other
  proportionally," attributed to Robert Bringhurst's "Elements of Typographic Style," adapted to
  web by Tim Brown. Source: [spec.fm Typographic Scales](https://spec.fm/specifics/type-scale),
  [IBM Design — A Deep Dive on Typescales](https://medium.com/design-ibm/a-deep-dive-on-typescales-16c7b1473d83),
  accessed 2026-09-09.
- **Measure and line-height** — optimal line length 45-75 characters (66 ideal); line-height 1.4-1.6
  for body text as a baseline, scaling up toward 1.6-1.7 for longer lines. This is presented as a
  cognitive-load constraint, not a stylistic preference. Source:
  [UXPin — Optimal Line Length](https://www.uxpin.com/studio/blog/optimal-line-length-for-readability/),
  [Zell Liew — Responsive Web Typography](https://zellwk.com/blog/responsive-typography/), accessed
  2026-09-09.
- **Synthesis (not independently sourced as a named rule)**: the common thread across Linear/Stripe
  is *discipline*, not novelty — a small number of weights used with intent, a scale that is
  visibly a scale (not ad hoc pixel values), and heading colors/weights that are a deliberate choice
  rather than the browser default black-on-white.

## 2. Spacing / layout systems

- **Linear** — base unit 8px; documented scale includes 1, 4, 7, 8, 11, 12, 16, 19, 20, 22, 24, 28,
  32, 35px — the odd values (7, 11, 19, 22, 35) are optical-alignment micro-adjustments layered on
  top of a recommended clean 4px scale (4/8/12/16/24/32) for general use. Source: same DesignMD/
  hagicode sources as above, accessed 2026-09-09.
- **Synthesis**: an 8pt (or 4pt) grid is table stakes at this point, cited across virtually every
  modern design-system write-up surveyed; what differentiates "considered" from "generic" is (a)
  whitespace used asymmetrically/deliberately to create emphasis rather than uniformly padding every
  box the same amount, and (b) an explicit optical-correction layer for cases where the strict grid
  looks mechanically "off" (Linear's 7/11/19/22/35 values). A spec that only ever says "16px padding
  everywhere" without any rhythm variation is a symptom of the generic-kit look, not evidence of
  discipline.

## 3. Color system sophistication

- **Stripe** — near-monochrome canvas + exactly one vivid accent (`#533afd`); a purpose-built
  extensible theming architecture that generates additional themes (e.g. a "darker" mode for
  developer surfaces) from tokens, using a WCAG-contrast-driven algorithm to derive tints
  automatically rather than hand-picking each one. Source: [Stripe Design System |
  DesignSystems.one](https://www.designsystems.one/design-systems/stripe-design), accessed
  2026-09-09.
- **Linear** — dark-mode-first; density and hierarchy communicated mostly through *subtle
  gradations of white opacity* over the near-black canvas rather than introducing new colors —
  i.e., color restraint is itself a hierarchy technique, not just an aesthetic choice. Source: same
  Linear sources as above, accessed 2026-09-09.
- **Synthesis**: "semantic tokens beyond primary/neutral/danger" in top-tier systems means (1) a
  full numeric scale per hue (e.g. 50-900) used consistently for tint/shade derivation instead of
  one flat value per semantic role, (2) contrast computed/verified programmatically rather than
  eyeballed, and (3) dark-mode treated as a first-class palette with its own considered values, not
  a mechanical CSS-filter inversion of the light palette.

## 4. Micro-interaction / motion quality

- **Emil Kowalski** (design engineer, Linear; previously Vercel; author of Sonner/Vaul,
  "Animations on the Web"): motion philosophy centers on knowing *when not to animate* — "the goal
  is not to animate for animation's sake, it's to build great user interfaces." Named principles:
  Purpose Over Decoration (every animation communicates a state change, never decoration alone),
  Restraint is a Superpower (strip animation from actions a user performs 100+ times a day —
  frequent interactions should feel instant), Speed Equals Responsiveness (150-300ms typical for UI
  transitions, effectively never exceeding ~400ms), Frequency Dictates Motion (higher-frequency
  actions get faster/subtler transitions, or none). Source: [claude-skills/design-motion-principles
  — emil-kowalski.md](https://github.com/leadgenjay/claude-skills/blob/main/skills/design-motion-principles/references/emil-kowalski.md),
  accessed 2026-09-09 (secondary compilation of his publicly stated views — his own site/course was
  not independently re-verified word-for-word, flagged here per the honesty discipline).
- **Synthesis**: the failure mode on the "too much" side is decorative animation with no state
  meaning (bouncing icons, fade-everything). The failure mode on the "too little" side — the more
  likely one for a written spec like this project's — is a spec that never mentions transition/
  motion treatment for state changes at all (an async operation just "becomes" its result with no
  described transition), which reads as an unconsidered default rather than a deliberate choice to
  omit motion.

## 5. Density and information hierarchy beyond "heading + table"

- Hierarchy techniques documented across the sources above: **weight** (Linear's 300→510→590
  ladder), **scale** (a real modular type scale, not 2-3 ad hoc sizes), **color/opacity** (Linear's
  white-opacity gradation), and **spatial grouping/whitespace** (asymmetric, purposeful spacing) —
  used *in combination*, not color alone. A generic spec that establishes hierarchy only via "bigger
  and bold" for every emphasized element, with no secondary technique, is a specific, checkable
  symptom.

## 6. What actually gets named in "generic SaaS UI" / "made with a UI kit" critiques

- Named, recurring complaints (2026 sources): "even, default spacing everywhere"; "components
  straight out of a UI kit"; "a dashboard that is a grid of near-identical stat cards"; "the same
  screen repeated with different labels"; "looks like a generic Tailwind page"; "the whole product
  is just a series of dashboards"; "screams vibe-coded." A named business consequence: a
  distinctive UI can reportedly command "a 30-50% price premium" over a template-look product
  (marketing claim from a design-agency source, not independently verified — flagged). Source:
  [SaaS UI Looks AI-Generated? 7 Fixes — saasui.design](https://www.saasui.design/blog/saas-ui-looks-ai-generated),
  accessed 2026-09-09.
- **This is the concrete, checkable failure mode the new rubric axis must catch.** It reduces to a
  short, testable checklist for a *written spec* (see rubric doc): (a) are dashboard/list metric
  cards visually and structurally interchangeable across screens with no per-screen point of view;
  (b) is every emphasis technique "make it bigger/bolder" with no secondary technique; (c) is
  spacing/padding declared as a single flat value with no rhythm; (d) is there zero mention of any
  micro-state transition; (e) could the visual description of this screen be pasted into an
  unrelated CRUD SaaS product without any adaptation.

## 7. Do the current 24 screen specs show this failure mode already? (skim beyond the 2-3 already read)

Skimmed additionally: `A04-vencimentos.md`, `A08-fornecedores.md`, `A11-requisitos.md`,
`A16-relatorios-exportacoes.md`, `A19-time-organizacao.md` (in addition to A03/A09 read in full
earlier this session).

- **Symptom (a) — interchangeable metric-card grids**: A03 (`docs/frontend/prototype-screen-specs/A03-dashboard.md:10-15`)
  describes "Grid de 4 métricas (cards-link, grid repeat(4,1fr))" — count + label, all four cards
  structurally identical, differentiated only by which count/link they carry. A09
  (`A09-subject-hub.md:14-18`) repeats the same shape ("Grid de cards de link... cada card = contagem
  grande + label + nota"). This is exactly critique-item (a) above: the same visual unit (big number
  + label) reused with no per-context visual differentiation (e.g. no distinct treatment for a
  count that represents risk/urgency vs. one that is neutral navigation).
- **Symptom (b)/(c) — flat emphasis, no declared rhythm**: none of the specs skimmed describe any
  spacing value, rhythm, or hierarchy technique beyond component name + "grande" (big) for emphasis
  and tone (`critical`/`warning`/`neutral`) for status color. The specs are functionally precise
  (exact copy, RBAC, data shape) but visually silent — hierarchy is implied entirely by *which
  named component* is used (`PageHeader`, `Panel`, `DataTable`), not by any described visual
  relationship between elements on the page. This matches the "not yet as professional... as I'd
  like" framing directly: the specs are functionally excellent (this is what D-247's rubric already
  scores highly) and visually under-specified, which is a different failure than "bad visual design"
  — it is *unaudited* visual design, because nothing about layout rhythm, type scale application, or
  motion is ever asserted per-screen for a reviewer to check.
- **Symptom (d) — zero motion/transition mentions**: across all 7 specs skimmed, the only
  state-transition language is the generic `AsyncFeedback state="PENDING"` / `InlineNotice`
  convention from the shared README — no screen states a transition duration, easing, or which
  changes animate vs. snap. Under the Kowalski framework this is not necessarily wrong (absence of
  motion is a legitimate choice) but it is unstated, so it cannot be distinguished from "never
  considered" — which is itself the rubric's methodological challenge, addressed in the rubric doc.

## Honest gaps

- No single external source independently scores a *written, pre-render UI spec* for "world-class
  visual design" — same honesty gap named in D-247 for the functional rubric. The rubric below is a
  reasoned synthesis translating pixel-level critique criteria into spec-checkable proxies, not a
  citation of an existing audit instrument.
- The "30-50% price premium" and a few softer claims from the saasui.design source are
  marketing-adjacent and not independently verified; used only as color/motivation, not as a scored
  criterion.
