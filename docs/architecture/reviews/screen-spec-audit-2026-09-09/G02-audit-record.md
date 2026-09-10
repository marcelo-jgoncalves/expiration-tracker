# G02 — Document Archive Guest Request — Screen Spec Audit Record

**Process note**: one BLIND Codex pass (batch 6/6, A22/A23/G01/G02 audited together in a single
prompt, `codex exec --skip-git-repo-check`) + one Claude reconciliation round.

**Reconciliation — the same anti-enumeration Critical finding as G01, plus a confirmed
first-write-wins replay-policy omission (D-243/D-244).** Claude's pre-Codex read flagged that the
spec never states the generic-unavailable collapse for the credential-failure case (§2.5), and
separately that D-243/D-244's first-write-wins replay policy (a resubmission with the same
idempotency key and a different `documentTypeId` must return the ORIGINAL accepted snapshot,
unchanged, never re-validated against the new value) is absent from the spec entirely, even though
`documentTypeId` itself is correctly modeled as a mandatory field with no "unspecified type"
fallback. Codex's blind pass independently reached both conclusions with matching severity
(Critical for anti-enumeration, Major for the replay-policy omission), and additionally flagged that
Etapa 2 (file step) does not disable "Continuar" without a file selected, unlike Etapa 1's explicit
disabled-until-selected discipline for the document-type step — a real internal inconsistency
Claude's first pass had not separately itemized. Both reads converge; Codex's figures and the
additional file-step finding are adopted in the reconciled position.

---

Screen: G02 — Document Archive Guest Request / "Solicitação de documento (convidado)"
Route: `/guest/request/:token` (spec, pre-revision) — canonical plan route:
`/document-archive/guest/document-requests/:token`.
Primary task: resolve a credential, start a guest session, and submit evidence (with a mandatory
`documentTypeId`) into a document-archive `DocumentRequest`, via a 3-step wizard.
Spec version/date: undated, audited 2026-09-10.

Functional score (applicable-only, renormalized): 35.5/100
Visual specification score: 50.0/100
Consolidated score: 41.3/100
Gate result: **NOT PASS** — a Critical anti-enumeration security defect, an omitted mandatory
replay policy (D-243/D-244), and D7 (responsive/a11y) at 2/12.

Visual confidence: HIGH
Classification: SPEC AUDIT — rendered excellence not yet verified (rubric §0).

Perceptual reading order (as described or inferred):
1. Wordmark + step badges.
2. Card title (current step name) + fixed supplier/requirement description.
3. Step body (document-type select → file dropzone → review summary → final confirmation).
4. Step navigation (Voltar/Continuar).

D-247 axes (axis 3 [RBAC] and axis 5 [multi-tenant org context] marked N/A — guest surface has no
Role or org-switching concept per plan §2.5; 76 applicable points, renormalized):
1. Backend-to-interface completeness and traceability — 8/18 (`documentTypeId` correctly modeled as
   a mandatory select with no "unspecified type" fallback — matches D-243/D-244; but the
   first-write-wins replay policy required by the same decisions is entirely absent from the spec).
2. Journey, navigation, and screen-graph coherence — 7/14 (route diverges from the plan's canonical
   `/document-archive/guest/document-requests/:token`; wizard step-to-step navigation is otherwise
   coherent).
3. RBAC-aware visibility and action model — N/A (guest surface, no Role concept).
4. State, feedback, and recovery coverage — 4/14 (**Critical**: the anti-enumeration collapse for
   credential invalid/expired/revoked/not-found is entirely unspecified, same defect class as G01;
   missing: options-loading, empty-options-list, load-failure/retry, DocumentType deprecated between
   selection and submit, file validation/size/malware, uploading, timeout, double-submit prevention,
   safe-reload recovery mid-wizard. **Major**: the D-243/D-244 first-write-wins replay policy — same
   idempotency key + different `documentTypeId` must return the ORIGINAL accepted snapshot unchanged
   — is not stated anywhere in the spec, even though it is a named, decided, mandatory behavior for
   this exact screen).
5. Multi-tenant organization context and isolation UX — N/A (guest surface).
6. Guest/authenticated surface separation — 3/8 (no AppShell is correctly implied by the layout
   line, but the spec never explicitly asserts the total absence of Organization nav/switcher/
   Role-based logic the way the plan's own entry does).
7. Responsive, mobile, and accessibility planning — 2/12 (plan requires mobile-first design and "the
   ability to correct a field before final submit"; step badges have no stated progress semantics
   (`ol`/current-step announcement), no focus management on step change, no error announcement, no
   non-visual step-navigation alternative).
8. Zero-context handoff quality and internal consistency — 3/10 (Etapa 1's disabled-until-selected
   "Continuar" discipline is not mirrored on Etapa 2, which never states the file is required before
   continuing — an internal inconsistency between two structurally similar steps).

V1 Hierarchy/composition:        15/20  (evidence level 2 — HIGH)
V2 Typography/data legibility:   6/13   (evidence level 1 — MEDIUM)
V3 Rhythm/alignment/density:     8/14   (evidence level 2 — MEDIUM)
V4 Color/surface/depth:          4/11   (evidence level 1 — MEDIUM)
V5 Component/state craft:        7/12   (evidence level 2 — HIGH)
V6 Motion/continuity:            1/9    (evidence level 0 — HIGH)
V7 Product authorship:           7/17   (evidence level 2 — HIGH)  (counterfactual test: **fails** —
  substituting requirement/document-type/evidence for request/category/file leaves a generic
  `select category → attach → review` wizard; capped at 8/17, scored 7 for the slightly stronger
  step-badge/summary structure vs. G01)
V8 Coherence/auditability:       2/4    (evidence level 1 — MEDIUM)

Findings:
- Critical: the four-cause anti-enumeration collapse (invalid/expired/revoked/not-found credential
  → ONE generic external message, no distinguishing copy/icon/visual treatment) required by plan
  §2.5 is entirely unspecified for this screen.
- Major: route mismatch (`/guest/request/:token` vs. plan's
  `/document-archive/guest/document-requests/:token`). The D-243/D-244 first-write-wins replay
  policy is omitted — a resubmission with the same idempotency key and a different `documentTypeId`
  must return the original accepted snapshot unchanged, never re-validate against the new value; as
  currently unspecified, an implementer has no guidance and could build the wrong (re-validating)
  behavior. Etapa 2's "Continuar" is not stated as disabled until a file is selected, unlike Etapa
  1's explicit discipline for the type select. Missing recovery states: options load/empty/failure,
  DocumentType deprecated between selection and submit, file validation/size/malware, uploading,
  timeout, double-submit, safe mid-wizard reload.
- Moderate: spec does not explicitly assert the total absence of Organization nav/switcher/Role
  logic (true in substance, per the layout line, but not stated as plan §2.5 requires); uses a
  `tertiary` Button variant (SLF-04 — the design system defines only primary/secondary/ghost/danger;
  `ghost` is the correct substitute for "Voltar," a low-emphasis non-destructive action); step
  badges have no progress semantics (`ol`, current-step announcement) or focus management on step
  change; the "pode ser solicitado a corrigir um campo" copy does not say by which channel or who
  initiates the correction, leaving a real ambiguity next to the "não pode reverter" statement; no
  motion/transition treatment between steps (SLF-02).
- Minor: `documentTypeId` is correctly modeled as a mandatory field with no "unspecified type"
  fallback, matching D-243/D-244 — this does not compensate for the missing replay policy, but is a
  genuine strength worth preserving in the revision.

Design-system dispositions:
- SPEC GAP: anti-enumeration collapse, route, replay policy, Etapa 2 disabled-state, recovery
  states, wizard accessibility, correction-channel ambiguity.
- SYSTEM GAP: SLF-02 (motion) — tracked centrally.
- SYSTEM CONSTRAINT / SPEC GAP: `tertiary` Button variant (SLF-04, tracked centrally) — corrected to
  `ghost` in this revision.
- SYSTEM EVOLUTION CANDIDATE: same reusable "generic unavailable-link" pattern named in G01's
  record — now confirmed on BOTH guest screens (2/2), which is itself the rubric §5 recurrence
  signal; recommend promoting this to a real shared guest-surface pattern (one visual treatment, one
  copy string, reused by G01/G02 and any future guest screen) rather than two independently-authored
  local fixes. Recorded here and cross-referenced; not a new system-level finding entry since it is
  local-fix-first per the rubric's process (a design-system maintainer can promote it later).
- JUSTIFIED EXCEPTION: none.

Evidence excerpts (file:line):
- `docs/frontend/prototype-screen-specs/G02-solicitacao-documento-convidado.md` — no failure-state
  section for credential invalid/expired/revoked/not-found exists anywhere in the file.
- `docs/architecture/decisions-log.md` D-243 — "política de replay quando a mesma `idempotencyKey`
  reaparece com um `documentTypeId` diferente (decidido: payload-agnostic, first-write-wins...)".
- `docs/frontend/p0-screen-inventory-plan.md:653-663` (G02 entry) — `documentTypeId` mandatory (no
  fallback), first-write-wins replay explicitly named, anti-enumeration collapse explicitly named.

Required revision:
- Define exactly one generic external state, `link indisponível` (matching G01's revised wording for
  cross-screen coherence, V8), covering invalid/expired/revoked/not-found credential, session not
  started/expired, and invalid CSRF token uniformly — identical copy/icon/visual treatment.
- Correct the route to `/document-archive/guest/document-requests/:token`.
- Add an explicit first-write-wins replay-policy statement in the business-rules section: a
  resubmission with the same idempotency key and a different `documentTypeId` returns the original
  accepted snapshot unchanged; the UI must never imply a re-review or re-validation happened.
- Add "Continuar" disabled-until-file-selected to Etapa 2, mirroring Etapa 1's discipline.
- Replace `tertiary` with `ghost` for "Voltar" (non-destructive, low-emphasis, reversible action).
- Add options-load/empty/failure, DocumentType-deprecated-mid-flow, file validation/size/malware,
  uploading, timeout, double-submit, and safe-reload-mid-wizard states.
- State explicitly: no AppShell, no Organization nav/switcher, no Role-based logic anywhere on this
  screen.
- Add step-progress semantics (`ol`, current-step announcement) and focus management on step change.
- Clarify the post-submission correction channel (who initiates it, how the guest is contacted) next
  to the "não pode reverter" statement.
- Add one concrete motion decision for step transitions (or an explicit "no motion, because X").

Rendered-review checks to defer to the later gate:
- Whether the 520px card width and 3-badge step indicator read clearly at a glance once rendered,
  especially on a small mobile viewport per the plan's mobile-first requirement.
