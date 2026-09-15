# reminder-producer implementation plan — Round 1 (Claude proposal)

Scope: turn D-299 (architecture, APPROVED) into an executable implementation plan. No code
written in this phase. Grounded in the actual codebase: `infra/main.tf` naming (`reminder_producer`
module, `reminder-dispatch`'s two-queue+relay pattern), `infra/modules/sqs-worker-queue`
(fixed `visibility_timeout_seconds = consumer_timeout_seconds * 6`, fixed `maxReceiveCount = 5`),
`src/shared/observability/context.ts` (`runWithContext`/`getContext`/`correlationIdFromSqsRecord`),
`src/shared/observability/metrics.ts` (`emitMetric`, EMF, dimension-cardinality discipline),
`src/shared/dynamodb/occ.ts` (conditional builders), `src/shared/outbox/outbox.ts`
(`OutboxDestination` union), `src/shared/errors/app-error.ts`.

## Research declaration (research-protocol.md, E-014)

**SIM PARCIAL.** The macro-pattern (decouple scan from claim via two queues) is already
externally researched and cited in D-299 (AWS Prescriptive Guidance, Lambda+SQS developer guide,
SQS API reference). What's new at THIS level is a sub-decision AWS has a well-documented but
non-obvious answer for: **SQS visibility timeout sizing relative to Lambda timeout, and its
interaction with `maxReceiveCount`/DLQ redelivery for a handler that holds an idempotency lease**.
This project's own `sqs-worker-queue` module already encodes one specific answer (6x, fixed,
`maxReceiveCount=5`) as a blanket rule for the dispatch case — applying it unmodified to a
lease-holding consumer needs to be checked against AWS's own guidance on visibility timeout vs.
in-flight processing time, because a lease-based state machine changes what "redelivery mid-lease"
means (D-299's own R3→R4 finding). Checklist applied this round, sourced from AWS Lambda Developer
Guide "Using Lambda with Amazon SQS" (event source mapping / partial batch response) and AWS SQS
"Amazon SQS visibility timeout" page (both already cited as sources in D-299, re-read here for the
consumer-timeout-vs-lease-duration angle specifically, no new source needed):
1. Visibility timeout must exceed **worst-case** processing time, not average — for a lease-based
   consumer, worst case includes lease renewal, not just one page's work.
2. `maxReceiveCount` × avg processing time bounds how long a poison message cycles before DLQ —
   must be reconciled with lease `leaseUntil` duration so an expired lease and an SQS redelivery
   don't race in a way that duplicates or drops work (D-299's exact concern, now at the queue-timer
   level instead of the state-machine level).
3. Batch size for the scan-continuation queue must stay effectively 1 (see §3 below) — AWS's own
   guidance warns partial-batch-failure handling gets materially harder above batch size 1 when
   messages are causally chained (continuation N+1 must not be visible before N's page commits).

## 1. Names

Following `infra/main.tf`'s existing convention (`module "reminder_producer"` /
`function_name = "${local.name_prefix}-reminder-producer"`, and `reminder-dispatch`'s two-worker
pattern: `module.dispatch_queue` + `module.reminder_dispatch`):

- **Scan queue** (continuation messages only): Terraform module `module.reminder_scan_queue`,
  queue name `${local.name_prefix}-reminder-scan`, DLQ `${local.name_prefix}-reminder-scan-dlq`
  (module's own fixed `-dlq` suffix).
- **Claim queue** (per-occurrence candidates): `module.reminder_claim_queue`, queue name
  `${local.name_prefix}-reminder-claim`, DLQ `${local.name_prefix}-reminder-claim-dlq`.
- **Scan handler**: existing `reminder-producer-handler.ts` is repurposed (not replaced) — same
  Lambda (`module.reminder_producer`, `reminder-producer-handler`), same sole holder of
  `gsi3_read`. Its trigger becomes dual: EventBridge Scheduler (tick start, one message per
  eligible shard/minute — unchanged entry point) **and** `module.reminder_scan_queue` (continuation
  messages, same handler, discriminated by event shape: `ReminderProducerEvent` vs. new
  `ReminderScanContinuationEvent`).
- **Claim handler**: new Lambda, following the `reminder-dispatch` naming pattern exactly —
  `module.reminder_claim_consumer`, `function_name = "${local.name_prefix}-reminder-claim-consumer"`,
  `handler_name = "reminder-claim-consumer-handler"`, source file
  `src/runtime/aws/handlers/reminder-claim-consumer-handler.ts`.
- **Page-lease table**: reuses the **main table** (no new table — D-299 says "mesma tabela
  principal"), item shape below.
- **Outbox destinations** (new `OutboxDestination` union members in `src/shared/outbox/outbox.ts`,
  same file/pattern as `SQS_REMINDER_DISPATCH_V1` etc.): `SQS_REMINDER_SCAN_CONTINUATION_V1` and
  `SQS_REMINDER_CLAIM_CANDIDATE_V1`. **Correction from architecture round**: the scan step's own
  candidate-publish + continuation-publish + lease-write are NOT all in one DynamoDB transaction
  (SQS `SendMessageBatch` cannot participate in `TransactWriteItems`) — see §4 for how outbox is
  actually used here vs. the direct-relay pattern.
- **Worker module** (pure logic, clock-injected, observability-agnostic per AGENTS.md §7):
  `src/workers/reminder-scan/scan-page.ts` (one page of `queryGsi3` → candidates + next lease
  state) and `src/workers/reminder-claim/claim-occurrence.ts` (the existing claim logic extracted
  from today's `runProducerTick`, now callable per-candidate instead of per-shard-loop).

## 2. Page-lease state machine

**Item** (main table, single-table design — PK/SK pattern matches existing shard-scan items in
`dynamodb-reminder-producer-store.ts`, confirmed against that file):

```
PK: SCAN#<shardId>#<tickMinuteISO>     e.g. SCAN#3#2026-09-14T22:31:00Z
SK: LEASE
entityType: "ReminderScanLease"
status: "IN_PROGRESS" | "COMPLETED"
ownerToken: string (randomUUID, one per Lambda invocation attempt — NOT per SQS messageId,
            so a redelivered SQS message that re-enters the same invocation semantics gets a
            fresh token and must re-win the conditional acquire, closing the exact silent-drop
            hole D-299 R3 found in the stateless-fence design)
leaseUntil: number (epoch ms)
lastEvaluatedKey: string | undefined (JSON-serialized DynamoDB ExclusiveStartKey for queryGsi3,
            undefined on the first page, present on every continuation)
pagesProcessed: number
candidatesPublished: number
version: number (occ.ts optimistic concurrency, same convention as every other mutable item)
ttl: epoch seconds, 7 days after leaseUntil — cheap cleanup, matches this project's existing TTL
     convention on other transient coordination items (checked against `defaultShardConfig()`'s
     neighbors in dynamodb-reminder-producer-store.ts)
```

**Acquire** (first page of a shard/minute, or reclaim after expiry) — `occ.ts`'s
`buildConditionalPut` with:
`ConditionExpression: "attribute_not_exists(PK) OR (status = :inProgress AND leaseUntil < :now) OR status = :completedNoop"`
— the third arm exists only to make a duplicate "start" message (a Scheduler retry firing the same
shard/minute twice) a safe no-op rather than an error; it still writes nothing new when already
`COMPLETED` (checked in application code before the Put, not relied on as a silent race — same
"belt AND suspenders" pattern `runProducerTick` already uses for claim races today).

**Renew** (before publishing each continuation) — `occ.ts`'s `buildVersionedUpdate` with
`ConditionExpression: "ownerToken = :myToken AND version = :expectedVersion"`: sets new
`leaseUntil`, `lastEvaluatedKey`, increments `pagesProcessed`/`candidatesPublished`, bumps
`version`. **This update happens AFTER the claim-queue `SendMessageBatch` succeeds and BEFORE the
continuation message is sent** — ordering matters: if the process dies between the batch send and
the lease renew, the next attempt (a fresh SQS redelivery of the SAME scan message, since it never
completed) re-reads `lastEvaluatedKey` from the STALE lease state (pre-this-page), re-queries the
same page from `queryGsi3` (deterministic per `lastEvaluatedKey`), and re-publishes the same
candidates. This is why **claim-queue candidates must be idempotent to redelivery independent of
this lease** — already true by construction, because the claim consumer's own conditional
`transactWrite` (§ below) is the actual idempotency boundary for claiming, not the scan side. The
lease's job is only to make forward SCAN progress resumable exactly-once-effectively, not to
dedupe claims (that guarantee already exists one layer down).

**Release** (last page, `queryGsi3` returns no `LastEvaluatedKey`) — `buildVersionedUpdate` sets
`status = "COMPLETED"`, same ownerToken/version condition.

**Expire**: no active "expire" write — a lease simply becomes reclaimable once `leaseUntil < now`,
matched by the Acquire condition above. No separate reconciliation pass is added for this (see §6
— `reminder-reconciliation.ts` is untouched; lease reclaim is self-contained inside the scan path,
triggered by the SAME continuation message that would have fired next, since EventBridge Scheduler
fires a new tick every minute and a new tick for an ALREADY in-progress shard is the natural
reclaim trigger — see §7 for why this is safe rather than racy).

## 3. Timeout/visibility sizing

Fixed module facts (not renegotiable without a `sqs-worker-queue` module change, out of scope
here): `visibility_timeout_seconds = consumer_timeout_seconds * 6`, `maxReceiveCount = 5` fixed.

- **Scan Lambda timeout**: 30s (one `queryGsi3` page + one `SendMessageBatch` + one lease
  renew/acquire — bounded work, generous margin over p99). → scan queue visibility timeout = 180s
  (module-derived, 6x).
- **Claim Lambda timeout**: 10s (unchanged from today's per-occurrence claim — a single `get` +
  `transactWrite`, same cost as today's inner loop iteration). → claim queue visibility timeout =
  60s (module-derived, 6x).
- **Lease duration** (`leaseUntil - leaseAcquiredAt`): **90s** — set independently of the Lambda
  timeout (it is a business-level mutual-exclusion window, not a retry mechanism) but sized against
  it with an explicit invariant: **lease duration ≥ 2x scan Lambda timeout** (30s×2=60s ≤ 90s),
  giving one full retry's worth of headroom before a DIFFERENT invocation is allowed to steal the
  lease, so a slow-but-alive attempt is never pre-empted by its own SQS-triggered retry racing in.
  Combined with **scan visibility timeout (180s) > lease duration (90s)**, an SQS redelivery of the
  SAME message can never arrive before the lease it would contend with has already legitimately
  expired — removing the specific race D-299 R3 found (two live workers believing they both hold
  the lease) by construction, not by luck.
- **`maxReceiveCount=5` (fixed)** on the scan queue means a poison continuation message cycles for
  up to 5×180s = 900s (15 min) before DLQ — acceptable, since EventBridge Scheduler fires a new
  tick every 60s regardless, so a stuck shard's lease will be reclaimed by a FRESH tick's message
  well before the poison copy DLQs; the DLQ path exists for the case where `queryGsi3` itself is
  erroring (data/query bug), not for ordinary transient contention.
- **Batch size**: scan queue consumer batch size = **1** (continuation messages are causally
  chained per shard — processing two "next page" messages for the same shard concurrently is
  exactly the race this design eliminates via the lease, so the event-source-mapping must not
  create that race by delivering >1 at once). Claim queue consumer batch size = **10** (candidates
  are independent per occurrence, matches `reminder-dispatch`'s existing batch size — confirmed
  against `infra/main.tf`'s `reminder_dispatch_from_queue` event source mapping).
- **Concurrency invariant** (D-299, now with numbers): scan queue
  `reserved_concurrent_executions` = number of shards (`defaultShardConfig()`'s shard count,
  confirmed = `DEFAULT_SHARD_COUNT = 4` in `src/modules/reminder/domain/shard-config.ts`) — one in-flight scan per shard by
  construction (the lease already enforces this logically; the Lambda concurrency cap is defense in
  depth, cheap to set). Claim queue `reserved_concurrent_executions` = **16** (≥ sum of scan's
  per-page candidate fan-out — a page of `queryGsi3` batches up to 25 candidates per
  `SendMessageBatch` call, ×4 shards worst-case-concurrent = 100 theoretical peak sends, but claim
  Lambda p50 is <200ms so 16 concurrent claim workers clears a 100-item burst in ~1.3s — matches
  PERF-12's own 10k-in-a-minute volume target with margin, verified against PERF-12's report
  numbers in `docs/architecture/reviews/reminder-producer-structural-fix-scoping/` round artifacts).

## 4. Tracing/logging/metrics/errors/outbox/writes — concrete

- **Correlation ID propagation**: the ORIGINAL scan tick's `randomUUID()` (today's
  `reminder-producer-handler.ts` behavior, unchanged) is carried as an SQS `MessageAttribute`
  named `correlationId` on EVERY message this mechanism sends — both the scan-continuation message
  and every claim-candidate message in a page's `SendMessageBatch` — using the EXACT mechanism
  `correlationIdFromSqsRecord()`/`outboxRecordCorrelationId` already establishes for
  `reminder-dispatch` (same attribute name, same sender-side convention in
  `src/runtime/aws/composition/*.ts`). The scan handler wraps ALL of its work (including
  continuation re-entry) in `runWithContext({ correlationId }, ...)`, reading the attribute via
  `correlationIdFromSqsRecord()` when triggered by SQS and using `randomUUID()` only on the
  EventBridge Scheduler entry point (page 1 of a fresh tick) — same branch shape as today's
  handler. The claim consumer does the same on its inbound message. Net effect: one
  `correlationId` traces a shard/minute's entire page-by-page scan AND every claim it produced,
  queryable end-to-end via CloudWatch Logs Insights.
- **Logging** (`SecureLogger`, no raw `console.*`): new event names —
  `"reminder-scan page complete"` (fields: `shardId`, `tickMinute`, `pageNumber`,
  `candidatesPublished`, `hasMore`), `"reminder-scan lease acquire failed"` (fields: `shardId`,
  `tickMinute`, `reason: "already-in-progress" | "conditional-check-failed"`),
  `"reminder-claim occurrence claimed"` / `"reminder-claim occurrence lost race"` (fields:
  `occurrenceId` type-discriminated per D-299's `GSI3SK` distinction, `outcome`).
- **Metrics** (`emitMetric`, EMF, namespace `ExpirationTracker/ReminderProducer` for the scan side
  reusing the existing namespace since it's the same Lambda, and a NEW namespace
  `ExpirationTracker/ReminderClaimConsumer` for the new Lambda, matching the
  per-service-namespace convention `metrics.ts` documents):
  - `ReminderProducer`: `PagesScanned` (Count, no dimensions), `CandidatesPublishedPerPage` (Count,
    dimension `entityType` ∈ {`ReminderOccurrence`,`DocumentChasingOccurrence`} — closed 2-value
    union, safe per dimension-cardinality rule), `LeaseAcquireOutcome` (Count, dimension `outcome`
    ∈ {`acquired`,`reclaimed`,`contended`} — closed 3-value union).
  - `ReminderClaimConsumer`: `ClaimOutcome` (Count, dimension `outcome` ∈
    {`claimed`,`lost-race`,`unknown-entity-type`} — closed union, same shape as today's
    `runProducerTick` result fields), `ClaimQueueBacklogAge` — **not emitted by the handler**;
    already covered natively by the module's `ApproximateAgeOfOldestMessage` CloudWatch alarm
    (D-299 explicitly names this as native, not a custom metric — kept consistent here rather than
    duplicating).
- **Error taxonomy** (`app-error.ts`): a lease acquire race that loses is NOT an error (expected
  contention, logged/metric'd only). A `queryGsi3` failure inside the scan page throws the SAME
  taxonomy the current handler already uses (`ValidationError` for bad continuation payload shape,
  unchanged AppError subclasses for downstream failures — no new subclass needed, confirmed by
  reading the union in `app-error.ts`; if a future round finds a gap, add
  `ReminderLeaseConflictError extends AppError` only if contention needs to surface as a retryable
  error rather than a logged no-op — deferred as a round-2 open question, not assumed here).
- **Outbox**: candidates and the continuation message are **NOT** written via the transactional
  outbox pattern, and this is a deliberate deviation from AGENTS.md's "critical side-effect in the
  same transaction as the aggregate write" rule — because there IS no aggregate write at scan time
  (the scan step only reads GSI3 and writes its OWN lease item; the occurrence aggregate write only
  happens later, in the claim consumer). The outbox pattern's applicability is at the CLAIM step:
  the claim consumer's existing `get`+`transactWrite` (unchanged from today) is the aggregate
  write, and it already should (today's code should be checked, not assumed — round 2 action item)
  carry its resulting event via the SAME `TransactWriteItems`, exactly like `SQS_REMINDER_DISPATCH_V1`
  today. Round 1 conclusion: **outbox governs the claim→dispatch boundary (unchanged from today),
  not the scan→claim boundary (new, and necessarily a direct `SendMessageBatch`, not outbox-mediated,
  because outbox requires a DynamoDB transaction and the scan step's transaction is the lease
  write, which is unrelated to the individual candidates being published)**.
- **DynamoDB writes**: lease acquire/renew/release exclusively via `occ.ts`'s
  `buildConditionalPut`/`buildVersionedUpdate` (no raw `PutItem`/`UpdateItem`), confirmed pattern
  match against existing shard-scan-state usage in `dynamodb-reminder-producer-store.ts`.

## 5. Test plan

- **Unit** (`test/unit/reminder/`, following existing `in-memory-store.ts` fixture pattern):
  page-lease acquire/renew/release pure logic — concurrent acquire attempts (both should not
  succeed), renew with stale `ownerToken` (must fail), renew with correct token but expired
  `leaseUntil` (must fail — a zombie holder cannot renew past its own expiry), release from wrong
  owner (must fail), reclaim after expiry (must succeed for a NEW ownerToken), redelivery-of-same-
  message-mid-lease (must be a safe no-op re-publish, not a double-claim — this is the exact D-299
  R3 finding, gets its own dedicated test).
- **Integration**: extend the EXISTING GSI3-isolation coverage — this codebase's actual mechanism
  is `infra/tests/stack.tftest.hcl` (Terraform test asserting IAM policy scoping to GSI3, not a
  `.test.ts` file of that exact name — corrected from the task prompt's assumption after checking;
  no `test/integration/gsi3-isolation.test.ts` exists in this repo today). Add a new
  `terraform test` assertion (same file, new `run` block) that the NEW `reminder_claim_consumer`
  Lambda's IAM role has NO `gsi3_read` statement, mirroring the existing assertion pattern for
  `reminder_dispatch`.
- **Integration** (application-level, Vitest): a scan→claim round trip using the in-memory SQS +
  DynamoDB test doubles this codebase already has for `reminder-dispatch` (composition root
  fixtures) — burst volume at PERF-12's 10k scale, asserting ZERO loss (the actual regression this
  whole design fixes) and that pausing/resuming a shard mid-scan (simulated Lambda death) via a
  fresh invocation with the same continuation message reaches `COMPLETED` with all candidates
  published exactly once each.

## 6. `reminder-reconciliation.ts` impact

**Confirmed: no change needed**, with actual reasoning (not just repeating D-299's stated
expectation): `reminder-reconciliation.ts`'s job (per its own file, to be re-read in round 2 for a
citation-level confirmation) is to catch occurrences stuck in `CLAIMED` past `claimExpiresAt` —
that contract is entirely downstream of the claim consumer's `transactWrite`, which writes
`claimExpiresAt` identically to today's code (D-299's own premise, unchanged by this plan since the
claim logic itself is only relocated, not rewritten). The scan-side lease this plan adds is a
DIFFERENT state machine on a DIFFERENT item (`SCAN#...#LEASE`, never `CLAIMED` occurrence rows) that
reconciliation never reads today and has no reason to start reading — a stuck scan lease
self-heals via the next EventBridge tick's reclaim path (§2), not via reconciliation. One residual
open question for round 2: does reconciliation's own scan of `CLAIMED` rows need its OWN
correlation ID propagation update for consistency, even though its logic doesn't change? (Leaning
no — it's not part of this mechanism's message chain — but flagging rather than asserting.)

## 7. Migration/rollout

Big-bang cutover, not staged, for a concrete reason: the scan and claim halves are not
independently useful (a scan queue with no claim consumer just accumulates candidates; a claim
consumer with no new-shape scan producer never receives anything) — there's no safe intermediate
state to stage through, unlike, say, a dual-write migration. Sequencing:
1. Deploy claim consumer Lambda + claim queue (inert — nothing publishes to it yet).
2. Deploy scan queue (inert — nothing subscribes to the OLD producer's shard-loop yet, since it
   doesn't publish to it).
3. Deploy the MODIFIED `reminder-producer-handler.ts` (now page-based) in the SAME release as step
   1/2's infra — this is the actual cutover moment; the old monolithic-per-shard loop code path is
   deleted in this same change, not kept behind a flag (D-299 didn't ask for a flag, and a flag
   here would mean maintaining two claim code paths against the same table, doubling the
   concurrent-claim race surface this whole fix targets).
4. **Occurrences already `SCHEDULED` at cutover**: confirmed safe, with reasoning — `SCHEDULED`
   occurrences are discovered by `queryGsi3`, not by any in-flight queue state; the OLD mechanism's
   only in-flight artifact at cutover is whatever's already sitting in the OLD single-invocation
   claim loop of a tick that started before deploy (which either finishes normally before the
   deploy completes, since Lambda in-flight invocations aren't killed by a code update, or times
   out and is picked up fresh by the NEW scan mechanism's next tick — no occurrence-level state is
   lost either way, since `SCHEDULED` occurrences are read fresh from GSI3 every tick regardless of
   which mechanism is running).
5. Rollback path: revert step 3's Lambda code only (keep the new queues/consumer deployed but
   inert) — since GSI3 access never moved, a revert to the old handler code resumes the old
   monolithic scan immediately with no data migration needed in either direction.

## Self-grade (Claude, blind — written before seeing Codex's round 1 critique)

**7.8/10.** Strong on names/schema/timeout concreteness and correlation ID mechanism (directly
reused existing primitives, verified against real file contents rather than assumed). Weakest
points I can already see: (a) the outbox-boundary reasoning in §4 is my own inference, not
verified against what the CURRENT claim code actually does with outbox — flagged as a round-2
action item rather than resolved; (b) the corrected test-file reference (no
`gsi3-isolation.test.ts` exists) means I'm deviating from the task prompt's literal ask without
having fully traced whether some OTHER file is the intended target; (c) `ReminderLeaseConflictError`
error-taxonomy question left open rather than decided; (d) haven't verified `defaultShardConfig()`
shard count independently beyond one grep-confirmed read. Expect Codex to find at least one of
these, plus likely a sharper take on the claim-queue concurrency arithmetic in §3 (my 100-peak/16-
worker math is a plausibility argument, not a rigorous one).
