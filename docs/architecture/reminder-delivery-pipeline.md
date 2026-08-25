# BLOCKER-B — End-to-End Reminder Delivery: Gap Analysis + Architecture Decision

> **Status: ARCHITECTURE APPROVED (Round H: 9.2/10, APPROVED WITH CHANGES, clearing
> AGENTS.md §4's Type 1 ≥9.0 gate). Round history: B 5.8/10 → D 7.3/10 → E 8.1/10 →
> F 7.8/10 → G 8.8/10 → H 9.2/10 — findings from every round and their fixes are in
> §11/§12/§13/§13.5/§13.6/§13.7.** This document is now a green light to implement against,
> not an open design debate — new Type 1 sub-decisions found during implementation still
> need their own protocol round, but the architecture itself (event taxonomy, pointer
> lifecycle, dispatch fence, policy-move fencing, backfill design) does not need
> re-litigating. One
> CRITICAL finding (dispatch-time freshness fencing) plus the real code defects later rounds
> found in it are already implemented and tested (commits `3eeda33`, `55b7b5e`, ahead of
> this doc revision — reconciliation is architecture-first per AGENTS.md §4, but
> self-contained, low-risk, already-necessary fixes to the existing approved M4 dispatch
> path were applied immediately rather than left as known gaps while the rest of the design
> was still being argued over). Everything else found across all rounds is corrected here,
> in the design, before the trigger worker itself is written. Materialization downstream
> (claim→dispatch→notification→SES) and infra are already real and are NOT redesigned here
> — see `blocker-b-recon-handoff.md` §3 for that evidence. This document covers the missing
> trigger between policy/item writes and `ReminderMaterializer`, plus the item-lifecycle
> coverage and pointer/backfill correctness the review rounds found missing. A "Final
> BLOCKER-B Status" section does not exist in this document yet — it belongs in
> `NEXT_SESSION_PROMPT.md`/`docs/architecture/README.md` once this design is APPROVED and
> implemented, per AGENTS.md §6's checklist, not duplicated here.

## 1. BLOCKER-B Definition

A persisted `ReminderPolicy` can automatically cause a real reminder occurrence to be
created, scheduled, processed and delivered through the existing production-capable path
(claim → outbox → dispatch → notification → SES), with idempotency, retry, failure
handling and observability — without any manual/invisible step.

## 2. Confirmed baseline (code, not docs)

- `ReminderMaterializer.materialize()` (`src/modules/reminder/application/reminder-materializer.ts:123`) is fully implemented, idempotent (`putIfAbsent` on a deterministically-derived `occurrenceId`), unit-tested, and correctly no-ops for a disabled policy.
- `ReminderMaterializer.cancelStaleOccurrences()` (same file, line 222) cancels `SCHEDULED`/`CLAIMED` occurrences whose `itemVersion` is behind the current one — but has **no equivalent for a stale *policy* version or a policy that became disabled while `itemVersion` stayed the same**. This is a real gap, not just a wiring gap (see §5).
- The only production call site of `materialize()` is `src/workers/reminder-reconciliation/reconciliation.ts:217`, inside the DST re-evaluation pass, itself fed by an externally-supplied candidate batch with "sourcing left as infra follow-up" (comment, lines 33-36) — i.e. even that path isn't wired to a real production trigger yet.
- `updateItem`/`renewItem` (`src/modules/expiration/application/expiration-service.ts:267-285`, `443-455`) emit `expiration.item-due-date-changed.v1` as an outbox event transactionally — correct shape, but **no consumer subscribes to it anywhere in `src/`.**
- `createItem` (`expiration-service.ts:88-200`) emits **no event at all** — a brand-new item with an already-attached policy would never materialize even if a consumer existed for due-date-changed.
- `ReminderPolicyService.createPolicy/updatePolicy/disablePolicy` (`src/modules/reminder/application/reminder-policy-service.ts`) do plain writes with **no outbox event** — by explicit design (file header, lines 6-9): "materialization is a separate, explicit step." That step has never been built.
- **New finding this session**: there is no index to answer "which `ReminderPolicy` rows apply to item X". Policies are their own aggregate (`TENANT#t#POLICY#p`/`META`), not nested under the item's partition, and no GSI covers item→policy lookup (`GSI1` dashboard, `GSI2` assignee/category, `GSI3` reminder scheduler — tenant-facing code has no access per isolation rule — `GSI4` org membership, `GSI5` provider callback, `GSI6` DST/outbox reconciliation are all taken and semantically unrelated). Any event-driven trigger reacting to an item event needs this lookup for `scope: "ITEM"` policies.
- `ReminderPolicyScope` also has a `"TEMPLATE"` value (`reminder-policy.ts:8`) with no resolution logic found anywhere in `src/` (no matching by category/tenant-default). This is a pre-existing, undocumented domain gap, **out of scope for this fix** — this document only wires `scope: "ITEM"` policies, which is the only scope the current HTTP surface and frontend actually exercise (per `blocker-b-recon-handoff.md`'s recon, not re-verified here). Flagging as finding, not silently ignoring: TEMPLATE-scope policies will continue to never materialize after this fix, same as today.

## 3. Materialization strategy

Already decided in `architecture-fase3-consolidada.md` (not reopened here): **eager/early
materialization** — occurrences are created ahead of their due time, not computed
just-in-time by the dispatcher. This document only decides *what triggers* a call to the
already-existing `materialize()`, not *how* it computes schedules.

## 4. Trigger design decision

**Chosen: async, event-driven via the existing transactional outbox — not synchronous
inside the item/policy write.**

Rejected: calling `materialize()` synchronously inside `createItem`/`updateItem`/
`renewItem`/policy-save transactions. This would couple the item/policy write's latency
and failure mode to reminder materialization, violating `docs/engineering/principles.md`
principle #4 (quoted in `blocker-b-recon-handoff.md` §3.2: "a materialização de ocorrências
não pode ficar bloqueada esperando o outbox confirmar publicação" — the inverse also
applies: the item write must not block on materialization). It would also require
`ExpirationService` to depend on `ReminderStore`/`ReminderMaterializer`, crossing a module
boundary `dependency-cruiser` currently keeps clean (expiration and reminder are separate
modules, only joined via events — see M3's original design).

**Chosen path**, reusing the exact `outbox → EventBridge → SQS → Lambda` pattern already
proven for `notification.intent-created.v1` (ADR-0004, ADR-0008). Three event types, each
a **pure invalidation signal** (see §7 for why events never carry authoritative state):

```text
expiration.item-due-date-changed.v1  (EXISTING type, extend two ways — see below)
  emitted by: createItem (NEW — today only update/renew emit it), updateItem
  (dueDateChanged), renewItem (new item's own creation)
  meaning: "this item is ACTIVE with a current due date — reconcile+materialize"

expiration.item-deactivated.v1  (NEW)
  emitted by: transitionStatus (archiveItem, deleteItem), and the OLD item's own
  status->RENEWED transition inside completeRenewal
  meaning: "this item no longer accepts reminders — cancel all live occurrences,
  unconditionally, no materialize"

reminder.policy-changed.v1  (NEW)
  emitted by: createPolicy, updatePolicy, disablePolicy (ReminderPolicyService)
  payload: { policyId, itemId?, previousItemId? }  — Codex Round F MEDIUM finding, now
  fixed: an earlier revision required `itemId` unconditionally, which is contradictory for
  an ITEM->TEMPLATE transition (§5's domain invariant: TEMPLATE scope forbids `itemId`).
  `itemId` is present iff the policy's CURRENT scope is ITEM (i.e. it's the policy's own
  `itemId` at emission time, omitted for TEMPLATE); `previousItemId` is present ONLY when
  updatePolicy moves an ITEM-scoped policy to a different item, or changes scope AWAY from
  ITEM (Codex Round D HIGH finding — see §5: without this, occurrences left under the OLD
  item are unreachable by any event path, since there is no global policy->occurrence index
  and the old pointer is gone by the time this event is processed). The worker's own
  decision logic (§4) never actually reads the event's `itemId` field for anything beyond
  routing — it always re-derives the current `itemId` from a fresh `GET` of the policy row
  itself — so this field's presence/absence only needed to stop being self-contradictory,
  not to carry a new decision.
  meaning: "this policy's state changed — reconcile the occurrences it owns, under BOTH
  the current item (if scope is still ITEM) and previousItemId if the latter is present"
```

All three -> EventBridge (default outbox path, no `destination` override) -> one new
EventBridge Rule (detail-type in all three) -> one new SQS queue
`reminder_materialization_queue` (+ DLQ, via existing `infra/modules/sqs-worker-queue`,
same as every other queue) -> one new Lambda handler + pure worker
`reminder-materialization-trigger`:

```text
on item-due-date-changed(itemId):
  item = strongly-consistent GET ExpirationItem
  if !item or item.status != ACTIVE: treat as item-deactivated (defensive — see §7)
  for policyId in pointer rows under the item's partition (§5):
    policy = strongly-consistent GET ReminderPolicy(policyId)
    if !policy or policy.tenantId != tenantId or policy.scope != "ITEM"
       or policy.itemId != itemId: skip (orphaned/stale pointer, never trusted — §5)
    reconcilePolicyOccurrences(tenantId, itemId, policy)   // cancel stale-version/disabled (§6)
    if policy.enabled: materializer.materialize(item, policy)
  materializer.cancelStaleOccurrences(itemVersion)  // existing itemVersion safety net

on item-deactivated(itemId):
  cancelAllOccurrences(tenantId, itemId)   // new materializer method, unconditional,
                                            // same one-conditional-update-per-row pattern

on policy-changed(policyId, itemId?, previousItemId?):
  // Codex Round G simplification: after 4 rounds of patching the previousItemId branching
  // logic separately from the current-item logic (E: read-gate it; F: atomically fence it;
  // G: fix a !policy edge case the branching missed), Codex correctly named the real
  // problem - two bespoke code paths for "old side" vs "current side" was exactly the
  // shape that kept growing new edge cases. Replaced with ONE unified operation applied to
  // every candidate partition, current or previous, with the same fence every time.
  policy = strongly-consistent GET ReminderPolicy(policyId)
  if !policy:
    return   // hard-delete unsupported today (§5) - nothing to reconcile against, and no
             // version exists to fence a cancellation with; not a production path yet
  targets = dedupe(nonNull([previousItemId, policy.scope == "ITEM" ? policy.itemId : null]))
  for target in targets:
    isCurrentTarget = (policy.scope == "ITEM" and target == policy.itemId)
    if isCurrentTarget:
      item = strongly-consistent GET ExpirationItem(target)
      if !item or item.status != ACTIVE: continue   // item-deactivated event, if any, handles cleanup
      reconcilePolicyOccurrences(tenantId, target, policy)   // cancel only stale-version/disabled (§6),
                                                              // fenced by policy.version (buildVersionConditionCheck)
      if policy.enabled: materializer.materialize(item, policy)
    else:
      reconcilePolicyOccurrencesUnconditionally(tenantId, target, policy)   // cancel ALL live occurrences,
                                                                             // fenced by policy.version - never
                                                                             // materialize a non-current target
```

This keeps the write path exactly as fast/simple as today, reuses infra that's already
tested and alarmed (M3.5/M4), and needs no new AWS resource class — only one more queue
instance of an existing module. Consistent with the mission prompt's §14 "operational
simplicity" principle and the
project's existing at-least-once assumption (materialize() is already idempotent, so
duplicate delivery of any of these three events is always safe by construction — see §7).

## 5. Item→policy lookup fix

**Chosen: denormalized pointer row under the item's own partition, not a new GSI.**

When an `ITEM`-scoped policy is created or updated, write (in the same `TransactWriteItems`
as the policy write) a pointer row:

```text
PK = TENANT#<t>#ITEM#<itemId>
SK = POLICYREF#<policyId>
{ policyId }
```

The trigger worker queries the item's own partition with `begins_with(SK, "POLICYREF#")`
— the exact same query shape `ReminderStore.queryByItem` already uses for `OCC#` rows
(`dynamodb-reminder-store.ts:61-82`), so this needs one more narrow method on the port, not
a new GSI, no new Terraform, no new capacity planning. Rejected a new GSI: overkill for a
lookup that's inherently ≤ a handful of policies per item, and GSI slots are a scarcer,
harder-to-add resource than one more item-partition row.

Cost/complexity: one extra `Put`/`Update`/`Delete` in the existing policy-write
transaction; one extra strongly-consistent `Query` (already paid, same partition as the
item read) in the trigger worker. No new alarms, no new capacity model entry needed.

**Pointer invariants (Round B HIGH finding — this was unspecified, now fixed):**

- The pointer is **discovery-only, never authoritative**. The worker always dereferences
  the real `ReminderPolicy` row by `policyId` and validates
  `policy.tenantId === tenantId && policy.scope === "ITEM" && policy.itemId === itemId`
  before using it in any way — a pointer that fails this check is silently skipped (logged,
  not thrown: worst case is a transient miss, corrected on the next successful event for
  that item/policy, never a false materialization). This closes both "authoritative
  dereference" and the duplicated-`enabled`-field risk at once: **the pointer row does not
  store `enabled` at all** — it is purely `{ policyId }`, nothing to go stale.
- `createPolicy` (scope `ITEM`): pointer write is part of the same `TransactWriteItems` as
  the policy `Put`.
- `updatePolicy`: reads the OLD policy row first (already does, `reminder-policy-service.ts:83`)
  before building the transaction. If old `scope === "ITEM"` and (new `scope !== "ITEM"` OR
  new `itemId !== old itemId`), the old pointer is `Delete`d in the same transaction, and
  the `reminder.policy-changed.v1` event's payload carries `previousItemId = old itemId`
  (§4) — **Codex Round D HIGH finding, now fixed**: an earlier revision of this document
  incorrectly claimed the trigger worker could reach the OLD item's occurrences purely by
  `policyId` match without any event carrying the old item's identity; there is no global
  policy→occurrence index (that's the entire reason the pointer exists), so the OLD item's
  partition is only reachable if something tells the worker which partition to look under.
  `previousItemId` is that something — the worker reconciles occurrences under
  `previousItemId` when present, in addition to its normal reconcile of the current
  `itemId` (§4's pseudocode), but **never as a plain unconditional cancel** (Codex Round E
  HIGH finding, then Round F HIGH finding on the SAME area — see §4 and §7 for the full
  history): a read-then-cancel version (Round E's fix) still had a TOCTOU gap — the policy
  can move again in the window between the worker's read and its cancel actually
  committing. The real fix (Round F) is an atomic fence: each occurrence cancellation under
  `previousItemId` commits in the same `TransactWriteItems` as a `ConditionCheck` on the
  policy row (via `buildVersionConditionCheck`, the identical mechanism the dispatch fence
  uses, §6/commit `3eeda33`) asserting the policy is still at the version just read. If the
  policy moved again, the whole transaction aborts and that occurrence is left untouched —
  a safe no-op (the move that invalidated this cancel always fires its own event, which
  reconciles with fresh state), never a wrongly-cancelled currently-valid occurrence that
  `materialize()` could never recreate (its deterministic key would already exist).
  **Codex Round G finding (MEDIUM, closing out this area) + simplification**: the
  read-first-then-branch pseudocode had a `!policy` edge case (hard-delete, unsupported
  today, but the branch modeled it) that dereferenced `policy.version` on a value that
  didn't exist. Rather than patch that one case, §4's pseudocode was restructured per
  Codex's own suggestion into a single unified operation applied identically to every
  candidate partition (`previousItemId` and the current `itemId`, deduplicated) — cancel
  everything if the partition isn't the policy's current target, cancel only stale/disabled
  occurrences (and materialize) if it is, fenced by `policy.version` either way, with a
  single early `return` if the policy is altogether missing. Four rounds of incrementally
  patching two separate "old side"/"current side" code paths kept producing new edge cases
  in the seam between them; one rule applied uniformly has no seam left to have a bug in.
- `disablePolicy`: pointer is left in place (still discoverable — a disabled policy must
  still be reachable so its occurrences get cancelled, not orphaned).
- No hard-delete of a policy exists anywhere in the current API (`reminder-policy-service.ts`
  has no `deletePolicy`, only create/update/disable) — pointer lifecycle for a deletion path
  is explicitly out of scope until that API exists, not silently assumed.
- Domain validation added: `PutPolicyInput` gains the invariant "`scope: "ITEM"` requires
  `itemId`; `scope: "TEMPLATE"` forbids it" — enforced in `ReminderPolicyService`, matching
  Round B's finding that neither the domain type nor the JSON schema enforced this today.
- **ITEM policy integrity (Round B MEDIUM finding)**: `createPolicy`/`updatePolicy` for
  `scope: "ITEM"` now condition-check that the target `itemId` exists, is `ACTIVE`, and
  belongs to the same tenant, inside the same transaction as the policy write. **Round H
  implementation note**: `buildVersionConditionCheck` as it exists today (§6/`occ.ts`)
  requires an `expectedVersion` — this check has no version to assert (a policy referencing
  an item doesn't pin that item to a specific version, only to existing/active/same-tenant),
  so this needs either a small sibling helper (`buildExistenceConditionCheck`, no
  `expectedVersion`, same `ConditionCheck` shape otherwise) or an optional-version extension
  to the existing one — a small, low-risk addition, not a design decision, called out here
  so implementation doesn't have to rediscover it.

## 6. Policy-version / disable staleness — reframed after the dispatch fence

`cancelStaleOccurrences` only compares `itemVersion`. `ReminderMaterializer` gains three
sibling methods (Codex Round H LOW finding: this trio was under-specified as a set —
`reconcilePolicyOccurrences` and `cancelAllOccurrences` were each individually described,
but `reconcilePolicyOccurrencesUnconditionally` — used by §4's unified policy-changed loop
for a non-current target — was never formally introduced here; consolidated below):

- `reconcilePolicyOccurrences(tenantId, itemId, policy)` — for the given policy's CURRENT
  target item: cancels `SCHEDULED`/`CLAIMED` occurrences where `occurrence.policyId ===
  policy.policyId AND (occurrence.policyVersion !== policy.version OR !policy.enabled)`.
  Used when the item partition IS the policy's current target (§4).
- `reconcilePolicyOccurrencesUnconditionally(tenantId, itemId, policy)` — for an item
  partition that is NOT (or no longer) the policy's current target: cancels **every** live
  `SCHEDULED`/`CLAIMED` occurrence for that `policyId` in that partition, regardless of
  version (there's no "current version" to compare against — the policy doesn't target this
  item at all anymore). Used for the `previousItemId` side of §4's unified loop.
- `cancelAllOccurrences(tenantId, itemId)` — cancels every live occurrence for **any**
  policy under the item, used only by the `item-deactivated` path (§4) where the whole item
  is terminal, not just one policy's relationship to it.

All three share the same one-conditional-update-per-occurrence pattern already used (never
a single unbounded transaction), and both policy-scoped variants fence each individual
cancellation with a `buildVersionConditionCheck(policy.version)` `ConditionCheck` in the
same transaction (§5/§7's F1/G1 fix) — the difference between them is only which
occurrences qualify for cancellation, not how the cancellation itself is committed.

**Round B HIGH finding ("reconciliation can create stale occurrences after the current
pass")**: correct that concurrent trigger-worker invocations racing a policy update can
transiently leave a stale-version `SCHEDULED` row alive after a cancel pass already ran —
`materialize()`'s `putIfAbsent` has no fencing against the authoritative policy/item version
at creation time, and Round B is right that periodic reconciliation "should not be the only
safety mechanism." **The dispatch-time freshness fence (commit `3eeda33`, §11 finding
#2) is what actually closes this for real**, not prevention at materialize time: even if a
stale-version row is transiently `SCHEDULED`, it can never reach `TRIGGERED` — the producer
claims it, dispatch re-reads the authoritative item/policy and atomically condition-checks
both inside the same transaction as the `CLAIMED->TRIGGERED` commit, so a stale claim is
rejected (`CANCELLED_STALE`/`ABORTED_FRESHNESS_RACE`) instead of ever producing a
`NotificationIntent`. This reframes the invariant correctly: **materialization races may
transiently leave extra `SCHEDULED` rows — dispatch is the only point that must be, and now
is, unconditionally fenced against delivering a stale reminder** (RB-G3/RB-G7 are satisfied
at the delivery boundary, which is the boundary that actually matters). **Correction (Codex
Round D)**: an earlier revision of this section claimed such rows are "cleaned up by the
next successful reconcile pass," implying a guaranteed follow-up event — that is not always
true (there is no guaranteed next trigger for a given item/policy pair, especially after a
policy move, per §5/§7's fix). The accurate statement is narrower: such rows remain merely
`SCHEDULED`-looking data hygiene, not a delivery risk, until *either* a future event
reconciles them *or* scheduled dispatch itself discovers and rejects them via the fence —
whichever comes first, with the fence as the backstop of last resort, not "eventually
cleaned up" as a standing guarantee.

## 7. Event ordering, duplication and concurrency (Round B MEDIUM finding)

**Design principle: every event in §4 is a pure invalidation signal, never a carrier of
authoritative state.** The worker never makes a decision from the event payload beyond
`tenantId`/`itemId`/`policyId` (routing) — every decision (item ACTIVE? policy enabled? what
version?) comes from a strongly-consistent re-read at processing time. This makes the whole
trigger layer safe by construction under EventBridge/SQS's at-least-once, no-ordering
delivery:

- **Out-of-order** (v2 processed before v1): both processing runs re-read current state and
  reconcile against it — whichever runs last just re-confirms the same already-current
  result. No decision ever depends on which physical event arrived first.
- **Duplicate delivery**: identical re-read, identical reconcile, `putIfAbsent` no-ops on
  the deterministic occurrence key — a pure no-op, not merely harmless but literally
  idempotent.
- **Concurrent processing of different events for the same item** (e.g. item-update racing
  policy-update): both re-read the same authoritative rows; whichever transaction commits
  last simply reconciles against the version the other one already committed — this is the
  same race already analyzed in §6, closed at the dispatch boundary, not required to be
  impossible at materialize time.
- **Policy moving old item → new item, including A→B→A out-of-order AND true concurrency**
  (§5's pointer-move case — real bugs found across two consecutive rounds, both now fixed):
  the event carries `previousItemId` (§4/§5) as a routing hint, but two successive design
  gaps let it gate the cancel decision without a real atomic guarantee. Round E found the
  first: an unconditional cancel broke this section's own out-of-order claim (policy moves
  A→B, then back B→A; if B→A is processed first — restoring A as current — a later delivery
  of the delayed A→B event would still unconditionally cancel A's now-current occurrence,
  which `materialize()` can never recreate since `putIfAbsent` on the unchanged deterministic
  key is a no-op — `reminder-materializer.ts:151,203`). The read-before-cancel fix that
  followed still had a second gap Round F found: a plain re-read only narrows the race
  window, it doesn't close it — the policy can move again in the gap between that read and
  the cancel actually committing, reproducing the identical failure mode under true
  concurrency rather than mere reordering. **Final fix**: the cancel is not just
  read-gated but atomically fenced — each occurrence cancellation under `previousItemId`
  commits in the same `TransactWriteItems` as a `ConditionCheck` on the policy row (§4/§5,
  `buildVersionConditionCheck`, the same mechanism as the dispatch fence, §6) asserting the
  policy is still at the version just read. A concurrent move aborts that specific
  transaction — the occurrence is left untouched, a safe no-op, not a wrongly-cancelled
  currently-valid occurrence — restoring genuine convergence regardless of arrival order OR
  timing. This needs explicit tests when the worker is implemented: the original A→B→A
  out-of-order case, AND a true-concurrency case where the fencing ConditionCheck itself is
  exercised (a policy move committing inside the read-to-cancel window).
- **Disable immediately followed by enable**: two `policy-changed` events, processed in
  whatever order — final state always converges to a fresh re-read of the policy's true
  `enabled`/`version` at the time each event happens to run, and the last one to actually
  execute (not necessarily the last one *sent*) determines the materialized set, which is
  exactly correct: an occurrence set that doesn't match the CURRENT policy state is, by
  definition, stale and eligible for the next reconcile pass to fix — never silently wrong
  at the point where it would cause a delivery, per §6.
- **`item-deactivated` is the one event that does NOT re-read before acting** (Codex Round D
  LOW finding): it cancels unconditionally by design (§4), which is safe only because
  archive/delete/renewal-old-side are all terminal transitions in the current domain — there
  is no "reactivate an archived item" operation today. If one is ever introduced, a delayed/
  duplicate `item-deactivated` event arriving after a reactivation would no longer be a
  harmless invalidation signal (it could cancel occurrences for an item that is ACTIVE again)
  — this dependency is recorded here explicitly so it is not silently violated by a future
  change; whoever adds a reactivation flow must revisit this event's handling.

## 8. Renewal semantics — item-deactivated fix + explicit product decision

`completeRenewal` transitions the OLD item to `RENEWED` in the same transaction that
creates the new item (`expiration-service.ts:437`) — this now also emits
`expiration.item-deactivated.v1` for the OLD item's id, alongside the existing
`expiration.item-due-date-changed.v1` for the NEW item (unchanged). This closes Round B's
CRITICAL finding #1 for the renewal case: the old item's live occurrences are cancelled via
the same `cancelAllOccurrences` path as archive/delete, not left deliverable.

**Engineering default, explicitly NOT a completed product decision (Codex Round D
correctly pushed back on §8 previously calling this "decided" — it isn't, and can't be at
this authority level):** policies are `itemId`-scoped, not lineage-scoped — a policy
attached to the old item does **not** automatically apply to the renewed item's new
`itemId`. The implementation-ready technical default this document specifies is **no
automatic copy** — renewed items start with zero reminder policies — but this is a
proposed, fail-safe default pending Marcelo's confirmation, not a resolved product
requirement. Rationale for proposing it: a silent copy risks silently reproducing a
stale/wrong cadence onto a new lineage the user may want to configure differently (e.g. a
renewed contract with a different notice period); "no reminder" is a safer default to ship
than "possibly-wrong reminder," matching this project's epistemic-integrity stance
elsewhere (never assert more certainty/completeness than is true) — but it is still a
product tradeoff, not an engineering fact, and Marcelo owns it. **This is a known,
user-facing product gap** — renewing an item silently drops its reminders under this
default — that must be surfaced to Marcelo and recorded in `NEXT_SESSION_PROMPT.md`'s
BLOCKER-B status before BLOCKER-B is declared resolved (see this document's header note on
where that final status lives), not buried in an engineering doc. It does not block this
architecture from proceeding (both outcomes —
"copy" or "don't copy" — need this same event-driven trigger underneath either way), but
BLOCKER-B's `Definition of Done` cannot honestly claim renewal is fully handled until
Marcelo picks one.

**Decision (Marcelo, 2026-08-25):** copy the source item's `ReminderPolicy` automatically
onto the renewed item, plus surface a user-facing notice on the renewal response/UI that
the copied policy may need adjustment (e.g. new notice period). This overrides the
fail-safe "no copy" default proposed above. Not yet implemented — `completeRenewal`
(`expiration-service.ts:419`) still creates renewed items with zero policies; this needs
its own scoped implementation pass (cross-module `expiration`→`reminder` read inside the
existing transaction, plus a wire-level notice field) rather than being folded into
BLOCKER-A work. Tracked in `NEXT_SESSION_PROMPT.md`.

## 9. Backfill safety — corrected (Round B HIGH finding: the original claim was false)

**The original claim in this document ("policies remain inert until their item's due date
changes or the policy is re-saved") was wrong and is corrected here.** A due-date change on
an item with a pre-existing (pre-deploy) `ITEM`-scoped policy does **not** trigger anything,
because that policy has no `POLICYREF` pointer row (pointers only start being written the
moment this change deploys) — even though a real `item-due-date-changed` event fires, the
trigger worker's pointer lookup under that item's partition finds nothing to reconcile.
Only re-saving the policy itself
(which always writes/repairs its own pointer) makes it discoverable.

Deploy is still safe by construction (RB-G10): no event fires automatically for pre-existing
policies, so there is no mass-materialization risk on deploy — but the corrected fact is
those policies stay **fully inert**, not "inert until an item edit," until one of: (a) the
policy is re-saved, or (b) a backfill runs. A one-off, manually-triggered (never automatic)
backfill is required to activate the existing installed base, with an explicit design (not
just "reuse materialize()," which was the original doc's incomplete claim):

1. Paginated, rate-limited scan of the table filtered to `entityType = "ReminderPolicy"`
   (no enumeration index exists — see §5 — so this is the one place a scan is accepted,
   justified by being a single manual maintenance operation, never a hot path per §60/§61
   of the mission).
2. For each `scope: "ITEM"` policy found: strongly-consistent read its item; skip if
   missing/not `ACTIVE` (repairs nothing for an item that no longer wants reminders).
3. `Put`-if-absent the `POLICYREF` pointer (repairs discoverability going forward).
4. Call `materialize()` (idempotent, safe to run twice, safe to re-run the whole backfill).
5. **Checkpoint token (Codex Round D MEDIUM finding)**: an earlier revision of this step
   said "checkpoint by `policyId`" — a `Scan` is not ordered by `policyId`, so that cannot
   safely resume a paginated scan (it can skip or repeat unbounded amounts of work). The
   script instead uses DynamoDB's own opaque `LastEvaluatedKey` (one per parallel-scan
   segment, if run with multiple `Segment`/`TotalSegments` workers) — the only continuation
   token a `Scan` actually supports.
6. **Handoff contract (Codex Round E MEDIUM finding — the token type was right, but its
   persistence/ownership was unspecified)**: the checkpoint is advanced only after an ENTIRE
   page (all policies in one `Scan` response, steps 2-4 above) completes successfully, never
   mid-page — so a page that fails partway through is always safely replayable in full
   (steps 2-4 are each idempotent: skip-if-inactive, `Put`-if-absent, `materialize()`'s own
   `putIfAbsent`) without needing partial-page bookkeeping. The script itself owns
   persistence: it prints the token to its own stdout/log at the end of each successful page
   and accepts a token as an optional input argument to resume from — a manual maintenance
   operator's responsibility to carry forward between invocations (matching this operation's
   "one-off, manually-triggered" nature per §9's opening framing), not a durably-stored
   value the system itself tracks between runs.

## 10. Dependency-cruiser claim — corrected (Round B MEDIUM finding)

The earlier draft claimed `dependency-cruiser` "keeps expiration and reminder modules
separate," citing this as a reason to prefer the event-driven trigger. That claim was
checked against `.dependency-cruiser.cjs` and is **false**: the actual rules forbid
domain→infrastructure, domain→application/ports/http/persistence, and shared→modules — none
of them forbid `expiration`'s application layer from importing `reminder`'s. **The
event-driven choice remains correct on its own merits** (§4: it isolates the item/policy
write's latency and failure mode from reminder materialization, avoids a synchronous
cross-module call inside a hot write path, and reuses already-proven durable-retry infra) —
just not for the dependency-cruiser reason. The desired module separation is a design
intent this trigger's own worker (a new, separate composition root importing both
`ExpirationStore`/`ReminderStore`, the same shape M3/M3.5/M4's existing workers already use
to cross module boundaries) upholds by construction, not one `dependency-cruiser` enforces
today. If it should be enforced going forward, that is a separate, explicitly-reviewed
boundary-rule change, not implied by this document.

## 11. Codex Round B findings and disposition

| # | Finding | Severity | Fix | Status |
|---|---|---|---|---|
| 1 | Item lifecycle (archive/delete/renewal-old-side) never triggers cancellation | CRITICAL | New `expiration.item-deactivated.v1` event + `cancelAllOccurrences` (§4, §8) | Design fixed, pending implementation |
| 2 | No atomic fencing at dispatch against concurrent policy/item change | CRITICAL | `buildVersionConditionCheck` + dispatch transaction fence | **Fixed in code, commits `3eeda33`+`55b7b5e`, with dedicated freshness-race tests (`test/unit/reminder/dispatch.test.ts`) — see §13 for why the original "45 tests green" claim here overstated verification** |
| 3 | Reconciliation can create stale occurrences after a "current" pass | HIGH | Reframed: dispatch fence (fix #2) is the real guarantee; materialize-time races are now correctly scoped as data hygiene, not a delivery risk (§6) | Design fixed |
| 4 | Pointer lifecycle underspecified (moves, scope change, orphans, authoritative dereference) | HIGH | Full invariants specified, pointer is discovery-only and never authoritative (§5) | Design fixed, pending implementation |
| 5 | Backfill claim was factually wrong | HIGH | Corrected claim + full 5-step backfill design (§9) | Design fixed |
| 6 | `dependency-cruiser` justification overstated | MEDIUM | Claim corrected, event-driven choice re-justified on its real merits (§10) | Design fixed |
| 7 | Event ordering/payload semantics incomplete | MEDIUM | Explicit "invalidation signal only" principle + case-by-case analysis (§7) | Design fixed |
| 8 | ITEM policy integrity not enforced (policy can reference nonexistent/foreign item) | MEDIUM | Condition-checked at policy write time (§5) | Design fixed, pending implementation |
| 9 | Pointer's duplicated `enabled` field invites divergence | LOW | Pointer now stores only `{ policyId }`, no `enabled` field (§5) | Design fixed |
| 10 | Deterministic identity uses only a 32-bit hash | LOW | Acknowledged pre-existing, out of scope for this fix per Codex's own note ("not necessarily before implementing the architecture skeleton") | Accepted, tracked as backlog |

## 12. Codex Round D findings and disposition (score 7.3/10, NOT APPROVED — re-review of the Round C revision above plus commit `3eeda33`)

| # | Finding | Severity | Fix | Status |
|---|---|---|---|---|
| D1 | Policy-move (§5) claimed occurrences under the OLD item are reachable by `policyId` match alone — impossible, no global policy→occurrence index exists | HIGH | `reminder.policy-changed.v1` now carries `previousItemId`; worker explicitly reconciles both partitions (§4, §5, §7) | Design fixed |
| D2 | `dispatch.ts` catch block classified ANY transaction cancellation without entry-1 failing as `ABORTED_FRESHNESS_RACE`, including unrelated failures (idempotency/outbox condition, throttling) the handler would then wrongly ack instead of retry | HIGH — real code defect | Catch now checks entries 2/3 specifically for the freshness race and entry 1 for duplicate-delivery; anything else rethrows | **Fixed in code, commit `55b7b5e`** |
| D3 | In-memory test double: adequate for the fence's happy/failure path, but no test existed that actually raced a mutation into the read→commit window; §11's "45 tests green" overstated fence-specific verification | MEDIUM | Added `test/unit/reminder/dispatch.test.ts` — races a policy-disable and an item-archive into the real window via a store wrapper (not the happy path only), plus a false-positive guard | **Fixed in code, commit `55b7b5e`** |
| D4 | Backfill "checkpoint by `policyId`" is not implementable — `Scan` has no `policyId` ordering, only an opaque `LastEvaluatedKey` | MEDIUM | Checkpoint design corrected to persist `LastEvaluatedKey` per scan segment (§9) | Design fixed |
| D5 | §8 called "no automatic copy" a completed product decision — it isn't, at this authority level | MEDIUM | Reworded to "engineering default pending Marcelo's confirmation," not a resolved decision (§8) | Design fixed |
| D6 | "Pure invalidation signal" stated too absolutely — `item-deactivated` cancels unconditionally without re-reading, safe only because current transitions are terminal | LOW | Dependency recorded explicitly in §7 (must be revisited if a reactivation flow is ever added) | Design fixed |

## 13. Codex Round E findings and disposition (score 8.1/10, NOT APPROVED — re-review after the D1-D6 fixes above)

| # | Finding | Severity | Fix | Status |
|---|---|---|---|---|
| E1 | `previousItemId` cancellation was unconditional, breaking §7's own out-of-order convergence claim: a delayed policy-move-away event processed after a later move-back could cancel a currently-valid occurrence that `materialize()` can never recreate (`putIfAbsent` no-ops on the unchanged deterministic key) | HIGH — real design bug, not just underspecified | Worker now re-reads the CURRENT policy first and only cancels under `previousItemId` if that fresh read confirms `policy.itemId !== previousItemId` (§4, §5, §7) | Design fixed, pending implementation + a dedicated A→B→A out-of-order test |
| E2 | The OLDER stale-occurrence catch in `dispatch.ts` (the `CANCELLED_STALE` path, separate from the D2-fixed success path) repeated the exact same defect — swallowed any `TransactionCanceledException` as "already handled" instead of checking whether the occurrence's own condition specifically failed | MEDIUM — real code defect | Catch now inspects `CancellationReasons[0]` and only swallows a genuine `ConditionalCheckFailed`; anything else rethrows | **Fixed in code, commit (this revision)** |
| E3 | Backfill checkpoint used the right token type (`LastEvaluatedKey`) but didn't specify where it lives, when it advances, or how partial-page failure is handled | MEDIUM | Explicit handoff contract added: advances only after a full page succeeds (each step already idempotent, so full-page replay is always safe), script prints/accepts the token itself — a manual operator's responsibility to carry forward, not a durably-stored system value (§9) | Design fixed |
| E4 | Document header still said "Round C" and referenced a non-existent "§14"/"Final BLOCKER-B Status" section within this document | LOW | Header updated to reflect Round E; broken references corrected to point at `NEXT_SESSION_PROMPT.md` (where final status actually belongs) and the mission prompt's own §14 (not a self-reference) | Fixed |

## 13.5. Codex Round F findings and disposition (score 7.8/10, NOT APPROVED — re-review after the E1-E4 fixes above)

| # | Finding | Severity | Fix | Status |
|---|---|---|---|---|
| F1 | E1's fix (read-then-cancel) still had a TOCTOU gap: the policy can move again between the worker's read and its cancel actually committing, reproducing the same failure mode under true concurrency rather than mere out-of-order delivery | HIGH — real design bug, second round on the same area | Cancellation under `previousItemId` is now atomically fenced via a `ConditionCheck` on the policy row (`buildVersionConditionCheck`, same mechanism as the dispatch fence) inside the same transaction as each cancel, not just read-gated (§4, §5, §7) | Design fixed, pending implementation + true-concurrency test |
| F2 | The E2 fix for the `CANCELLED_STALE` catch still swallowed `TransactionCanceledException` when `CancellationReasons` was entirely absent (`reasons && !occurrenceConditionFailed` is falsy when `reasons` is `undefined`) — inconsistent with the success-path catch, which correctly rethrows this case | MEDIUM — real code defect, repeat of D2/E2's pattern a third time | Condition simplified to `!occurrenceConditionFailed` (true when `reasons` is absent), matching the success path exactly | **Fixed in code, commit (this revision)** |
| F3 | `reminder.policy-changed.v1`'s payload required `itemId` unconditionally, self-contradictory for an ITEM→TEMPLATE transition where the domain forbids `itemId` on a TEMPLATE-scope policy | MEDIUM | `itemId` is now optional in the payload (present iff current scope is ITEM); worker logic already never used the event's `itemId` for a decision (always re-reads the policy), so this was a payload-contract fix only (§4) | Design fixed |
| F4 | Document header still said "Round E candidate" with Round E already complete | LOW | Header updated to "Round F candidate" with the full round-score history | Fixed |

## 13.6. Codex Round G findings and disposition (score 8.8/10, NOT APPROVED — re-review after the F1-F4 fixes above)

| # | Finding | Severity | Fix | Status |
|---|---|---|---|---|
| G1 | The `!policy` branch of the previous "read-then-branch" pseudocode dereferenced `policy.version` on a value that couldn't exist in that branch, and no version-based fence can gate a cancellation against a row that doesn't exist | MEDIUM | Restructured §4's `on policy-changed` into one unified operation over every candidate partition (`previousItemId` + current `itemId`, deduplicated), with a single early return if the policy is missing — closes the edge case AND removes the "old side vs current side" branching seam Codex identified as the real source of 3 consecutive rounds of edge cases in this area | Design fixed |

Codex's own assessment after this round: "F1–F4 are genuinely fixed" and the remaining item was this one MEDIUM pseudocode contradiction — explicitly not a design-soundness objection to the fence itself. The fresh-design-pass suggestion (a single unified reconcile operation instead of bespoke old/current branches) is adopted directly above, per Codex's own recommendation, rather than left as a "nice to have."

## 13.7. Codex Round H findings and disposition (score 9.2/10, APPROVED WITH CHANGES — clears the Type 1 ≥9.0 gate)

| # | Finding | Severity | Fix | Status |
|---|---|---|---|---|
| H1 | `reconcilePolicyOccurrencesUnconditionally` was used in §4's unified loop but never formally introduced/specified in §6 alongside its siblings `reconcilePolicyOccurrences`/`cancelAllOccurrences`; `buildVersionConditionCheck`'s "existence-only form" referenced in §5 doesn't exist as written (the real helper requires `expectedVersion`) | LOW — documentation/API-contract consolidation, explicitly not a correctness gap | All three materializer methods formally specified together in §6; §5's ITEM-policy-integrity check corrected to note it needs a small sibling helper or optional-version extension, not the nonexistent "existence-only form" | Fixed |

Round H's own verdict: **"No CRITICAL, HIGH, or MEDIUM issues... No further adversarial design round is warranted for H1."** — first round to explicitly clear the AGENTS.md §4 Type 1 gate (≥9.0, blind score). **This architecture decision is APPROVED.** Implementation (the trigger worker, pointer lifecycle, lifecycle events, backfill script, Terraform, and the concurrency/tenant-isolation/renewal/backfill/out-of-order/true-concurrency test coverage every round from B through H asked for) may now proceed against this design without further Claude↔Codex debate on the architecture itself — new Type 1 sub-decisions surfaced during implementation still require the protocol per AGENTS.md §4.

## 14. Claude self-review (Round A/C/E/F/G/H)

- E1 is the most important finding across all three Codex rounds so far: it's the only one
  that was a genuine logic bug in the CORRECTED design (D1's fix), not just an
  underspecified or overstated claim — proof that closing one finding can introduce a new
  one, and that "re-read authoritative state" only works if EVERY use of a payload hint
  (not just the ones already flagged) is actually gated by that re-read, not just the
  primary decision path.
- E2/F2 is the same lesson as D2 landing a THIRD time: whenever a catch block classifies
  `TransactionCanceledException`, every branch of that classification — including the
  "reasons are absent" branch, which is easy to overlook because it feels like an edge case
  rather than the main path — needs to default to rethrow, never to swallow, unless
  specifically proven safe. Both fenced transactions in `dispatch.ts` now follow the same
  verify-don't-assume pattern, written the same way, so a future reader can compare them
  directly instead of re-deriving the reasoning each time.
- F1 generalizes E1's lesson one level further: "gate the decision on a fresh read" is
  still not enough when the action taken as a result of that read is not itself atomic with
  the read — only wrapping the actual mutation in a `ConditionCheck` against the same fact
  the read observed closes a TOCTOU gap for real. This is exactly the same principle the
  original dispatch fence (finding #2) already established for a different data path; F1's
  root cause was applying "read-then-act" to a NEW code path (policy-move reconciliation)
  without carrying over the atomicity requirement that made the dispatch fence actually work.
- The renewal policy-copy default (§8) is explicitly NOT framed as a completed product
  decision after Round D's correction — it's an implementation-ready engineering default
  ("no copy") pending Marcelo's confirmation, which is the accurate framing for something
  this document's authority level can propose but not decide.
- The dispatch fence (finding #2) was implemented immediately rather than left pending
  alongside the rest of the design reconciliation, and Round D correctly caught that doing
  so without dedicated tests was itself an overclaim ("45 tests green" implied
  fence-specific coverage that didn't exist yet) — the missing test is now written
  (`dispatch.test.ts`, commit `55b7b5e`) and a real code defect the untested path was
  hiding (D2) is fixed. Lesson applied: a fix implemented ahead of full design reconciliation
  still needs its own dedicated adversarial test before being cited as verification, not
  just "the existing suite didn't break."
- Rejected trying to make materialize-time races structurally impossible (e.g. a
  transactional generation-marker scheme) — the dispatch fence already makes the
  *observable* invariant (no stale delivery) hold unconditionally, so added complexity at
  materialize time would buy correctness the system already has, at real implementation
  cost. Revisit only if data-hygiene noise (stray cancelled-later rows) becomes an
  operational nuisance in practice.
- Everything downstream of `ReminderOccurrence` creation past the dispatch fence remains
  untouched — no further redesign risk introduced into the already-approved M3.5/M4
  pipeline.

**Architecture APPROVED as of Round H (9.2/10).**

## 15. Implementation status — COMPLETE, IMPLEMENTATION APPROVED (Codex, 9.2/10)

§4-§9 are now real code, not design: `ReminderMaterializer`'s three reconciliation methods,
the `POLICYREF#` pointer lifecycle in `ReminderPolicyService`, the two new lifecycle events
wired into `ExpirationService`, the `reminder-materialization-trigger` worker implementing
the unified Round-H loop, the real delivery mechanism (a correction found during
implementation — see below), Terraform (queue+DLQ+Lambda+IAM), and the backfill script.

**Real correction made during implementation, not caught by the architecture rounds**: the
"generic EventBridge path" this document originally assumed for delivery (matching
`notification.intent-created.v1`'s stated pattern) does not actually exist anywhere in this
codebase — no `PutEventsCommand` call exists, and `router_queue` (EventBridge Rule → SQS)
has no Lambda consumer at all. The only real, proven, end-to-end mechanism in production is
the destination-routed `DispatchOutboxRelay`/`OutboxSweeper` pattern every other queue
already uses. BLOCKER-B's three events are wired through that instead — same architectural
family (durable outbox → queue → Lambda, at-least-once, idempotent), different AWS
transport hop. This did not require redoing the Claude↔Codex architecture rounds (the
event taxonomy, pointer lifecycle, and fencing decisions are unaffected), but is recorded
here so this document stays accurate about what actually ships.

**Implementation-level Claude↔Codex review** (separate from the architecture rounds above,
per the mission's §106-110 protocol — design approval gates starting implementation, not a
substitute for reviewing it): Round 1 scored the real diff 8.4/10, NOT APPROVED, finding
three real MEDIUM defects — the two new materializer reconciliation methods repeated the
exact exception-misclassification bug class already fixed twice in `dispatch.ts`
(swallowing any `TransactionCanceledException` instead of checking `CancellationReasons`);
a same-item policy update suppressed the ITEM-existence/ACTIVE/tenant `ConditionCheck`
entirely instead of only suppressing the pointer write; and the new queue's message schema
was never registered in the *production* `defaultSchemaRegistry` singleton at all (every
real message would have thrown `Unknown schema $id`), on top of not validating `data`
per-`eventType`. All fixed, each with a new regression test proving the fix (including one
validating directly against the real production schema registry, not just the disk-loaded
test registry — the same pattern `producer.test.ts` already established after an identical
real-world gap surfaced during M5). Round 2: **9.2/10, APPROVED**, no findings remaining.

**This branch is ready to merge to `develop`** once CI is green. Two things intentionally
NOT resolved by this implementation, both already flagged and neither blocking:
- §8's renewal policy-copy question remains an engineering default ("no copy") pending
  Marcelo's confirmation — a product decision, not something this branch can close.
- Per-function CloudWatch error alarm coverage for the new Lambda was intentionally not
  added, matching the exact restraint M4's own queues (router/email-deliver/ses-callback)
  already established in this codebase (DLQ-age alarms exist; per-function error alarms are
  explicitly scoped to the reminder/chasing pipeline's existing module, with broader
  observability coverage deferred to the dedicated Observability milestone already planned
  right after M4/BLOCKER-B, not duplicated ad hoc here).
