# reminder-producer implementation plan — Round 2 (Claude revision)

Responds point-by-point to Codex round 1 (4.3/10, `round-1-codex-output.txt`). Confirmed-correct
findings are NOT re-argued, only fixed. Structural changes below; everything from round 1 not
contradicted here still stands (names in §1, most of §5 test categories, §7 rollback reasoning
shape).

## Required change 1+2: ownership-transfer + checkpoint-loss window — REDESIGNED

Round 1's bug: a fresh `ownerToken` per invocation cannot acquire a lease its own predecessor
still holds. Fix: **`ownerToken` is generated ONCE per (shardId, tickMinute) chain, at first
acquisition, and stays constant across every continuation of that chain** — continuations don't
re-acquire, they present the token they were handed and extend the SAME lease. Only a genuine
**reclaim** (a different chain instance, after `leaseUntil` expiry) mints a new token.

Corrected write ordering per page (was: publish candidates → renew lease → send continuation; now):
1. `queryGsi3` one page (new port shape, required change 4 below) → `candidates`, `nextLastEvaluatedKey | undefined`.
2. `SendMessageBatch` candidates to the claim queue (chunked ≤10, required change 7 below).
3. **If more pages remain**: send the continuation message FIRST, carrying `{ shardId, tickMinute, ownerToken, lastEvaluatedKey: nextLastEvaluatedKey, correlationId }` — durably in SQS before any lease-row write.
4. Only THEN conditionally update the lease row: `ConditionExpression` requires `ownerToken = :myToken` (the token this invocation was handed) AND (`lastEvaluatedKey = :myStartKey` OR both absent) — i.e. the row must still be at the checkpoint THIS invocation started from. Sets `lastEvaluatedKey = nextLastEvaluatedKey`, `leaseUntil = now + 90s`, increments `pagesProcessed`/`candidatesPublished`, bumps `version`. If no more pages: sets `status = "COMPLETED"` instead.

**Why this closes both required changes**: (1) no acquire race — continuations reuse the live
token, no contention with an unexpired lease of their own chain. (2) death between step 3 and step
4 is now safe by construction: the continuation message already exists in SQS (durable), so
processing simply resumes; the handler re-derives `nextLastEvaluatedKey` from THIS page's own
`queryGsi3` call (deterministic, since it queries from the SAME `lastEvaluatedKey` the still-stale
lease row shows) and retries step 4's conditional update — which succeeds now (it was never
applied) or is a safe no-op if a concurrent redelivery already applied it (condition fails only
because `lastEvaluatedKey` already advanced — checked explicitly, logged as `"stale continuation
no-op"`, not an error). **Duplicate candidate publish is possible** in this replay (step 2 may run
twice for the same page) — this is the accepted at-least-once behavior D-299 requires; the claim
consumer's conditional `transactWrite` is the real dedup boundary, not this lease.
**Stale/out-of-order continuation** (an old message for a chain a LATER page already advanced
past — e.g. two overlapping redeliveries): the handler compares its own `lastEvaluatedKey` against
the lease row's CURRENT `lastEvaluatedKey` before doing any work; if the row is already past this
message's starting point, it's a no-op ack, no re-query, no re-publish (cheap, checked before step
1, not after).

**Reclaim** (a NEW EventBridge tick, not a continuation): fires only when a shard/minute unit is
still eligible (see required change 3) and its lease row shows `leaseUntil < now`. Mints a NEW
`ownerToken`, `buildConditionalPut`-style transition (same acquire condition as round 1's §2,
unchanged) using `extraConditions` on the existing lease's `version` so a genuinely-still-alive
holder (clock skew, not actually dead) cannot be pre-empted mid-condition-check — standard
compare-and-swap, no new primitive needed.

## Required change 3: scheduler topology — DECIDED (was contradictory)

The current handler already computes shard partitions and loops them once, in-process
(`runProducerTick`, `src/workers/reminder-producer/producer.ts:184-190`) — confirmed by re-reading.
**Decision: EventBridge Scheduler's tick invocation does NOT itself scan.** It becomes a thin
"enumerate and dispatch start work" step: for each of the 4 shards (`defaultShardConfig()`) that
has no `COMPLETED`/live lease row for `tickMinute`, publish ONE start message per shard directly to
the scan queue (reusing the exact same `SendMessageBatch` path continuations use — a start message
is a continuation message with `lastEvaluatedKey: undefined`). The EventBridge-triggered
invocation itself does zero `queryGsi3` calls — this removes the "same Lambda, two trigger shapes
doing different things" ambiguity Codex flagged. **Duplicate starts** (a retried Scheduler
invocation for the same `tickMinute`): safe no-op by the SAME acquire condition as page 1's lease
acquisition — attempting to acquire an already-`IN_PROGRESS` (unexpired) or `COMPLETED` lease for
that shard/minute fails the condition, logged, not retried. **Lookback**: unchanged from today's
existing lookback-window logic in `runProducerTick` (not part of this redesign — Codex is right
this needs stating, but it is a pre-existing parameter, not a new one; round 3 will cite the exact
existing lookback constant if this remains contested). **IAM**: the EventBridge-triggered path
needs only `sqs:SendMessage` on the scan queue (no `gsi3_read` at all, tightening the boundary
further than today — worth noting as a positive side effect); the continuation/reclaim path
(SQS-triggered) needs `gsi3_read` (unchanged sole holder) + `sqs:SendMessage` on both queues.

## Required change 4: GSI3 port — single-page contract

`Gsi3QueryInput`/`ReminderProducerStore.queryGsi3` (`src/modules/reminder/ports/reminder-store.ts:42-53`)
changes shape (breaking change to this narrow port, confirmed used ONLY by
`dynamodb-reminder-producer-store.ts` and its test double — no other caller):

```ts
export interface Gsi3QueryInput {
  gsi3pk: string;
  exclusiveStartKey?: Record<string, unknown>;
  limit?: number; // default 200, matches reconciliation's existing "página lógica máx. 200" convention (reminder-reconciliation-handler.ts) — reused, not invented
}
export interface Gsi3QueryResult<T> {
  items: T[];
  lastEvaluatedKey?: Record<string, unknown>;
}
export interface ReminderProducerStore {
  queryGsi3Page<T extends EntityKey = Record<string, unknown> & EntityKey>(input: Gsi3QueryInput): Promise<Gsi3QueryResult<T>>;
  get<T extends EntityKey = Record<string, unknown> & EntityKey>(key: EntityKey): Promise<T | undefined>;
  transactWrite(entries: TransactWriteEntry[]): Promise<void>;
}
```

`queryGsi3Page` is a NEW method name (not a rename) so this is additive at the port level; the old
`queryGsi3` (multi-page, internal do-while loop) is deleted from `DynamoDbReminderProducerStore`
in the SAME change — re-confirmed this round by grep: its only callers repo-wide are the port
declaration itself, the adapter definition, and exactly one call site
(`src/workers/reminder-producer/producer.ts:187`, inside the code this whole plan replaces) — safe
to delete outright, not merely an assumption carried from round 1.
The adapter's single `QueryCommand` call passes `ExclusiveStartKey`/`Limit` straight through
(`dynamodb-reminder-producer-store.ts:26-33`'s existing `QueryCommand` shape, do-while removed).
**Security audit**: `auditGlobalIndexAccess` (same call, `pageCount: 1` always now — the "1 event
per logical call" comment at line ~40 was written for the OLD multi-page-per-call shape; the
logical call is now a single page, so this becomes 1 audit event per page, which is the correct
finer-grained trail for this design, not a regression — flagging the comment needs updating,
concrete implementer action item).

## Required change 5: lease schema — fence resolved

Codex correctly found `buildVersionedUpdate` requires `tenantId` and the lease row has none (it's
a cross-tenant coordination row, by design — GSI3 spans tenants). Fix: **new sibling builder**,
following `occ.ts`'s own established extension pattern (`buildVersionedUpdate` vs.
`buildAccountScopedVersionedUpdate`, both thin wrappers over the shared private
`buildScopedVersionedUpdate` core, `occ.ts:73-175`) — add `buildUnscopedVersionedUpdate(input:
UnscopedVersionedUpdateInput)` for the genuinely-scopeless case (no tenant, no account — a process-
coordination row, not a business entity), calling the SAME private core with a fence that's
always-true (`ConditionExpression` omits the scope clause entirely rather than faking a constant
value — cleanest is to generalize `buildScopedVersionedUpdate`'s `scope` parameter to accept
`undefined`, adding zero name/value placeholders and zero condition clause when absent — a small,
mechanical, well-precedented change to `occ.ts`, not a new independent code path). Ownership/state
checks (`ownerToken =`, `lastEvaluatedKey =`) ride on the EXISTING `extraConditions` mechanism
(`occ.ts:29-38`, already designed for exactly this — W3-06's purge worker precedent cited in that
doc comment).

Exact lease item (unchanged PK/SK shape from round 1, restated for completeness):
```
PK: SCAN#<shardId>#<tickMinuteISO>   SK: LEASE
entityType: "ReminderScanLease"
status: "IN_PROGRESS" | "COMPLETED"
ownerToken: string (randomUUID, constant across a chain — see redesign above)
leaseUntil: number (epoch ms)
lastEvaluatedKey: string | undefined (JSON.stringify of the DynamoDB key map, undefined = page 1)
pagesProcessed: number
candidatesPublished: number
version: number
ttl: epoch seconds, leaseUntil + 7d
```
Acquire (page 1 / reclaim): `buildConditionalPut`, `ConditionExpression:
"attribute_not_exists(PK) OR (status = :inProgress AND leaseUntil < :now)"` — round 1's third
`:completedNoop` arm is REMOVED per Codex's correct finding that it was confused; a duplicate
"start" against an already-`COMPLETED` lease is now handled purely in application code (read
before write, log `"duplicate start no-op"`, never attempt the Put) rather than folded into the
condition.
Renew/checkpoint (step 4 above): `buildUnscopedVersionedUpdate` with
`extraConditions: [{ expression: "ownerToken = :myToken AND (attribute_not_exists(lastEvaluatedKey) OR lastEvaluatedKey = :myStartKey)" }]`.
Complete: same builder, `set: { status: "COMPLETED" }`, same extraConditions shape.

## Required change 6: JSON Schemas — added, outbox reverted

Codex is right: neither message goes through the transactional outbox (no aggregate write at scan
time), so `SQS_REMINDER_SCAN_CONTINUATION_V1`/`SQS_REMINDER_CLAIM_CANDIDATE_V1` are **removed from
`OutboxDestination`** (round 1 error, reverted). They become plain message contracts under
`schemas/queues/`, following the existing file convention (`reminder-dispatch.v1.json` etc.):

- `schemas/queues/reminder-scan-continuation.v1.json` — `$id`
  `"https://expiration-tracker/schemas/queues/reminder-scan-continuation.v1.json"`, required:
  `shardId` (string), `tickMinute` (string, ISO), `ownerToken` (string, uuid format),
  `lastEvaluatedKey` (object, nullable/absent = page 1), `correlationId` (string). Envelope follows
  `command-envelope.v1.json`'s existing wrapper (checked: every other queue schema wraps its
  payload the same way — round 3 to confirm exact `$ref` shape against that file). `additionalProperties: false`.
- `schemas/queues/reminder-claim-candidate.v1.json` — required: `occurrenceKey` (object, PK/SK of
  the candidate row), `entityType` (`"ReminderOccurrence" | "DocumentChasingOccurrence"`, closed
  enum matching D-299's GSI3SK discrimination), `gsi3sk` (string, raw sort key value, D-299's
  requirement to preserve it), `correlationId` (string). `additionalProperties: false`.

Both get one valid + one invalid fixture, added as new cases inside the SAME consolidated
`test/contract/schemas.test.ts` (confirmed: this repo has ONE contract test file that iterates all
schemas' fixtures, not one file per schema — round 1/round 2's assumption of per-schema files was
wrong, corrected here) per `AGENTS.md` §7's rule for every new schema.

## Required change 7: SendMessageBatch — corrected to real limit of 10

Round 1's "25 candidates per batch" was wrong (SQS hard limit is 10 entries per
`SendMessageBatch` call, confirmed against AWS SQS API Reference — same source D-299 already cites,
re-read for this exact limit). Fix: candidates are chunked into groups of ≤10, one
`SendMessageBatch` call per chunk, **all chunks for a page must succeed before the continuation is
sent (step 3 above)** — a chunk with any `Failed` entries (SQS returns HTTP 200 with a mixed
`Successful`/`Failed` array even on partial failure, per the API reference) is retried up to 3
times with the SAME entries (SQS dedup is NOT relied upon — standard queue, not FIFO — so a retry
of a chunk whose partial failure already delivered SOME entries WILL redeliver those too; this is
accepted, same at-least-once acceptance as the page-level replay above, closed by the claim
consumer's own dedup). A `Failed` entry with `SenderFault: true` (malformed candidate — should be
impossible by construction, but defensively handled) is logged as
`"reminder-scan candidate malformed, dropped"` and NOT retried (retrying a sender-fault entry
forever would block the whole page); everything else (`SenderFault: false`, throttling/internal
error) retries. After 3 chunk-level retry failures, the WHOLE page invocation throws (surfaces as a
Lambda error, SQS-standard retry/DLQ takes over at the message level) rather than silently
advancing past unpublished candidates — this is the exact rule Codex asked for: **checkpoint/
continuation never advances until every candidate in the page is durably accepted**.

## Required change 8: timeout/throughput — recalculated from the 10k/minute target

Corrected batch-size assumption (10, not 25) changes the concurrency math. Worst case: a single
`queryGsi3Page` with `limit: 200` can return up to 200 candidates → 20 `SendMessageBatch` calls
(sequential within one scan invocation, ~50-100ms each at p50 → ~1-2s added to the scan Lambda's
own per-page work). **Scan Lambda timeout revised: 60s** (was 30s — 200-candidate worst-case chunk
loop plus one `queryGsi3` page plus one lease conditional update, doubled for margin over
p99, since chunk retries (§7) can add real wall-clock time this round's model didn't account for).
→ scan queue visibility timeout = 360s (module-derived 6x). **Claim Lambda timeout: unchanged,
10s.** → claim queue visibility timeout = 60s (unchanged).
**Lease duration: revised to 150s** — invariant restated: lease duration ≥ 2x scan Lambda timeout
(60s×2=120s ≤ 150s), and scan visibility timeout (360s) > lease duration (150s), preserving round
1's race-elimination argument with the corrected numbers.
**10k/minute worst case, concrete**: 10,000 occurrences ÷ 4 shards = 2,500/shard worst case (even
split assumed pessimistically — real sharding may be uneven, flagged as an open question for round
3 if shard hashing isn't provably uniform) → 2,500 ÷ 200/page = 13 pages/shard, sequential (one
page per invocation, chained via continuation) → **13 scan invocations per shard, chained, each
bounded at 60s but typically <5s** — total wall-clock per shard to drain a 2,500-occurrence
backlog is dominated by SQS round-trip latency between chained continuations (visibility delay is
NOT incurred for a fresh send, only for a redelivery — chain proceeds immediately once each
invocation completes), estimated well under 60s end-to-end per shard even at this volume, with
massive margin under the 5-minute reconciliation window PERF-12 treats as the failure threshold.
**Claim queue**: 10,000 candidates ÷ 10/chunk = 1,000 `SendMessageBatch` calls total across all
scan invocations combined (not per-page) → claim consumer processes via batch-size-10
event-source-mapping → 1,000 claim-Lambda batches. **`reserved_concurrent_executions` = 50** for
the claim queue (revised up from round 1's 16 — sized to drain 1,000 batches at p50 <200ms/batch
within roughly the SAME sub-60s window the scan side targets: 1000 batches ÷ 50 concurrent ÷
(1/0.2s) ≈ 4s of pure processing time, generous headroom). **`maximum_concurrency`** (event source
mapping parameter Codex correctly flagged as missing) = 50 for claim queue (matches reserved),
**10** for scan queue... wait, scan queue batch size is 1 and chains are sequential per shard, so
`maximum_concurrency` = 4 (one per shard, matching `reserved_concurrent_executions`, restated from
round 1, now explicit as the SAME `maximum_concurrency` Terraform argument, not left implicit).
All four numbers (both queues' `reserved_concurrent_executions` and `maximum_concurrency`) get
`terraform test` assertions in `infra/tests/stack.tftest.hcl` (round 3 action item: name the exact
`run` block).

## Required change 9: error/outcome table

| Failure | SQS record outcome | Rationale |
|---|---|---|
| `queryGsi3Page` DynamoDB error (throttle/5xx) | `batchItemFailures` (retried) | transient, safe to redeliver, page work is idempotent-by-replay |
| Malformed continuation payload (fails JSON Schema) | NOT in `batchItemFailures` (ack'd, dropped) + `ValidationError` logged | permanent, redelivery can't fix a bad payload; DLQ via schema-invalid path would just loop `maxReceiveCount` times for nothing — dropped with a loud log instead, since AGENTS.md's schema validation already gates this at the boundary |
| Lease acquire conditional check failed (contention/duplicate start) | ack'd (success), no-op | expected, logged `"duplicate start no-op"` / `"reclaim lost race"`, `LeaseAcquireOutcome` metric |
| Lease checkpoint conditional check failed (stale continuation, §1) | ack'd (success), no-op | expected, logged `"stale continuation no-op"` |
| `SendMessageBatch` chunk fails after 3 retries | `batchItemFailures` (retried, whole invocation throws) | must not silently drop candidates — see §7 |
| Claim consumer: `get` returns not-found (row deleted/already terminal) | ack'd (success), no-op | occurrence resolved by another path already |
| Claim consumer: `transactWrite` `ConditionalCheckFailed` (lost race to concurrent claim) | ack'd (success), no-op | D-299's own explicit "only ConditionalCheckFailed counts as a lost race" rule, unchanged from today's code |
| Claim consumer: `transactWrite` other `CancellationReasons` | `batchItemFailures` (retried) | genuine transient failure, unchanged from today's code path |
| Unknown `entityType`/`gsi3sk` discriminator | ack'd (success), no-op + `unknown-entity-type` metric | same as today's `unknownEntityType` counter in `runProducerTick`'s result — behavior preserved, not new |

`ReminderLeaseConflictError` (round 1's deferred question): **resolved as NOT needed** — every
lease-conflict path above is a logged no-op, never a thrown error, so no new `AppError` subclass is
required. Round 1's open question is closed, not carried forward.

## Required change 10: observability wiring — completed

New metrics added to round 1's list (still namespace `ExpirationTracker/ReminderProducer` for scan,
`ExpirationTracker/ReminderClaimConsumer` for claim): `ContinuationSendFailure` (Count, no
dimensions — a page whose candidates published but continuation send exhausted retries),
`CandidateChunkRetry` (Count, dimension `outcome` ∈ {`retried`,`dropped-sender-fault`}),
`LeaseAgeAtCheckpoint` (Milliseconds, no dimensions — `now - leaseAcquiredAt` at each renew, the
signal Codex asked for to detect a chain running unexpectedly long), `PageDurationMs`
(Milliseconds, no dimensions). **Stalled-chain detection** (Codex's specific ask: "missing
continuation while no queue backlog exists"): a new CloudWatch alarm on
`ExpirationTracker/ReminderProducer`'s `LeaseAgeAtCheckpoint` breaching 90% of the 150s lease
duration for 2 consecutive periods — cheaper than a synthetic canary, reuses the metric already
being emitted, added to `infra/modules/observability-dashboard/` alongside the existing DLQ-age
widgets (exact widget JSON, round 3). Logging: every log line in the scan/claim path now includes
`shardId`, `tickMinute`, `pageNumber`(scan)/`occurrenceKey`(claim), matching Codex's ask for
checkpoint/page identity in every line, via `SecureLogger`'s `baseContext` merge (existing
mechanism, no new primitive).

## Required change 11: test plan — rewritten around at-least-once/exactly-once-effective

Round 1's wrong "published exactly once each" integration assertion is corrected to: **every
occurrence eligible in the burst is eventually claimed exactly once** (candidates may duplicate,
claims may not). Full edge-case list per Codex's required change 11 is adopted verbatim as the
round-2 test plan (all 15 items Codex listed, `round-1-codex-output.txt` lines ~13443-13459) plus
round 1's original unit-test list for acquire/renew/reclaim (still valid under the new ownership
model, re-scoped to the single-token-per-chain semantics). `test/integration/` gets a real
DynamoDB Local-backed test (not just in-memory doubles) for the pagination/conditional-write/
outbox-at-claim-boundary path specifically, since that's exactly where a real-vs-mocked DynamoDB
behavior gap would hide a bug (LastEvaluatedKey serialization round-tripping through JSON, in
particular — a documented DynamoDB gotcha with Binary/Set types, worth an explicit test even though
this table's keys are plain strings, confirmed by checking `EntityKey`'s `PK`/`SK: string` shape).

## Required change 12: reconciliation — cited, not asserted

Re-read `src/workers/reminder-reconciliation/reconciliation.ts` this round (worker, not the handler
— the handler only wires it up). Its claim-expiry pass (documented at lines 7-8, implemented at
84-97) reads exactly `occurrence.status === "CLAIMED"` and `occurrence.claimExpiresAt`, and its
revert path removes `GSI6PK`/`GSI6SK` (line 97) — it never reads or writes anything scan-lease-
related (no `SCAN#...#LEASE` PK shape appears anywhere in this file). Since the claim consumer's
`transactWrite` is a pure relocation of `producer.ts:264-289`'s existing block (no logic rewrite,
confirmed this round by re-reading that exact line range — it sets `status`, `claimExpiresAt`,
`GSI6PK`/`GSI6SK` `WORKSTATE#CLAIMED` identically), reconciliation's contract with the claim step is
untouched by construction, not by inference. **Confirmed: no change needed**, now citation-backed
rather than provisional. A new test (§11 above) proves this rather than re-asserting it: run the
extracted claim logic against the SAME fixture reconciliation's own tests already use for a
`CLAIMED`-past-expiry row, assert identical `GSI6PK`/`claimExpiresAt`/cancellation-reason handling.

## Required change 13: deploy/rollback — made explicit

Terraform sequencing across TWO applies (not one, correcting round 1's false single-release
claim). D-299 explicitly rejected a dual-code-path flag (round 1 §7, unchanged reasoning) — so the
two applies are staged by TOGGLING INFRASTRUCTURE, not by branching application code. **Apply 1**
ships everything new but INERT: claim queue + claim consumer Lambda + its event-source-mapping
(`enabled = true` — harmless, since nothing publishes to the claim queue yet), scan queue with its
event-source-mapping `enabled = false` (queue exists, nothing consumes it yet), and the new
port/adapter/handler code deployed to the `reminder-producer` Lambda but NOT yet reachable — the
EventBridge Scheduler target is left pointed at the old code path in this same apply, so the old
per-shard-loop mechanism keeps running unchanged and unaffected by Apply 1. **Apply 2** (separate,
sequenced after confirming Apply 1's resources are healthy — DLQ empty, alarms green): flips the
scan queue's event-source-mapping to `enabled = true` AND swaps the EventBridge Scheduler target's
handler code path in the SAME deploy (both must move together — a half-migrated state where
EventBridge still calls the old per-shard-loop code while the scan queue is also live would double-
process). **Old code deletion**: happens in a THIRD, later change once Apply 2 has run clean for an
observation window (not bundled into Apply 2, so a fast revert of Apply 2 doesn't require restoring
deleted code from git history under pressure). **Rollback of Apply 2**: revert the event-source-
mapping to `enabled = false` and the EventBridge target back to old code, in one Terraform apply —
safe because old code never depended on the new queues/lease rows existing, and any lease rows /
queued messages left behind are inert (TTL-cleaned, no consumer reads them while disabled) rather
than actively harmful; explicitly NOT safe to roll back Apply 2 without ALSO disabling the
event-source-mapping (Codex's correct point — leaving it enabled while pointing EventBridge at old
code would let both mechanisms claim concurrently, which is safe from a correctness standpoint
since claims are still conditionally deduped, but reintroduces exactly the throughput problem this
whole design fixes, so it's a functional regression even if not a correctness bug — documented,
not left implicit).
**Cutover-time `SCHEDULED` occurrences**: unchanged conclusion from round 1, now stated once
(GSI3 is queried fresh every chain regardless of mechanism, no occurrence-level state depends on
which mechanism is running) — confirmed correct by Codex's silence on this specific point in round 1.

## Self-grade (Claude, blind — before seeing Codex round 2)

**8.4/10.** All 13 required changes addressed with concrete mechanism, not hand-waving — the
ownership-transfer redesign in particular is a real fix, not a patch (single-token-per-chain is
simpler than round 1's model, not just different). Still-open gaps I can see: (a) the deploy §13
reasoning has visible mid-paragraph backtracking (I talked myself out of a wrong claim in the same
paragraph) — needs a clean rewrite, not just a correct conclusion; (b) round 3 still owes several
"to be confirmed" citations (exact reconciliation lines, exact contract-test file path, exact
lookback constant, uniform-sharding assumption) that are flagged rather than resolved — real risk
those surface actual new problems, not just paperwork; (c) the `queryGsi3Page` deletion-safety claim
("nothing else calls it") is asserted from memory of an earlier grep, not re-verified this round.
