# reminder-producer implementation plan — Round 4 (Claude revision)

Responds to Codex round 3 (7.4/10, 8 required changes). Everything from rounds 1-3 not
contradicted here stands (names, GSI3 port, `SendMessageBatch` handling — confirmed "fixed" by
Codex round 3, error table shape, claim extraction). This round's unifying fix: **every lease
transition that produces a "there should be a next message" intent — acquire, reclaim, AND
checkpoint, not just checkpoint — goes through the SAME outbox+relay mechanism**, closing required
change 1 by generalizing round 3's partial fix instead of patching it a second time.

## Required change 1+3: unified lease-transition table, ALL transitions outbox-atomic

**Every** lease-row write that implies "a message should eventually exist" is now one
`TransactWriteItems` containing the lease write AND an `appendToTransaction` outbox Put, using the
SAME `SQS_REMINDER_SCAN_CONTINUATION_V1` destination for all of them (a "start" message is simply a
continuation with `lastEvaluatedKey: undefined` — already true since round 1, now load-bearing:
the wire shape doesn't distinguish start from continuation, only the outbox-atomicity guarantee
does, uniformly).

| Transition | Item write | Condition | Outbox entry? |
|---|---|---|---|
| **Fresh acquire** (page 1, no prior lease row) | `buildConditionalPut`: `Item: { PK, SK: "LEASE", entityType: "ReminderScanLease", status: "IN_PROGRESS", ownerToken: newToken, leaseUntil: now+200s, lastEvaluatedKey: undefined, pagesProcessed: 0, candidatesPublished: 0, version: 1, purgeAfterTtl: now/1000 + 7*24*3600 }`, `conditionExpression: "attribute_not_exists(PK)"` | row must not exist | YES — start message, `lastEvaluatedKey: undefined` |
| **Reclaim** (row exists, expired) | Same `buildConditionalPut` shape, `Item.version: 1` reset (a reclaim is a fresh chain, not a continuation of the dead one's counters — `pagesProcessed`/`candidatesPublished` reset to 0, new `ownerToken`), `conditionExpression: "status = :inProgress AND leaseUntil < :now"` (values supplied) | row exists, expired | YES — start message, `lastEvaluatedKey: undefined` (restart from page 1 — the dead chain's `lastEvaluatedKey` is discarded, since `queryGsi3Page` is a pure read and redoing it from the top is simpler and cheap at `limit:200`, and safer than trusting a half-written cursor from a chain that died for an unknown reason) |
| **Checkpoint, more pages remain** | `buildUnscopedVersionedUpdate`: `set: { lastEvaluatedKey: nextKey, leaseUntil: now+200s, pagesProcessed: +1, candidatesPublished: +thisPage }`, `expectedVersion` = version this invocation read, `extraConditions: [{ expression: "ownerToken = :myToken AND #cursorCond" }]` where `#cursorCond` is `attribute_not_exists(lastEvaluatedKey)` for a page-1 invocation or `lastEvaluatedKey = :myStartKey` for a continuation invocation — **two distinct code branches choosing which condition string to build, never one OR expression** (Codex round 2's exact ask, restated as now-implemented) | ownerToken + cursor match | YES — continuation message, `lastEvaluatedKey: nextKey` |
| **Checkpoint, last page** (`queryGsi3Page` returned no `LastEvaluatedKey`) | Same builder, `set: { status: "COMPLETED", leaseUntil: now+200s, pagesProcessed: +1, candidatesPublished: +thisPage }`, same ownerToken/cursor condition | ownerToken + cursor match | **NO outbox entry** — completion is terminal, nothing should ever be sent next; round 3's example wrongly called `appendToTransaction` unconditionally (Codex's exact catch, fixed: the transaction array only gets the outbox entries pushed inside the `if (nextKey)` branch, never in the `else` branch) |
| **Continuation/start message received, but lease already `COMPLETED` or past this cursor** | no write | n/a | ack, no-op, logged `"stale message no-op"` — unchanged from round 2/3 |

This closes required change 1 completely: a crash between "lease acquired" and "start message sent"
is now impossible by the same construction that already closed the page-to-page case — the
acquire/reclaim Put and the start-message outbox Put commit together or not at all.

## Required change 2/10: independent stalled-lease detection — extends `reminder-reconciliation`, not a new component

Codex correctly proved lookback-only rediscovery has a real hole (a lease whose minute ages out of
the 15-minute window before ever being retried). Fix: **lease rows get a GSI6 pointer while
`IN_PROGRESS`**, mirroring the EXACT pattern `reminder-reconciliation.ts` already uses for stuck
`CLAIMED` occurrences (`GSI6PK_WORKSTATE_CLAIMED` today) — `GSI6PK: "SCANLEASE#IN_PROGRESS"`,
`GSI6SK: "<leaseUntil-ISO>#<shardFnVersion>#<shardId>#<minuteISO>"` (sortable by expiry, same
"query the oldest-expiring first" shape reconciliation's existing claim-expiry pass already relies
on), written in every acquire/reclaim/checkpoint transaction above (one more `set`/removed on
`COMPLETED`, same transaction, no extra write). **`reminder-reconciliation.ts` gets a genuinely new
third pass** (amending, with reasoning, round 1's "no change" expectation — the task explicitly
allows correcting that expectation, and this is the correction): reusing its EXISTING 5-minute
`CLAIMS`-mode schedule (no new EventBridge schedule, no new Lambda), it also queries
`GSI6PK = "SCANLEASE#IN_PROGRESS"` for `GSI6SK < now`, and for each hit, runs the SAME reclaim
transition as a normal reclaim (new `ownerToken`, fresh start-message outbox entry) — this is the
row's SECOND possible reclaimer (the next EventBridge tick within lookback is the first,
faster path; reconciliation is the backstop that still works after lookback expiry). New metric
`ReconciliationScanLeaseReclaimed` (Count, namespace `ExpirationTracker/ReminderReconciliation` —
existing namespace for that Lambda, confirmed by checking its handler file this round) +
CloudWatch alarm at >0/5min (same alarm shape as round 3's, now on the metric that's actually
independent — reconciliation runs on its own schedule regardless of whether the scan/claim queues
have any traffic at all, correctly answering Codex's "must work when queue is empty" requirement).
IAM: reconciliation's Lambda already holds `gsi6Read()` (confirmed,
`reminder-reconciliation-handler.ts` header comment: "um dos exatamente dois papéis com
gsi6Read()") — the second role already IS this one, so no new grant, just a new query shape against
an index this function already reads.

## Required change 4: `tenantId: "SYSTEM"` — formalized, not borrowed from `actor`

Codex correctly rejected citing `actor: {type: "SYSTEM"}` as precedent for a tenant sentinel — it
isn't one, wrong union. Fix: a new, explicit, documented constant —
`export const SYSTEM_SCOPE_TENANT_SENTINEL = "SYSTEM" as const;` in
`src/shared/contracts/events.ts` itself (next to `DomainEvent`, the type that requires it), with a
doc comment: "the sole legitimate use of a non-tenant value in `DomainEvent.tenantId` — reserved
exclusively for cross-tenant system coordination events (currently: only
`SQS_REMINDER_SCAN_CONTINUATION_V1`). MUST NEVER be read by any tenant-scoped authorization, key
derivation, or data-partition logic — enforced by convention today (no such logic exists yet that
would consume it), not by a type-level guard; a future consumer of this destination must check this
constant explicitly before treating `tenantId` as real." This mirrors, in spirit,
`buildAccountScopedVersionedUpdate`'s doc comment ("never use this for an entity that has a real
tenant") — the SAME codebase convention of "a comment-enforced invariant at the exact call site
that could get it wrong," not a new enforcement mechanism class.

**Complete schemas** (Codex's "not enough to implement without guessing" — filled in, not
elided):
```json
// schemas/queues/reminder-scan-continuation.v1.json
{ "allOf": [{ "$ref": "system-envelope.v1.json" }, { "properties": { "data": {
  "type": "object", "additionalProperties": false,
  "required": ["shardFnVersion", "shardId", "minute", "ownerToken"],
  "properties": {
    "shardFnVersion": { "type": "integer", "minimum": 1 },
    "shardId": { "type": "integer", "minimum": 0 },
    "minute": { "type": "string", "format": "date-time" },
    "ownerToken": { "type": "string", "format": "uuid" },
    "lastEvaluatedKey": { "type": "object" }
  } } } }] }
```
```json
// schemas/queues/reminder-claim-candidate.v1.json
{ "allOf": [{ "$ref": "command-envelope.v1.json" }, { "properties": { "data": {
  "type": "object", "additionalProperties": false,
  "required": ["occurrenceKey", "entityType", "gsi3sk"],
  "properties": {
    "occurrenceKey": { "type": "object", "additionalProperties": false, "required": ["PK", "SK"],
      "properties": { "PK": { "type": "string", "minLength": 1 }, "SK": { "type": "string", "minLength": 1 } } },
    "entityType": { "enum": ["ReminderOccurrence", "DocumentChasingOccurrence"] },
    "gsi3sk": { "type": "string", "minLength": 1 }
  } } } }] }
```

## Required change 5: capacity language — assumptions labeled as assumptions

Round 3's "~125s bound" and "200ms comparison to reminder-dispatch" are relabeled explicitly as
**stated engineering assumptions pending real measurement**, not derived facts: "assumed 2s/hop
(no repo measurement exists — first production burst at this scale should be instrumented and this
number revisited)" and "assumed sub-200ms p50 claim-batch latency (by analogy to
`reminder-dispatch`'s comparable per-record cost, not a cited benchmark)." `batch_size=10` on the
scan queue's precedent is corrected to: `infra/main.tf:955-960`'s `reminder_dispatch_from_queue`
event source mapping sets `batch_size = 10` explicitly but leaves
`maximum_batching_window_in_seconds` unset (AWS default 0 for standard queues) — the new claim
queue's mapping reuses that same explicit `batch_size = 10`, and the scan queue's `0` batching
window is this project's first EXPLICIT `maximum_batching_window_in_seconds = 0` rather than an
inherited default, since batch size 1 makes any nonzero window pure added latency with zero
batching benefit — stated as a deliberate choice, not a copied value.

## Required change 6: added tests

Appended to round 3's inventory: acquire-then-crash-before-outbox-commit (now provably impossible,
same assertion style as the page-checkpoint race test); reconciliation's new
`GSI6PK="SCANLEASE#IN_PROGRESS"` pass reclaiming a lease whose minute has left the lookback window
(the exact scenario Codex's critique #10 walked through, now a named test); final-page transition
asserting NO outbox entry is written (round 3's bug, now guarded by both code structure and this
test); rollback with messages already queued in both new queues (see §8 below); relay/sweeper
sender-map wiring test for the new destination specifically (not just the generic router logic —
asserts the actual `senders["SQS_REMINDER_SCAN_CONTINUATION_V1"]` entry exists and posts to the
right queue URL, mirroring however `SQS_NOTIFICATION_EMAIL_V1`'s own wiring test is structured
today).

## Required change 7: transaction index + chasing wording fixed

Every claim `transactWrite` in this design is always shaped `[Update(occurrence), ...outboxEntries]`
— the occurrence update is **always transaction index 0** (a named constant,
`OCCURRENCE_UPDATE_TX_INDEX = 0`, exported next to `getCancellationReasonCodes` usage sites so the
index is never a magic number at the call site) — this holds for BOTH `claimReminderOccurrence`
(new extracted function) and `claimChasingOccurrence`. Round 3's test-inventory wording calling
`claimChasingOccurrence` "unchanged" is WRONG and retracted: per Codex's citation
(`document-chasing-producer.ts:131-135`, today's catch-all `LOST_CLAIM_RACE`), the SAME
reason-specific fix applies to it — it also switches to
`getCancellationReasonCodes(err)[OCCURRENCE_UPDATE_TX_INDEX] === "ConditionalCheckFailed"` as the
only true lost-race condition, everything else retried. Both functions change identically; only
their surrounding command/event construction (already entity-type-specific today) stays as-is.

## Required change 8: rollback — two-step, mapping-gated, no acknowledge-and-discard

Corrected: rollback is now symmetric with the forward rollout's two-apply shape, not a single env
var flip. **Rollback Apply A**: set BOTH the scan queue's and claim queue's event-source-mapping
`enabled = false` (Terraform attribute change, each its own resource, no ordering dependency
between them since both moving to `false` commutes) — this stops BOTH consumers from being invoked
at all, so nothing is silently acknowledged-and-discarded (Codex's exact objection: a `LEGACY`-mode
no-op handler still `ack`s and deletes the SQS message; disabling the mapping instead means the
message is never delivered to any handler, sitting safely in the queue). **Observe**: operator (or
a scripted check, not a blocking automated gate for this plan's scope) confirms both queues'
`ApproximateNumberOfMessages` + `ApproximateNumberOfMessagesNotVisible` settle near zero OR
accepts they won't (a genuine rollback during an active burst may have real backlog) — either way,
proceed only once mapping-disabled state is confirmed applied (Terraform apply success is
sufficient confirmation of THIS step; draining is a monitoring concern, not a blocking gate).
**Rollback Apply B**: flip `SCAN_MODE` back to `LEGACY`. Now old code resumes scanning, and neither
new consumer can claim concurrently with it (mappings disabled) — "exactly one mode live" is true
again, both at the code-path level AND the message-consumption level (round 3 only had the former).
**Residual queued messages** (scan/claim) are left in place, inert, until either: an operator
manually purges the queues (runbook note, not automated), or a future forward-roll re-enables the
mappings and they're reprocessed under the SAME idempotency guarantees this whole design provides
(stale-cursor no-ops, conditional claim dedup) — so leaving them queued is safe, not just
inert, if rollback is later reversed.

## Self-grade (Claude, blind — before seeing Codex round 4)

**9.0/10.** All 8 required changes have a concrete, checkable mechanism now, not a restated
intention — the unified lease-transition table in particular removes the asymmetry Codex kept
finding (page-to-page fixed, edges not) by applying the SAME primitive everywhere instead of
patching each edge separately. Reconciliation extension is the piece I'm least certain scores
cleanly: it's a real, reasoned design (reusing an existing scheduled Lambda + GSI6 index is more
consistent with this codebase than inventing a new poller), but it does contradict round 1's
original "no reconciliation change" claim, and I'm relying on my own citation of
`reminder-reconciliation-handler.ts`'s `gsi6Read()` comment for the "no new IAM grant" claim
without having re-read the full handler file end-to-end this round.
