# BLOCKER-B — End-to-End Reminder Delivery: Gap Analysis + Architecture Decision

> **Status: DRAFT, Round C (reconciled after Codex Round B: 5.8/10, NOT APPROVED).**
> Round B's full findings and the fix for each are in §11. One CRITICAL finding
> (dispatch-time freshness fencing) is already implemented and tested in code (commit
> `3eeda33`, ahead of this doc revision — reconciliation is architecture-first per
> AGENTS.md §4, but a self-contained, low-risk, already-necessary fix to the existing
> approved M4 dispatch path was applied immediately rather than left as a known gap while
> the rest of the design was still being argued over). Everything else in §11 is corrected
> here, in the design, before more code is written. Materialization downstream
> (claim→dispatch→notification→SES) and infra are already real and are NOT redesigned here
> — see `blocker-b-recon-handoff.md` §3 for that evidence. This document covers the missing
> trigger between policy/item writes and `ReminderMaterializer`, plus the item-lifecycle
> coverage and pointer/backfill correctness Round B found missing.

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
  meaning: "this policy's state changed — reconcile the occurrences it owns"
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
    reconcilePolicyOccurrences(item, policy)   // cancel stale-version/disabled (§6)
    if policy.enabled: materializer.materialize(item, policy)
  materializer.cancelStaleOccurrences(itemVersion)  // existing itemVersion safety net

on item-deactivated(itemId):
  cancelAllOccurrences(tenantId, itemId)   // new materializer method, unconditional,
                                            // same one-conditional-update-per-row pattern

on policy-changed(policyId):
  policy = strongly-consistent GET ReminderPolicy(policyId)
  if !policy or policy.scope != "ITEM": no-op (TEMPLATE scope out of scope, §2)
  item = strongly-consistent GET ExpirationItem(policy.itemId)
  if !item or item.status != ACTIVE: no-op (item-deactivated event, if any, handles cleanup)
  reconcilePolicyOccurrences(item, policy)
  if policy.enabled: materializer.materialize(item, policy)
```

This keeps the write path exactly as fast/simple as today, reuses infra that's already
tested and alarmed (M3.5/M4), and needs no new AWS resource class — only one more queue
instance of an existing module. Consistent with §14 "operational simplicity" and the
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
  new `itemId !== old itemId`), the old pointer is `Delete`d in the same transaction; if new
  `scope === "ITEM"`, the (possibly new) pointer is `Put`. Moving a policy to a different
  item therefore atomically removes discoverability from the old item and adds it to the
  new one — old item's now-orphaned occurrences are handled by `policy-changed` firing (the
  update always fires it) reaching the OLD item's occurrences too: the trigger worker's
  `reconcilePolicyOccurrences` step, run for policy-changed, only reconciles by `policyId`
  match on existing occurrence rows regardless of which item currently points to the
  policy — so an occurrence still tagged with this `policyId` under the old item gets
  cancelled the same way a version bump would cancel it (§6), even though the old item's
  partition no longer has a pointer.
- `disablePolicy`: pointer is left in place (still discoverable — a disabled policy must
  still be reachable so its occurrences get cancelled, not orphaned).
- No hard-delete of a policy exists anywhere in the current API (`reminder-policy-service.ts`
  has no `deletePolicy`, only create/update/disable) — pointer lifecycle for a deletion path
  is explicitly out of scope until that API exists, not silently assumed.
- Domain validation added: `PutPolicyInput` gains the invariant "`scope: "ITEM"` requires
  `itemId`; `scope: "TEMPLATE"` forbids it" — enforced in `ReminderPolicyService`, matching
  Round B's finding that neither the domain type nor the JSON schema enforced this today.
- **ITEM policy integrity (Round B MEDIUM finding)**: `createPolicy`/`updatePolicy` for
  `scope: "ITEM"` now condition-check (via the same `buildVersionConditionCheck` added for
  the dispatch fence, existence-only form: no expected version, just
  `attribute_exists(PK) AND tenantId = :tenantId AND #status = :active`) that the target
  `itemId` exists, is `ACTIVE`, and belongs to the same tenant, inside the same transaction
  as the policy write. A policy can never reference a nonexistent/foreign/inactive item.

## 6. Policy-version / disable staleness — reframed after the dispatch fence

`cancelStaleOccurrences` only compares `itemVersion`. `ReminderMaterializer` gains a new
method `reconcilePolicyOccurrences(tenantId, itemId, policy)` that, for the given policy,
cancels `SCHEDULED`/`CLAIMED` occurrences where `occurrence.policyId === policy.policyId
AND (occurrence.policyVersion !== policy.version OR !policy.enabled)` — same
one-conditional-update-per-occurrence pattern already used (not a single unbounded
transaction), and a sibling `cancelAllOccurrences(tenantId, itemId)` for the
`item-deactivated` path (§4) that cancels every live occurrence regardless of policy.

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
transiently leave extra `SCHEDULED` rows (a data-hygiene concern, cleaned up by the next
successful reconcile pass for that item/policy) — dispatch is the only point that must be,
and now is, unconditionally fenced against delivering a stale reminder** (RB-G3/RB-G7 are
satisfied at the delivery boundary, which is the boundary that actually matters).

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
- **Policy moving old item → new item** (§5's pointer-move case): the update's own
  `policy-changed` event reconciles the NEW item's occurrences by policy match; occurrences
  still tagged with this `policyId` under the OLD item are cancelled by the same
  `reconcilePolicyOccurrences` matching-by-`policyId` logic (§5), not by needing the old
  item's own pointer to still exist.
- **Disable immediately followed by enable**: two `policy-changed` events, processed in
  whatever order — final state always converges to a fresh re-read of the policy's true
  `enabled`/`version` at the time each event happens to run, and the last one to actually
  execute (not necessarily the last one *sent*) determines the materialized set, which is
  exactly correct: an occurrence set that doesn't match the CURRENT policy state is, by
  definition, stale and eligible for the next reconcile pass to fix — never silently wrong
  at the point where it would cause a delivery, per §6.

## 8. Renewal semantics — item-deactivated fix + explicit product decision

`completeRenewal` transitions the OLD item to `RENEWED` in the same transaction that
creates the new item (`expiration-service.ts:437`) — this now also emits
`expiration.item-deactivated.v1` for the OLD item's id, alongside the existing
`expiration.item-due-date-changed.v1` for the NEW item (unchanged). This closes Round B's
CRITICAL finding #1 for the renewal case: the old item's live occurrences are cancelled via
the same `cancelAllOccurrences` path as archive/delete, not left deliverable.

**Explicit product decision (Round B correctly flagged this as unresolved, not
"less severe than the dispatch race" — both are real, and this one is decided here, not
deferred again):** policies are `itemId`-scoped, not lineage-scoped — a policy attached to
the old item does **not** automatically apply to the renewed item's new `itemId`. This
implementation makes **no automatic copy**. Renewed items start with zero reminder
policies. Rationale: a silent copy risks silently reproducing a stale/wrong cadence onto a
new lineage the user may want to configure differently (e.g. a renewed contract with a
different notice period); the fail-safe default is "no reminder" over "possibly-wrong
reminder," matching this project's epistemic-integrity stance elsewhere (never assert more
certainty/completeness than is true). **This is a known, user-facing product gap** —
renewing an item silently drops its reminders — that must be surfaced to Marcelo before
BLOCKER-B is declared resolved (§section "Final BLOCKER-B Status" below), not buried in an
engineering doc. It does not block this architecture from proceeding (both outcomes —
"copy" or "don't copy" — need this same event-driven trigger underneath either way), but
BLOCKER-B's `Definition of Done` cannot honestly claim renewal is fully handled until
Marcelo picks one.

## 9. Backfill safety — corrected (Round B HIGH finding: the original claim was false)

**The original claim in this document ("policies remain inert until their item's due date
changes or the policy is re-saved") was wrong and is corrected here.** A due-date change on
an item with a pre-existing (pre-deploy) `ITEM`-scoped policy does **not** trigger anything,
because that policy has no `POLICYREF` pointer row (pointers only start being written the
moment this change deploys) — the trigger worker's pointer lookup finds nothing, `git blame`
notwithstanding a real due-date-changed event fires. Only re-saving the policy itself
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
5. Checkpoint by `policyId` so the script is resumable and rate-limitable across a large
   installed base without holding a long-lived scan cursor.

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
| 2 | No atomic fencing at dispatch against concurrent policy/item change | CRITICAL | `buildVersionConditionCheck` + dispatch transaction fence | **Fixed in code, commit `3eeda33`, 45 tests green** |
| 3 | Reconciliation can create stale occurrences after a "current" pass | HIGH | Reframed: dispatch fence (fix #2) is the real guarantee; materialize-time races are now correctly scoped as data hygiene, not a delivery risk (§6) | Design fixed |
| 4 | Pointer lifecycle underspecified (moves, scope change, orphans, authoritative dereference) | HIGH | Full invariants specified, pointer is discovery-only and never authoritative (§5) | Design fixed, pending implementation |
| 5 | Backfill claim was factually wrong | HIGH | Corrected claim + full 5-step backfill design (§9) | Design fixed |
| 6 | `dependency-cruiser` justification overstated | MEDIUM | Claim corrected, event-driven choice re-justified on its real merits (§10) | Design fixed |
| 7 | Event ordering/payload semantics incomplete | MEDIUM | Explicit "invalidation signal only" principle + case-by-case analysis (§7) | Design fixed |
| 8 | ITEM policy integrity not enforced (policy can reference nonexistent/foreign item) | MEDIUM | Condition-checked at policy write time (§5) | Design fixed, pending implementation |
| 9 | Pointer's duplicated `enabled` field invites divergence | LOW | Pointer now stores only `{ policyId }`, no `enabled` field (§5) | Design fixed |
| 10 | Deterministic identity uses only a 32-bit hash | LOW | Acknowledged pre-existing, out of scope for this fix per Codex's own note ("not necessarily before implementing the architecture skeleton") | Accepted, tracked as backlog |

## 12. Claude self-review (Round A/C)

- The renewal policy-copy decision (§8) is a genuine product decision, not an engineering
  one — made explicit here ("no copy") with rationale, but flagged for Marcelo's
  confirmation before BLOCKER-B is declared resolved, not silently assumed either way.
- The dispatch fence (finding #2) was implemented immediately rather than left pending
  alongside the rest of the design reconciliation: it is a narrow, self-contained,
  already-necessary correctness fix to the existing *approved* M4 path, fully covered by
  the existing test suite (45 reminder tests + 621 full suite, all green) plus a new test
  requirement now owed for the freshness-race path specifically (tracked for
  implementation, not yet written as of this revision).
- Rejected trying to make materialize-time races structurally impossible (e.g. a
  transactional generation-marker scheme) — the dispatch fence already makes the
  *observable* invariant (no stale delivery) hold unconditionally, so added complexity at
  materialize time would buy correctness the system already has, at real implementation
  cost. Revisit only if data-hygiene noise (stray cancelled-later rows) becomes an
  operational nuisance in practice.
- Everything downstream of `ReminderOccurrence` creation past the dispatch fence remains
  untouched — no further redesign risk introduced into the already-approved M3.5/M4
  pipeline.

Next step: implement §4-§9 (trigger worker, pointer lifecycle, lifecycle events, backfill
script, Terraform), with tests per Round B's original ask (concurrency, tenant isolation,
renewal, backfill) — then a fresh Codex round (D) on the real diff, not just the design.
