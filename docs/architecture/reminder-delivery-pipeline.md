# BLOCKER-B — End-to-End Reminder Delivery: Gap Analysis + Architecture Decision

> **Status: DRAFT — architecture decision only, no code changed yet.** This is the
> deliverable `docs/architecture/blocker-b-recon-handoff.md` pointed to. Materialization
> downstream (claim→dispatch→notification→SES) and infra are already real and are NOT
> redesigned here — see `blocker-b-recon-handoff.md` §3 for that evidence. This document
> covers only the missing trigger between policy/item writes and `ReminderMaterializer`.

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
proven for `notification.intent-created.v1` (ADR-0004, ADR-0008):

```text
createItem / updateItem / renewItem (expiration-service.ts)
  -> emit expiration.item-due-date-changed.v1 (already exists for update/renew;
     ADD to createItem too — an item is "born" with a due date, same semantic)
createPolicy / updatePolicy / disablePolicy (reminder-policy-service.ts)
  -> ADD emission of reminder.policy-changed.v1 (new event type)
       both -> EventBridge (default outbox path, no `destination` override)
       -> new EventBridge Rule (detail-type in both types)
       -> new SQS queue `reminder_materialization_queue` (+ DLQ, via existing
          infra/modules/sqs-worker-queue, same as every other queue)
       -> new Lambda handler + pure worker `reminder-materialization-trigger`:
            1. read ExpirationItem (strongly consistent)
            2. if item.status != ACTIVE -> cancel-only, no materialize (see §6)
            3. resolve item-scoped policies for this itemId (see §5 for the lookup fix)
            4. for each policy: reconcile stale occurrence versions, then
               materializer.materialize() if policy.enabled
```

This keeps the write path exactly as fast/simple as today, reuses infra that's already
tested and alarmed (M3.5/M4), and needs no new AWS resource class — only one more queue
instance of an existing module. Consistent with §14 "operational simplicity" and the
project's existing at-least-once assumption (materialize() is already idempotent, so
duplicate delivery of this event is safe).

## 5. Item→policy lookup fix

**Chosen: denormalized pointer row under the item's own partition, not a new GSI.**

When an `ITEM`-scoped policy is created or updated, write (in the same `TransactWriteItems`
as the policy write) a pointer row:

```text
PK = TENANT#<t>#ITEM#<itemId>
SK = POLICYREF#<policyId>
{ policyId, enabled }
```

The trigger worker queries the item's own partition with `begins_with(SK, "POLICYREF#")`
— the exact same query shape `ReminderStore.queryByItem` already uses for `OCC#` rows
(`dynamodb-reminder-store.ts:61-82`), so this needs one more narrow method on the port, not
a new GSI, no new Terraform, no new capacity planning. Rejected a new GSI: overkill for a
lookup that's inherently ≤ a handful of policies per item, and GSI slots are a scarcer,
harder-to-add resource than one more item-partition row.

Cost/complexity: one extra `Put`/`Update` in the existing policy-write transaction; one
extra strongly-consistent `Query` (already paid, same partition as the item read) in the
trigger worker. No new alarms, no new capacity model entry needed.

## 6. Policy-version / disable staleness (real correctness gap, not just wiring)

`cancelStaleOccurrences` only compares `itemVersion`. Extend `ReminderMaterializer` with a
new method (name TBD in implementation, e.g. `reconcilePolicyOccurrences`) that, for a given
`(tenantId, itemId, policy)`, cancels `SCHEDULED`/`CLAIMED` occurrences where
`occurrence.policyId === policy.policyId AND (occurrence.policyVersion !== policy.version OR
!policy.enabled)` — same one-conditional-update-per-occurrence pattern already used (not a
single unbounded transaction). This closes: policy edited (new trigger times) leaving old
occurrences deliverable, and policy disabled leaving already-materialized occurrences
deliverable (today, disabling a policy does **not** cancel its already-materialized
`SCHEDULED` occurrences at all — RB-G3/RB-G7 relevant finding).

## 7. Renewal semantics

`renewItem` already emits the due-date-changed event for the **new** item (version 1,
`previousDueDate: null`) — the trigger worker's step 3 will find the new item's own
policies (if `assigneeUserId`/policy were copied — check at implementation time whether
policies need to be copied to the new item id, since policies are `itemId`-scoped, not
lineage-scoped: a policy attached to the old item does **not** automatically apply to the
renewed item's new `itemId` today. This is a second real domain finding, needs an explicit
decision — likely "policy copy on renew", not silently doing nothing — flagged here for
implementation, not resolved as a documentation-only decision).

## 8. Backfill safety

Existing `ReminderPolicy` rows saved before this deploy will never have fired an event, so
they will not auto-materialize on deploy (no event = no trigger = no mass-materialization
risk — deploy-safe by construction, satisfies RB-G10 without extra guard logic). They
remain inert until their item's due date changes or the policy is re-saved. A one-off,
manually-triggered backfill (not automatic) is needed to materialize existing policies;
implementation should add a narrow, idempotent backfill script (reuses `materialize()`
as-is, safe to run twice) rather than any automatic mass-trigger on deploy.

## 9. Remaining sections (not yet written — implementation in progress)

Idempotency (already covered — reuses existing occurrence key), Retry/UNKNOWN_OUTCOME
(unchanged, M4 already handles this downstream), State Machine (unchanged), Timezone
(unchanged, `computeSchedule` already handles it), Multi-Tenancy (event carries `tenantId`,
worker never queries cross-tenant — same isolation pattern as every other worker), Security/
IAM (new Lambda gets read on item partition + policy write + `ReminderStore`, no new
`Resource:"*"`), Observability (reuse existing metrics/alarm pattern per queue), Testing,
Operational Runbook, Cost. These sections will be filled in as implementation proceeds and
are deferred pending Codex review of §4-§7 above (Type 1 data-model decision per AGENTS.md
§4 — new event type + new pointer row + new worker require the Claude↔Codex protocol before
further code is written).

## 10. Claude self-review (Round A)

- Renewal policy-copy gap (§7) is the most severe open finding — without resolving it,
  BLOCKER-B would ship with renewed items silently losing their reminders, which is worse
  than today's status quo in one specific way (today nothing works; after this fix,
  original items work but renewed items look like they should and don't) — this needs a
  product decision, not just an engineering one, and must not be quietly deferred.
- Rejected keeping `cancelStaleOccurrences`'s current itemVersion-only semantics and hoping
  policy-version drift doesn't happen — quiet hours/trigger-time edits are exactly the kind
  of policy update expected in real usage, this had to be closed now, not left for later.
- Everything downstream of `ReminderOccurrence` creation is explicitly untouched — no
  redesign risk introduced into the already-approved M3.5/M4 pipeline.

Next step: Codex adversarial round on this document before writing implementation code.
