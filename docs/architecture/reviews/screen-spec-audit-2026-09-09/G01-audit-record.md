# G01 — Legacy Guest Upload — Screen Spec Audit Record

**Process note**: one BLIND Codex pass (batch 6/6, A22/A23/G01/G02 audited together in a single
prompt, `codex exec --skip-git-repo-check`) + one Claude reconciliation round.

**Reconciliation — a confirmed security-relevant Critical finding, distinct in kind from this
project's RBAC findings.** Claude's pre-Codex read flagged that the spec's only failure-state text
("mostrar sempre o estado `sent`... ou uma mensagem de 'link já utilizado'") never states the
anti-enumeration collapse the plan requires (§2.5): invalid/expired/revoked/not-found token must
ALWAYS present as ONE generic external message, "link já utilizado" being only ONE of several
internal causes and — as worded — a *distinguishing* message rather than the generic collapse.
Codex's blind pass independently reached the identical conclusion with identical severity
("Critical — anti-enumeração"), and additionally flagged that offering *both* `sent` and "link já
utilizado" as alternatives ("ou") leaves the choice unspecified rather than naming one generic
state — a defect Claude's first pass had under-weighted as phrasing rather than a structural gap.
Both reads converge on Critical; Codex's finding is adopted in full as the reconciled position.

---

Screen: G01 — Legacy Guest Upload / "Upload de convidado (rastreamento legado)"
Route: `/guest/upload/:token` (spec, pre-revision) — canonical plan route:
`/guest/document-requests/:token`.
Primary task: fulfil a legacy `DocumentRequest` via a single-step, token-authenticated upload, no
login.
Spec version/date: undated, audited 2026-09-10.

Functional score (applicable-only, renormalized): 36.8/100
Visual specification score: 51.0/100
Consolidated score: 42.5/100
Gate result: **NOT PASS** — a Critical anti-enumeration security defect, route mismatch, and
D7 (responsive/a11y) at 2/12.

Visual confidence: HIGH
Classification: SPEC AUDIT — rendered excellence not yet verified (rubric §0).

Perceptual reading order (as described or inferred):
1. Wordmark.
2. Card title + organization/document-type description.
3. Stage-dependent body (dropzone → pending → success).
4. Fixed footer (deadline, one-time-link notice).

D-247 axes (axis 3 [RBAC] and axis 5 [multi-tenant org context] marked N/A — guest surface has no
Role or org-switching concept per plan §2.5; 76 applicable points, renormalized):
1. Backend-to-interface completeness and traceability — 10/18 (the single-step upload flow and the
   "no approval feedback to guest" rule are captured; malware/type verification is referenced but
   not stated for this surface specifically).
2. Journey, navigation, and screen-graph coherence — 6/14 (route diverges entirely from the plan's
   canonical `/guest/document-requests/:token`; "reachable only via a link delivered from A10" and
   "on success, ends in an in-page confirmation, no navigation into the authenticated app, ever" are
   not explicitly restated on this screen even though they are true of it).
3. RBAC-aware visibility and action model — N/A (guest surface, no Role concept).
4. State, feedback, and recovery coverage — 4/14 (**Critical**: the four-cause anti-enumeration
   collapse required by plan §2.5 is not specified — the spec's own post-use-attempt text offers
   `sent` OR "link já utilizado" as alternatives rather than naming the ONE required generic
   "link indisponível" state covering invalid/expired/revoked/not-found/already-used uniformly;
   file-invalid, size-exceeded, malware-rejected, upload-failure/timeout/retry states are all
   absent — referencing A07 does not specify guest-surface behavior).
5. Multi-tenant organization context and isolation UX — N/A (guest surface).
6. Guest/authenticated surface separation — 2/8 (correctly has no AppShell/nav — a real strength —
   but does not explicitly state the absence of Organization nav/switcher/Role logic the way the
   plan's own G01 entry does, leaving it implicit rather than asserted).
7. Responsive, mobile, and accessibility planning — 2/12 (plan requires this surface be designed
   mobile-first as "the single highest-likelihood-of-mobile-use surface in the whole product"; spec
   states none of: labeled file/camera-picker equivalent, keyboard operability of the dropzone,
   upload-progress announcement to assistive tech).
8. Zero-context handoff quality and internal consistency — 4/10 (the single-step vs. G02's
   three-step distinction is stated clearly and is a genuine strength; the post-use-attempt
   ambiguity undercuts overall consistency).

V1 Hierarchy/composition:        13/20  (evidence level 2 — HIGH)
V2 Typography/data legibility:   6/13   (evidence level 1 — MEDIUM)
V3 Rhythm/alignment/density:     9/14   (evidence level 2 — HIGH)
V4 Color/surface/depth:          5/11   (evidence level 1 — MEDIUM)
V5 Component/state craft:        7/12   (evidence level 2 — HIGH)
V6 Motion/continuity:            1/9    (evidence level 0 — HIGH)
V7 Product authorship:           8/17   (evidence level 2 — HIGH)  (counterfactual test: **fails** —
  removing organization/document-type/deadline leaves a generic single-file upload portal; the
  no-approval-loop notice and deadline add context but do not change the visual model; capped at
  8/17, scored at the cap)
V8 Coherence/auditability:       2/4    (evidence level 1 — MEDIUM)

Findings:
- Critical: the four-cause anti-enumeration collapse (invalid/expired/revoked/not-found → ONE
  generic "link indisponível" message, no distinguishing copy/icon/visual treatment) required by
  plan §2.5 is not specified; the spec's own "sent OR link já utilizado" phrasing risks a
  distinguishing message rather than the required generic collapse, and leaves the choice between
  the two unresolved.
- Major: route mismatch (`/guest/upload/:token` vs. plan's `/guest/document-requests/:token`).
  Missing recovery states: invalid file, size-exceeded, malware/type-rejected, upload failure,
  timeout, retry, connection loss — referencing A07 does not specify this public surface's own
  behavior.
- Moderate: dropzone has no stated keyboard-accessible equivalent, focus behavior, file
  removal/replacement, or progress announcement to assistive tech; no stated behavior for a long
  organization name; the `uploading` state replaces the entire card body with no stated protection
  against layout shift, cancellation, or rapid-repeat submission; no motion/transition treatment
  (SLF-02).
- Minor: absence of AppShell/Organization nav is correct in substance; "one-time link" access is
  correctly never conflated with RBAC.

Design-system dispositions:
- SPEC GAP: anti-enumeration collapse, route, recovery states, accessibility of the upload
  interaction.
- SYSTEM GAP: SLF-02 (motion) — tracked centrally.
- SYSTEM EVOLUTION CANDIDATE: a reusable "generic unavailable-link" pattern for guest credential
  failures (shared visual treatment for the anti-enumeration state) is a strong candidate to promote
  once G02 is also audited and confirms the same need (see G02's record) — this would be the guest
  surface's equivalent of an authenticated-app error boundary, defined once and reused by G01/G02
  and any future guest screen.
- JUSTIFIED EXCEPTION: none.

Evidence excerpts (file:line):
- `docs/frontend/prototype-screen-specs/G01-upload-convidado-legado.md:30` — "Link de uso único:
  após envio bem-sucedido, o link deve invalidar novos envios (mostrar sempre o estado `sent` se
  acessado novamente, ou uma mensagem de 'link já utilizado')."
- `docs/frontend/p0-screen-inventory-plan.md:120-124` (§2.5) — "Four distinct internal failure
  causes (invalid, expired, revoked, not-found token) must always collapse into ONE generic external
  message ('this link is unavailable')... never build a UI that reveals which of the 4 causes
  applies."
- `docs/frontend/p0-screen-inventory-plan.md:637` (G01 States) — "the token's underlying cause of
  unavailability... is never distinguished externally — always one generic 'unavailable' message."

Required revision:
- Define exactly one generic external state, `link indisponível` (or equivalent product copy), that
  covers ALL of: invalid token, expired token, revoked token, not-found token, AND an already-used
  one-time link — identical copy, identical icon, identical visual treatment in every case. Remove
  the "ou" alternative between `sent` and "link já utilizado"; a re-visit after successful submission
  shows the SAME generic unavailable state as any other invalid-token case, never a distinguishing
  "already submitted" message (that would itself leak which of the causes applied).
- Correct the route to `/guest/document-requests/:token`.
- Add file-invalid, size-exceeded, malware/type-rejected, upload-failure, timeout, retry, and
  connection-loss states.
- Add a stated non-drag-and-drop upload alternative, keyboard operability, focus management, and
  progress announcement to assistive tech (plan explicitly names this the highest-mobile-use
  surface in the product).
- Add one concrete motion decision (or an explicit "no motion, because X").

Rendered-review checks to defer to the later gate:
- Whether the 480px card width and gray sunken background read as trustworthy/branded once rendered
  with a real long PT-BR organization name.
