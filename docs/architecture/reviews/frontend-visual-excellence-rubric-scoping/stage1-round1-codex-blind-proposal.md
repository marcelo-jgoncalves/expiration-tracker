## 0. Position and assumptions

**External research before Round 1: SIM.**

I reviewed the converged D-247 rubric, the current `design-system.md`, and representative specs including A03, A13, A19, and G02. I also consulted identifiable first-party design-system material and design-engineering writing. No other Claude proposal was available to me.

My central conclusion is:

> A professional design system can prevent inconsistency, but it does not by itself produce an authored, world-class interface.

The current “Operational Calm” system is a credible baseline for consistency, accessibility, and maintainability. However, its present prescriptions—small type scale, neutral surfaces, standard page headers, compact tables, panels, restrained elevation—can also yield a polished but interchangeable administrative SaaS interface if each screen merely composes the default components.

The new rubric therefore must reward not only **system conformity**, but also:

- screen-specific visual judgment;
- information architecture expressed spatially;
- deliberate typography and density;
- interaction state craft;
- a recognizable product point of view;
- evidence that the designer made choices instead of delegating them to the component library.

This is an audit of **specified visual intent**, not proof of final rendered beauty. That distinction must remain explicit throughout.

---

## 1. Research grounding

### 1.1 What “world-class” means here

“World-class” should not mean decorative, fashionable, or unusually animated. For an operational B2B product, it means that the interface appears inevitable for its domain:

- the eye reaches the right information in the right order;
- dense information is calm rather than monotonous;
- spacing communicates relationships;
- typography performs real semantic work;
- statuses remain legible without becoming a wall of badges;
- actions feel located where the work happens;
- motion explains changes and preserves spatial continuity;
- common components have product-specific composition and behavior;
- visual polish survives real data, long strings, error states, and repeated daily use.

Linear, Vercel, Stripe, Notion, Arc, and Attio are useful references, but I will not attribute undocumented internal rules or pixel-level specifics to them. Public evidence is strongest for Linear’s product-development philosophy and Vercel’s Geist system; it is weaker for making objective claims such as “Attio uses exactly X spacing rhythm.”

### 1.2 Typography

A mature typography system is not merely a list of font sizes. It defines semantic combinations of:

- family;
- size;
- line height;
- weight;
- letter spacing;
- casing;
- numeral treatment;
- line length;
- behavior under density and localization.

Vercel’s Geist documentation is a concrete example: typography roles combine size, line height, weight, and letter spacing, and distinguish headings, labels, buttons, and multiline copy. It also names special treatments such as tabular numbers and mono variants. [Geist Typography](https://vercel.com/geist/typography)

For operational SaaS, a strong written spec should say more than “large title” or “secondary text.” It should establish, where relevant:

- what carries the page’s dominant visual weight;
- whether a number, entity name, status, deadline, or action is the primary signal;
- whether labels and values differ by weight, size, color, or alignment;
- whether numeric columns use tabular figures;
- whether timestamps, IDs, cron expressions, or technical values require mono;
- the intended measure of explanatory prose;
- how hierarchy survives truncation and wrapping;
- how many typographic emphasis levels coexist in one region.

More sizes and weights do not automatically improve the result. Excessive typographic variety is often a symptom of local styling rather than a coherent system.

### 1.3 Spacing and layout rhythm

An 8-point grid—or a compatible 4/8-based scale—is useful because it reduces arbitrary decisions. It is not a quality score by itself.

World-class spatial design uses controlled exceptions and relationships:

- tighter spacing inside a semantic group;
- larger separation between groups;
- intentional page margins and content widths;
- alignment across headers, tables, filters, actions, and detail regions;
- whitespace that establishes importance or pacing;
- density modes suited to the task rather than one universal “comfortable” spacing;
- asymmetric composition when it improves hierarchy.

Atlassian describes spacing and grid as systems for consistent page layout, while also treating borders, elevation, radius, and other foundations as separate tools. [Atlassian Design Foundations](https://atlassian.design/foundations)

The distinction matters: “all gaps are 16px” is technically orderly but visually weak. It gives unrelated and related elements the same distance, flattening the hierarchy.

### 1.4 Color and material systems

A sophisticated color system is not measured by how many hues it contains. It is measured by whether it supports the actual jobs of the interface:

- canvas and nested surfaces;
- selected, hovered, pressed, focused, disabled, and read-only states;
- subtle and strong text;
- interactive versus decorative borders;
- status backgrounds, borders, text, and icons;
- data visualization and threshold sequences;
- elevation and overlays;
- high-contrast and forced-color behavior;
- light/dark theme parity if dark mode is claimed.

Vercel’s public Geist color system gives scale stops explicit jobs: component backgrounds, borders, high-contrast backgrounds, and text/icon roles. That is materially richer than “purple primary, gray neutral, red danger.” [Geist Colors](https://examples.vercel.com/geist/colors)

Atlassian similarly treats elevation as coordinated surface and shadow behavior, warns that raised surfaces create noise when overused, and explains that dark themes cannot rely on shadows exactly as light themes do. [Atlassian Elevation](https://atlassian.design/foundations/elevation)

For this product, dark mode should not receive points merely for existing. The current decision—architecture-ready but not initially implemented—is reasonable. If a spec claims dark-mode support, however, it must specify parity for surfaces, statuses, focus, contrast, overlays, and charts; a mechanical inversion should receive little credit.

### 1.5 Motion and micro-interaction

The meaningful spectrum is not:

> animation versus no animation

It is:

> gratuitous motion → no continuity → deliberate explanatory motion.

Emil Kowalski argues that strong interface animation involves timing, easing, accessibility, performance, predictability, and natural continuity—not visual spectacle. He separately emphasizes that many interfaces do not need animation, even though well-chosen animation can improve predictability and perceived quality. [Great Animations](https://emilkowal.ski/ui/great-animations), [You Don’t Need Animations](https://emilkowal.ski/ui/you-dont-need-animations)

Josh Comeau’s transition guidance similarly covers timing functions, performance, action-driven motion, delayed-state problems, and reduced-motion preferences. [An Interactive Guide to CSS Transitions](https://www.joshwcomeau.com/animation/css-transitions/)

A strong SaaS motion specification names:

- the state transition being explained;
- the animated property;
- direction or spatial origin;
- approximate duration/easing token;
- interruption behavior;
- focus behavior;
- reduced-motion equivalent;
- what deliberately remains instantaneous.

Examples appropriate here include:

- a row selection connecting visibly to a detail panel;
- an accepted review item leaving the queue while focus moves predictably;
- progress changes during upload/import;
- a filter transition that preserves context;
- a drawer emerging from its trigger edge;
- restrained confirmation feedback after saving.

Animating every hover or fading every page is not excellence.

### 1.6 Density and hierarchy beyond “heading + table”

Operational products need multiple forms of hierarchy:

- grouping by urgency, owner, workflow stage, or exception;
- pinned or sticky decision context;
- inline expansion or contextual inspection;
- master/detail relationships;
- summary strips that genuinely support prioritization;
- visually subordinate metadata;
- progressive disclosure;
- batch-action affordances that appear with selection;
- comparison-oriented alignment;
- exception-first views;
- meaningful empty space around high-risk decisions;
- dense rows whose most important field remains scannable.

Vercel’s component guidance offers a useful example of context-specific composition: a sheet is recommended for persistent associated context such as row inspection, while a modal is reserved for blocking decisions. [Geist Sheet](https://vercel.com/geist/sheet)

The principle is more important than the component: the spatial model should fit the task. “Full-width list above, full-width detail below” is not automatically wrong, but a review queue spec must explain why that arrangement best supports repeated comparison and decision-making.

### 1.7 What makes SaaS UI look generic

There is no single authoritative research standard for “generic SaaS UI.” This part of the rubric is necessarily a reasoned synthesis supported by public design systems, observable recurring patterns, and practitioner critique.

The common failure signals are:

1. **Default dashboard anatomy**  
   Sidebar + page header + four equal metric cards + generic table, regardless of the product’s actual operating model.

2. **Uniform cardification**  
   Every region becomes a rounded white rectangle with the same padding, radius, border, and visual weight.

3. **Undifferentiated spacing**  
   Regular gaps everywhere, with no tighter semantic grouping or larger compositional pauses.

4. **Badge confetti**  
   Every state becomes a colored pill, producing noise and weakening truly urgent statuses.

5. **Token compliance without art direction**  
   Correct colors and radii, but no distinctive composition, interaction behavior, data treatment, or domain visual vocabulary.

6. **Component-name specification**  
   The document says `PageHeader`, `Panel`, `DataTable`, and `StatusBadge` but does not specify what makes their arrangement right for this task.

7. **One template repeated across every domain**  
   Documents, reviews, expirations, organization settings, and reports differ mostly in nouns.

8. **Decorative differentiation**  
   Gradients, oversized icons, glass effects, or illustration are added without improving comprehension.

9. **Demo-data beauty**  
   The design works with three short rows but has no position on long company names, 155-row density, missing values, asynchronous states, localization, or conflicting statuses.

10. **No interaction choreography**  
    Controls technically work, but selection, mutation, progress, and removal happen with abrupt or ambiguous state changes.

11. **Brand reduced to an accent color**  
    Changing purple to blue would make the product indistinguishable from another admin template.

Linear’s own method supports the broader premise that quality requires exploration and detailed feature-level design rather than mechanically fulfilling task descriptions. It describes design exploration, internal feedback, and detailed project specs as substantive work. [Linear: Manage Design Projects](https://linear.app/method/manage-design-projects)

Vercel likewise states that realistic product output needs more than styled components: design systems include type, spacing, motion, tone, patterns, and structure. [AI-powered prototyping with design systems](https://vercel.com/blog/ai-powered-prototyping-with-design-systems)

---

## 2. Research-derived grading checklist

The following criteria should govern the audit:

- Visual hierarchy must be described as an ordered perceptual path, not only as a component tree.
- Typography must identify semantic roles and exceptional treatments, not only inherit a scale.
- Spacing must express grouping, separation, alignment, and density.
- Color must identify state roles and interaction behavior, not only palette values.
- Motion must explain state change and include restraint/reduced-motion behavior.
- Each screen must contain evidence of task-specific composition.
- Repeated patterns must remain coherent across screens without forcing every screen into one template.
- Specs must address realistic data stress.
- Design-system conformity and design-system adequacy must be evaluated separately.
- Unsupported visual assertions must not receive full credit.
- Accessibility already covered functionally by D-247 must not be double-counted; the visual rubric covers perceptual accessibility only where inseparable from visual craft.
- A score for a written spec predicts **design readiness**, not rendered excellence.

---

## 3. Method: how text can—and cannot—be graded visually

### 3.1 The legitimate object of evaluation

From text alone, the auditor can evaluate whether the spec contains enough explicit design intent to make a high-quality rendered outcome likely and reviewable.

The auditor can inspect whether the spec answers questions such as:

- What is seen first, second, and third?
- Why is this region visually dominant?
- Which fields form one group?
- What is intentionally compressed?
- What is intentionally given space?
- Which alignment supports scanning?
- How do selection and mutation alter the composition?
- What varies from the standard component pattern, and why?
- What happens with real, ugly data?
- What aspect of this screen could only plausibly belong to this product?

The auditor cannot determine from text alone:

- whether the exact composition feels balanced;
- whether a 14px label looks optically weak with the selected font;
- whether the purple and neutral palette feels refined in context;
- whether motion actually feels responsive;
- whether a screen looks distinctive when rendered;
- whether icons, borders, shadows, and typography harmonize optically.

Therefore, the instrument must label its result:

> **Visual Specification Readiness**, not **Rendered Visual Excellence**.

A rendered/prototype review remains a later mandatory gate.

### 3.2 Evidence ladder

Each scored criterion should use this evidence ladder:

| Level | Evidence in the written spec |
|---|---|
| **0 — Absent/defaulted** | No relevant decision; outcome is left to the component library or implementer. |
| **1 — Intent only** | Uses adjectives such as “clean,” “calm,” “prominent,” or “compact,” without an operational decision. |
| **2 — Concrete decision** | Names hierarchy, grouping, density, component treatment, state behavior, or applicable design-system role. |
| **3 — Contextual rationale** | Explains why the decision fits this screen’s task/data and covers important variants or edge cases. |
| **4 — Reviewable specification** | Provides enough relational detail, state behavior, stress conditions, and system implications for another designer to render and critique it without inventing the core visual concept. |

“Reviewable” does **not** require arbitrary pixel values. A token or relational instruction can be more professional than a hard-coded number:

- Good: “Use the reading-width container; separate policy groups with the section spacing token, while label/value pairs use the compact internal gap.”
- Weak: “Everything has 16px gap.”
- Also weak: “Use good spacing.”

### 3.3 Evidence-confidence marker

Every audited axis should receive both:

- a score; and
- a confidence marker: `HIGH`, `MEDIUM`, or `LOW`.

`LOW` means important visual behavior has been inferred rather than specified. A visually plausible interpretation must not be silently credited to the author.

### 3.4 Text-only ceiling and later render gate

A written spec may score the full 100 points if it is exceptionally reviewable, but that means **100/100 specification readiness**, not proof of beauty.

Final implementation should later undergo:

1. rendered desktop review;
2. rendered narrow/mobile review;
3. high-density and long-content review;
4. interaction/motion review;
5. cross-screen coherence review.

Until then, the consolidated result should be labeled `SPEC AUDIT`, never `FINAL VISUAL AUDIT`.

---

## 4. Scoring anchors

Each axis should first be rated on a five-level anchor, then converted to its point weight.

| Rating | Description | Fraction of axis |
|---|---|---:|
| **0 — Absent** | No relevant evidence or directly contradictory decisions | 0% |
| **1 — Generic** | Blanket claim, component-library default, or token citation without screen reasoning | 25% |
| **2 — Adequate** | Some concrete decisions, but major relationships remain delegated or inconsistent | 50% |
| **3 — Strong** | Most relevant decisions are explicit, coherent, and task-specific; limited gaps remain | 75% |
| **4 — Exceptional** | Precise, distinctive, state-aware direction with rationale and little avoidable invention left to implementation | 100% |

Half steps are permitted: 2.5, 3.5, etc. The final score is not rounded for protocol purposes.

### Overall interpretation

| Score | Interpretation |
|---:|---|
| 0–39 | Visually unspecified |
| 40–59 | Functional/default-library direction |
| 60–74 | Professional baseline |
| 75–84 | Strong product-design specification |
| 85–89.99 | Highly crafted and implementation-ready |
| ≥90 | Exceptional written visual direction; eligible for “world-class intent,” pending render validation |

The phrase “world-class” should not be awarded conclusively before rendered and interactive review.

---

## 5. Applying the rubric to the current design system

`design-system.md` should be treated as **audited input**, not an unquestionable constraint.

For each screen, the auditor should record:

```text
Design-system relationship:
- Adopted:
- Specialized:
- Challenged:
- Missing:
```

Examples:

- **Adopted:** the semantic text hierarchy is sufficient.
- **Specialized:** A13 needs a selected-row treatment more explicit than the base `DataTable`.
- **Challenged:** uniform white bordered panels flatten the distinction between queue and decision area.
- **Missing:** no product-specific visual grammar for compliance percentage plus fraction.
  
A spec should not lose points merely for challenging the system. A justified challenge may be evidence of higher craft. Conversely, deviating for novelty without a reusable rationale should lose coherence points.

### Likely current constraints worth testing

Based on the documents inspected, the system has strong foundations in tokens, accessibility, calm tone, and component consistency. Its likely weak points are:

- “white cards + subtle borders + minimal shadows” may produce insufficient surface hierarchy if applied universally;
- `DataTable compact` appears to be the default answer for many different tasks;
- the product identity currently relies heavily on Plus Jakarta Sans and violet;
- the rules suppress excess effectively but say less about where controlled expression should appear;
- dark-mode architecture is supported, but actual perceptual parity is unproven;
- motion is systematized in principle, while the screen specs rarely describe temporal behavior;
- strict component reuse could discourage product-specific patterns unless specialization is explicitly welcomed.

These are audit hypotheses. Rendered comparisons should determine whether they are real limitations.

---

## 6. Consolidating the visual and D-247 functional rubrics

### Recommendation: 60% functional, 40% visual

```text
Consolidated score =
(D-247 functional score × 0.60)
+
(visual-spec score × 0.40)
```

Example:

```text
Functional: 92/100
Visual:     74/100

Consolidated:
92 × 0.60 + 74 × 0.40 = 84.8/100
```

### Why not 50/50

These are operational compliance and document-lifecycle screens. Incorrect RBAC, missing recovery, tenant ambiguity, or broken guest boundaries cannot be compensated by excellent visual design. D-247 therefore deserves the majority weight.

At the same time, 20–30% visual weight would allow a generic UI-kit result to pass comfortably on functional completeness alone, contradicting the purpose of this new audit. Forty percent is large enough that weak visual direction materially affects the outcome while preserving functional primacy.

### Non-compensatory gates

A combined score alone is unsafe. I recommend all of:

1. **Functional floor:** D-247 ≥ 85/100.
2. **Security/tenant floor:** no D-247 axis concerning RBAC, tenant context, or guest separation below 70% of its available points.
3. **Visual floor:** visual rubric ≥ 75/100.
4. **Anti-generic floor:** VE7 ≥ 9.8/14, equivalent to 70%.
5. **Exceptional claim:** “world-class intent” requires visual ≥90 and consolidated ≥90, followed by a render audit.
6. **Evidence gate:** if the visual direction requires major invention by the implementer, visual score is capped at 69 regardless of polished language.

These floors prevent a 98 visually / 55 functionally screen—or a 98 functionally / 45 visually generic screen—from being approved as excellent.

### Per-screen versus package-wide scoring

Some criteria cannot be judged responsibly from a single file. The audit output should contain:

- **Per-screen score:** all D-247 and VE axes applied to the individual screen.
- **Package-coherence modifier:** VE8 and relevant D-247 consistency findings checked across all 24 specs.
- **Missing-screen finding:** A10’s absence is a package completeness defect and should not be artificially charged against every individual screen.

Shared rules in `prototype-screen-specs/README.md` count as inherited evidence only when the individual screen clearly falls under them. The grader should not assume undocumented customization.

---

## 7. Recommended per-screen audit form

```markdown
# Screen <ID> — Consolidated audit

## Evidence classification
- Explicit visual decisions:
- Inherited design-system decisions:
- Unspecified / delegated decisions:
- Design-system challenges or missing capabilities:

## D-247 functional score
1. Backend/interface traceability: x/18
2. Journey/navigation: x/14
3. RBAC: x/14
4. States/recovery: x/14
5. Tenant context: x/10
6. Guest/auth separation: x/8
7. Responsive/accessibility: x/12
8. Handoff quality: x/10
Functional total: x/100

## Visual-spec score
1. Composition/hierarchy: x/18
2. Density/task-shaped layout: x/15
3. Typography: x/12
4. Spatial rhythm: x/12
5. Color/surface/depth: x/12
6. Feedback/motion: x/11
7. Product character/anti-generic: x/14
8. State/cross-screen coherence: x/6
Visual total: x/100

## Consolidated result
- Weighted score: (functional × .60) + (visual × .40)
- Functional floor: PASS/FAIL
- Security-boundary floors: PASS/FAIL
- Visual floor: PASS/FAIL
- Anti-generic floor: PASS/FAIL
- Evidence-sufficiency gate: PASS/FAIL
- Render validation still required: YES

## Highest-leverage revisions
1.
2.
3.
```

The “highest-leverage revisions” requirement matters: a rubric should lead to a better spec, not merely label the existing one.

---

## 8. Illustrative application to A03—not a full audit

A03 currently gives meaningful evidence for:

- responsive metric-card columns;
- numeric emphasis and tabular figures;
- operational ordering;
- deep links;
- urgency semantics;
- a compact attention table.

It leaves substantial visual questions unanswered:

- Are four metrics equally prominent, or is “Vencidos” the clear focal point?
- What surface or typographic treatment distinguishes urgent action from informational metrics?
- How does the scan move from overdue count to the first actionable row?
- Is the grid a generic KPI-card row or a product-specific expiration/compliance summary?
- What changes visually when a metric is zero, improving, or critically high?
- Is there a meaningful transition when filters/deep links are activated?
- Which shared axis aligns cards, panel title, and primary table content?
- What makes this dashboard recognizably Expiration Tracker without reading the nouns?

Under the proposed method, A03 would receive appropriate functional credit but could not receive high VE1, VE4, VE6, or VE7 scores merely because it names correct components and tokens. That is the desired behavior.

---

## 9. Bottom-line proposal

The core methodological position is:

> A written spec earns visual-excellence credit only for deliberate, inspectable visual decisions. Component-library compliance proves consistency; it does not prove composition, distinction, or craft.

The strongest consolidated instrument is therefore:

- D-247 retained at 100 points;
- a new eight-axis, 100-point Visual Design Specification rubric;
- 60/40 functional-to-visual weighting;
- non-compensatory functional, security, visual, anti-generic, and evidence floors;
- explicit audit of whether the current design system enables or constrains the best solution;
- mandatory later render validation before calling the delivered interface world-class.

## 10. Self-score

- **Research-grounding rigor: 8.8/10.** The proposal is grounded in first-party Linear, Vercel, Atlassian, and Emil Kowalski material plus a known practical design reference. The limitation is material: there is no authoritative empirical definition of “world-class SaaS visual design,” and I did not claim direct inspection of the named products’ complete current interfaces or private design systems.

- **Rubric usability and soundness for auditing spec files: 9.3/10.** It provides weighted axes, anchors, evidence classes, ceilings, gates, a repeatable form, design-system challenge handling, and a clear separation between spec quality and rendered quality. The main remaining validation is inter-rater calibration: two reviewers should independently score 3–5 representative specs, compare axis variance, and refine anchors where disagreement exceeds roughly 15% of an axis.
