# reminder-producer implementation plan — Round 3 (Claude revision)

Responds to Codex round 2 (6.2/10, `round-2-codex-output.txt`, 13 required changes). Everything
from round 1/2 NOT contradicted here stands unchanged (names in round-1 §1, error taxonomy
conclusion that no new `AppError` subclass is needed, most of round-2's port/schema-file-location
corrections). This round's central fix: **the checkpoint-before-continuation ordering bug (required
changes 1+2) is resolved by using this codebase's OWN transactional outbox pattern for the
checkpoint transition** — the same mechanism `producer.ts:264-306` already uses for
claim→dispatch, applied one layer up, to scan-page→continuation. Round 2's own "outbox doesn't
apply here, there's no aggregate write" reasoning (round 1 §4) was the actual mistake: **the lease
row IS the aggregate being written at checkpoint time** — this was hiding in plain sight.

## Required changes 1+2: checkpoint/continuation — outbox-atomic, not send-then-checkpoint

**`SQS_REMINDER_SCAN_CONTINUATION_V1` is reinstated in `OutboxDestination`** (round 2 wrongly
removed it). Checkpoint transition (after a page's candidates are durably published, see §7 below)
is now ONE `TransactWriteItems`, same shape as `producer.ts:286-306`:
```ts
const outboxEntries: DynamoTransactPutEntry[] = [];
appendToTransaction(outboxEntries, deps.tableName, continuationEvent, "SQS_REMINDER_SCAN_CONTINUATION_V1");
await deps.store.transactWrite([
  { Update: buildUnscopedVersionedUpdate({ tableName, key: leaseKey, expectedVersion: leaseVersionThisInvocationRead, set: { lastEvaluatedKey: nextKey /* or REMOVE + status: "COMPLETED" on last page */, leaseUntil: now + LEASE_MS, pagesProcessed: pagesProcessed + 1, candidatesPublished: candidatesPublished + thisPageCount }, extraConditions: [{ expression: "ownerToken = :myToken AND #startKeyCond", ... }] }) },
  ...outboxEntries,
]);
```
`DispatchOutboxRelay` (DynamoDB Streams, `producer.ts:270`'s existing mechanism) is extended to
also recognize `SQS_REMINDER_SCAN_CONTINUATION_V1` and publish to the scan queue instead of the
dispatch queue — same relay, same sweeper-recovers-publish-failures guarantee, routed by the
existing `destination` discriminator (no new relay Lambda). **Verified this round, not just
asserted**: `src/workers/dispatch-outbox-relay/relay.ts:12-14,22-27,122-152` shows the relay is
ALREADY a generalized multi-destination router (`senders: Record<OutboxDestination, Sender>`,
one sweeper instance covers multiple destinations) — it already recognizes
`SQS_REMINDER_DISPATCH_V1` and `SQS_NOTIFICATION_EMAIL_V1` side by side, so adding a third
`senders` entry for `SQS_REMINDER_SCAN_CONTINUATION_V1` (pointing at the scan queue URL) is the
exact, already-precedented extension point — no relay redesign needed. **This closes required change 1's
exact failure trace**: a continuation now literally cannot exist in SQS until the checkpoint
transaction has committed, so "successor consumed before predecessor checkpoint" is impossible by
construction — there is no window where a successor can arrive early, because the successor's own
existence is downstream of (caused by) the checkpoint, not concurrent with it. Required change 2's
"specify a rigorous successor protocol" is answered by removing the need for one: at-least-once
delivery of the SAME continuation (streams relay redelivery, sweeper retry, or SQS standard-queue
redelivery) is idempotent because the checkpoint that produced it already advanced
`lastEvaluatedKey` — a redelivered continuation's handler re-reads the CURRENT lease row, finds
`lastEvaluatedKey` already matches (or is already past) what the message describes as "next to
process," and either does the work once (first delivery) or no-ops (subsequent redeliveries,
detected by comparing the message's OWN `lastEvaluatedKey` against the row's, exactly as round 2
proposed — this piece survives unchanged, now sitting on a sound foundation instead of a broken one).

**Cross-tenant envelope** (needed since `DomainEvent.tenantId: string` is non-optional,
`src/shared/contracts/events.ts:24`): continuation events use `tenantId: "SYSTEM"` — a documented
sentinel, precedented by this same file's existing `actor: { type: "SYSTEM" }` shape for
system-originated events (no new concept, reuses an existing "not a real tenant" convention this
codebase already has).

## Required change 3: work-unit enumeration — matches today's exact loop shape

Round 2 wrongly collapsed to "one message per shard." Corrected: the EventBridge-triggered
invocation reproduces `producer.ts:161-168`'s existing enumeration exactly — `lookback` (default 15,
`deps.lookbackMinutes ?? 15`, unchanged constant) inclusive minutes × `activeGenerations(shardConfig,
now)` (unchanged, handles legacy generations already) × that generation's shard partitions
(`gsi3PartitionsForMinute`, unchanged) — for EACH resulting (generation, shardId, minute) triple,
attempts a lease acquire and, if it wins (fresh or reclaim), sends ONE start message. A triple
whose lease is already `IN_PROGRESS`-unexpired or `COMPLETED` is skipped (no message sent) —
exactly today's implicit "already done" behavior, now explicit. **Lease key now includes
generation**: `PK: SCAN#<shardFnVersion>#<shardId>#<minuteISO>`, `SK: LEASE` — collision-free
across reshard generations (round 2's gap, fixed). At `lookback=15` × up to 2 concurrent
generations (a reshard transition window) × 4 shards = up to 120 (generation,shard,minute) triples
evaluated per tick, but the vast majority are cheap `COMPLETED`-skip reads (already-finished older
minutes) — only the LATEST 1-2 minutes per (generation,shard) are ever genuinely `IN_PROGRESS`
under normal load, so real concurrent scan work stays bounded near `generations × shards` (≤8), not
120 (this bound feeds §8's revised capacity numbers).

## Required change 4: message shapes — command-envelope for candidates, new system-envelope only for continuation

**Claim-candidate messages** (`SQS_REMINDER_CLAIM_CANDIDATE_V1`, NOT outbox-routed — no aggregate
transaction backs a raw GSI3 row) genuinely have a `tenantId` (parsed from `GSI3SK` before
publishing) and DO fit the existing `command-envelope.v1.json` shape unmodified: `commandType:
"reminder.claim-candidate.v1"`, `tenantId` (real tenant), `deduplicationKey:
"${tenantId}|${occurrenceId}|${pageOwnerToken}"`, `data: { occurrenceKey: {PK,SK}, entityType,
gsi3sk }`. New schema file `schemas/queues/reminder-claim-candidate.v1.json`:
`"allOf": [{ "$ref": "command-envelope.v1.json" }, { "properties": { "data": { "required":
["occurrenceKey","entityType","gsi3sk"], "properties": { "entityType": { "enum":
["ReminderOccurrence","DocumentChasingOccurrence"] }, ... } } } }]` — same `allOf` pattern as
`reminder-dispatch.v1.json:6-22` (re-read this round, confirmed shape).

**Scan-continuation messages** genuinely have no real tenant (cross-shard/tenant coordination) —
forcing them into `command-envelope.v1.json` (which requires a real `tenantId`) would be a lie, so
a NEW `schemas/queues/system-envelope.v1.json` is added: same shape as `command-envelope.v1.json`
minus the `tenantId` requirement, plus a fixed `"tenantId": { "const": "SYSTEM" }` (kept present,
not dropped, so every queue message in this codebase has the same top-level field set — simpler
for any shared tooling that reads `tenantId` generically off an envelope, e.g. log correlation).
`schemas/queues/reminder-scan-continuation.v1.json` uses `allOf: [{"$ref":
"system-envelope.v1.json"}, ...]`, `data: { shardFnVersion, shardId, minute, ownerToken,
lastEvaluatedKey (nullable) }`. Both new schemas get valid+invalid fixtures added to the existing
consolidated `test/contract/schemas.test.ts` (round 2's correction, unchanged).

## Required change 5: sender-fault candidates — terminal, not dropped

Reversed from round 2: **any `SenderFault: true` entry in a `SendMessageBatch` response fails the
WHOLE page invocation** (throws after attempting the OTHER entries in that chunk, so
non-sender-fault entries still get their retry chance first) rather than being silently dropped.
This means the checkpoint transaction (§1-2) never runs for that page, so no continuation is ever
produced for it — the chain is stuck `IN_PROGRESS` until `leaseUntil` expires, at which point the
NEXT eligible tick's reclaim (§3) retries the ENTIRE page from the same `lastEvaluatedKey` (safe,
`queryGsi3Page` is a pure read). New metric `CandidateSenderFault` (Count, no dimensions) with an
alarm at >0 over any 5-minute period (fast detection — a sender fault means a real bug in candidate
construction, worth paging on immediately rather than waiting for the DLQ-age alarm's 1-hour
threshold). Retryable (non-sender-fault) entries: the ENTIRE original chunk is retried (not just
the failed IDs) using `nextAttemptDelayMs` (`outbox.ts:192-197`, reused as-is — same backoff
shape, not reinvented), capped at 3 attempts before the page throws as a transient failure (goes
through normal SQS-level retry of the scan/continuation message itself, `maxReceiveCount=5`).

## Required change 6: capacity — worst case is one shard/minute absorbing the full burst, not an even split

Corrected: 10,000 occurrences landing in a SINGLE (shard, minute) — not spread across shards — is
the real worst case (no proof of uniform hashing exists in this codebase, confirmed by round 2's
own finding; assuming otherwise was round 1/2's error). 10,000 ÷ 200/page = 50 pages, chained
sequentially through outbox-relay hops. Each hop: checkpoint transaction (~50ms) + DynamoDB
Streams propagation to `DispatchOutboxRelay` (typically sub-second, occasionally a few seconds
under load — no repo measurement exists, so **2s is used as an explicit conservative per-hop
upper bound**, not a measured average) + SQS send + next invocation's cold/warm start. **50 hops ×
~2.5s conservative-worst-case per hop ≈ 125s to fully drain a single-shard 10k burst** — stated as
an explicit bound, not an estimate dressed as a guarantee; still comfortably under the 5-minute
reconciliation threshold PERF-12 treats as the failure line, with the reasoning shown rather than
asserted.

**Scan Lambda timeout: revised to 90s** (one `queryGsi3Page` call + up to 20 `SendMessageBatch`
chunks of ≤10 candidates each, each individually retryable per §5 — 20 chunks × ~100ms typical +
margin for up to 3 chunks needing full 3-attempt backoff in a bad case ≈ 25s realistic worst case,
90s leaves >3x headroom) → scan queue visibility timeout = 540s (module's fixed 6x). **Lease
duration: revised to 200s** (invariant: ≥2× scan Lambda timeout = 180s ≤ 200s; scan visibility
540s > 200s, preserving the no-redelivery-during-live-lease property with the new numbers). Claim
Lambda/queue unchanged from round 2 (10s timeout / 60s visibility).
**`reserved_concurrent_executions`**: scan queue = **10** (bound from §3's ≤8 genuinely-concurrent
chains + margin, explicit reasoning replacing round 1/2's "= shard count" oversimplification);
`maximum_concurrency` (event source mapping parameter) = 10, matching. Claim queue:
`reserved_concurrent_executions` = **50**, `maximum_concurrency` = 50 — sized against the
single-shard-burst model: 10,000 candidates ÷ 10/batch = 1,000 claim-Lambda batches, at 50
concurrent × ~200ms/batch (this project's existing `reminder-dispatch` claim-shaped Lambda's own
observed latency class, reused as the estimate basis rather than an unmeasured guess) ≈ 4s of
processing time, arriving throughout the ~125s drain window, never backlogged. **`maxReceiveCount
= 5` (module-fixed, unchanged both queues). Batch size: scan = 1 (unchanged reasoning), claim = 10
(matches `reminder-dispatch`'s own existing event-source-mapping batch size,
`infra/main.tf:955-969`'s `reminder_dispatch_from_queue` block — to be cited with exact line
numbers against that block in the final artifact). `MaximumBatchingWindowInSeconds`: 0 for scan
(single-message batches, no reason to wait), matches `reminder-dispatch`'s own existing value for
claim (convention reuse, not a new number).

## Required change 7: error table — corrected reason-specific handling

Codex correctly found today's code treats ANY `TransactionCanceledException` as a lost race
(`producer.ts:309-314`, `document-chasing-producer.ts:112-135`), never inspecting
`getCancellationReasonCodes` (`occ.ts:431-447`) despite that helper existing — **this plan
deliberately does NOT preserve that behavior**, it fixes it, since D-299's own text names
"`CancellationReasons`, distinguindo corretamente" as a requirement of the new claim consumer, not
an optional nicety. Revised table:

| Failure | SQS outcome | Rationale |
|---|---|---|
| `queryGsi3Page` transient DynamoDB error | `batchItemFailures` (retried) | unchanged from round 2 |
| Malformed scan-continuation payload (schema-invalid) | `batchItemFailures` (retried up to `maxReceiveCount`) + `ScanMessageValidationFailure` metric/alarm at >0 | round 2's "log-only" reversed — Codex correctly flagged silent work-unit loss risk; retrying doesn't help a truly malformed message, but it DOES give the alarm time to page before the DLQ absorbs it after 5 tries, and a message that's malformed due to a transient serialization bug (not impossible) gets a chance to succeed on a redeploy before exhausting retries |
| Lease acquire conditional check failed | ack'd, no-op, `LeaseAcquireOutcome{contended}` | unchanged |
| Lease reclaim succeeds | ack'd, `LeaseAcquireOutcome{reclaimed}` | **this IS required change 10's stalled-chain signal — see below** |
| Checkpoint conditional check failed (stale/duplicate continuation) | ack'd, no-op | unchanged reasoning, now safe by construction (§1-2) |
| `SendMessageBatch` sender-fault entry | invocation throws, `CandidateSenderFault` metric+alarm | reversed per §5 |
| Claim consumer `transactWrite` cancelled, occurrence-update entry's reason via `getCancellationReasonCodes` = `ConditionalCheckFailed` | ack'd, no-op (`lost-race`) | the ONLY case that's a true lost race — fixed per Codex's finding |
| Claim consumer `transactWrite` cancelled, any OTHER reason (including on the outbox Put entry) | `batchItemFailures` (retried) | genuine transient failure, now correctly distinguished instead of collapsed |
| Unknown GSI3 discriminator | **invocation throws** (restores `shouldAlarm()`'s existing fail-closed behavior, `producer.ts:149-156`) | round 2 wrongly softened this to a no-op; reversed — D-039's fail-closed intent is preserved unchanged, not weakened by this redesign |

## Required change 8/10: stalled-chain detection — reuses `LeaseAcquireOutcome{reclaimed}`, no new query

No separate periodic reconciliation query is needed: because §3's enumeration re-evaluates the
FULL lookback window (15 minutes) on EVERY tick (unchanged from today), any lease that goes stale
is naturally re-encountered and reclaimed within at most one tick interval (60s) of its expiry —
the existing `LeaseAcquireOutcome` metric (round 1, dimension `outcome`) already fires
`reclaimed` exactly when this happens. New CloudWatch alarm: `Sum(LeaseAcquireOutcome{outcome=
reclaimed})` `> 0` over any 5-minute period → pages (same alarm topic as the DLQ-age alarms,
`alert_topic_arn`). This is an independent, periodic (piggybacked on the 60s tick, not on a
checkpoint) signal that requires NEITHER an empty-queue-and-no-checkpoint condition (Codex's
critique of round 2's `LeaseAgeAtCheckpoint` approach) NOR a new Lambda/query — it reuses work this
design already does every tick. Widget/dashboard JSON: added to
`infra/modules/observability-dashboard/` next to the existing DLQ-age widgets, one new alarm
widget per queue pair — exact Terraform resource names left for the implementation session (this
is boilerplate once the metric/alarm exist, not a design decision).

## Required change 9: test plan — inlined, not referenced

Full test inventory for the implementation session (supersedes round 1/2's "adopted verbatim"
reference):

**Unit** (`test/unit/reminder/`): lease acquire (fresh, contended, reclaim-after-expiry,
reclaim-races-with-still-alive-holder via `version` mismatch); checkpoint transaction (page-1
condition vs. later-page condition as TWO distinct code paths, not one OR expression — resolves
Codex's exact complaint); stale/duplicate continuation no-op; `buildUnscopedVersionedUpdate`
against `occ.ts`'s existing scoped-builder golden outputs, asserting tenant/account-scoped output
is byte-for-byte unchanged after the `scope` parameter becomes optional (Codex's required
condition for accepting the approach at all); canonical `ExclusiveStartKey` serialize/deserialize
round-trip (fixed field order, not raw `JSON.stringify`); `SendMessageBatch` chunking + sender-fault
vs. retryable classification; `getCancellationReasonCodes`-based claim outcome classification for
BOTH `claimReminderOccurrence` (new, extracted named function mirroring the existing
`claimChasingOccurrence` shape at `producer.ts:200-214` — NOT a "byte-for-byte relocation," Codex's
objection accepted, this is a deliberate extraction that also fixes the cancellation-reason gap)
and the unchanged `claimChasingOccurrence`.

**Contract**: both new schemas' valid/invalid fixtures in `schemas.test.ts`.

**Integration** (Vitest, in-memory doubles): successor-before-predecessor-checkpoint race (now
provably impossible, test asserts it — the continuation literally doesn't exist in the fake queue
until the fake DynamoDB Streams relay processes the checkpoint transaction, mirroring
`DispatchOutboxRelay`'s existing test harness); death after checkpoint-but-before-relay-publish
(sweeper recovery path, reusing `DispatchOutboxRelay`'s existing sweeper test pattern); duplicate
scheduler ticks; multiple lookback minutes + 2 active generations simultaneously; unknown raw
`GSI3SK` (throws, per §7); sender-fault candidate (page throws, no checkpoint, reclaimed next
tick); PERF-12-scale (10k) single-shard burst, asserting eventual exactly-once-effective claiming
(round 2's corrected invariant, unchanged) and the ~125s bound from §6 as a soft assertion
(logged, not a hard test failure threshold, to avoid CI flakiness on the exact number).

**Integration (DynamoDB Local)**: `queryGsi3Page` pagination against a real table (`ExclusiveStartKey`/
`LastEvaluatedKey` round-trip); checkpoint `TransactWriteItems` (lease Update + outbox Put)
against real conditional-write semantics.

**Terraform** (`infra/tests/stack.tftest.hcl`): new `run` block asserting `reminder_claim_consumer`'s
IAM role has no `gsi3_read` (round 1's original ask, unchanged), plus assertions for both new
queues' `ReportBatchItemFailures`, batch size, `reserved_concurrent_executions`,
`maximum_concurrency`, visibility timeout, and the claim-queue-concurrency-≥-scan-queue-fan-out
invariant from §6, expressed as a `terraform test` assertion comparing the two module instances'
variables directly (not just documented in prose).

## Required change 11: reconciliation and claim extraction

Round 2's "byte-for-byte" claim corrected: the claim consumer's reminder-path logic is extracted
into a NEW named function `claimReminderOccurrence` (mirroring `claimChasingOccurrence`'s existing
shape at `producer.ts:200-214`, called from the SAME two-branch discriminator the claim consumer's
handler uses — chasing-shape-tried-first, per `parseChasingGsi3Sk`, unchanged dispatch order). This
extraction is NOT behavior-preserving on cancellation-reason handling (§7 deliberately fixes that
gap) but IS behavior-preserving on everything reconciliation depends on:
`status`/`claimExpiresAt`/`GSI6PK`/`GSI6SK` writes stay identical (same `buildVersionedUpdate` call
shape, same `GSI6PK_WORKSTATE_CLAIMED` constant, same `buildExpiredClaimGsi6Sk` call) — proven by a
new test (§9) running the extracted function against reconciliation's own existing
`CLAIMED`-past-expiry fixture, not merely asserted. `reminder-reconciliation.ts`: **confirmed no
change**, citation-backed per round 2 (unchanged this round — Codex's round 2 critique confirmed
the zero-lease-coupling finding, only disputed the extraction-fidelity claim, now fixed above).

## Required change 13→ this round's §: deploy/rollback via explicit env-var toggle

Codex's own three suggested options include "a temporary handler-routing/feature switch" — this
plan adopts it explicitly, addressing the earlier concern that D-299 "rejected a flag": D-299
rejected PERMANENTLY running old and new claim logic concurrently against the same table (a
correctness/race concern — doubling the concurrent-claim surface indefinitely). A **deploy-time-only
env var** (`SCAN_MODE: "LEGACY" | "PAGED"`, read once at cold start, no per-invocation branching
risk) is a materially different, lesser thing: at any given moment exactly ONE mode is live (never
both), and the var is deleted entirely (code for `"LEGACY"` removed) in the third, later change —
it is a rollout mechanism with a defined end, not a standing dual-path architecture.
- **Apply 1**: claim queue + consumer (event-source-mapping enabled, inert — nothing publishes to
  it), scan queue (event-source-mapping enabled — also inert, nothing publishes to it either, since
  `SCAN_MODE=LEGACY` never emits start messages), new port/adapter/handler code deployed but
  `SCAN_MODE=LEGACY` at the environment level keeps `reminder-producer-handler.ts` executing
  exactly today's `runProducerTick` path. This IS enough to make Apply 1 genuinely inert (Codex's
  exact objection to round 2), because the toggle lives in application code reading `process.env`,
  not in Terraform resource wiring whose ordering Terraform doesn't guarantee.
- **Apply 2**: flips `SCAN_MODE=PAGED` via a Lambda environment variable update — a single
  Terraform-managed attribute change, applied atomically to the function configuration (no
  cross-resource ordering concern, since it's one resource's one attribute).
- **Lease/queue cleanup on rollback**: revert Apply 2's env var back to `LEGACY`. In-flight scan
  chains stop producing new checkpoints (no consumer reads them meaningfully once `LEGACY` code
  ignores SQS-sourced invocations — the SQS-triggered handler branch checks `SCAN_MODE` too and
  no-ops with a log line if rolled back mid-flight, rather than assuming it's never invoked).
  Abandoned lease rows expire via `purgeAfterTtl` (corrected attribute name,
  `infra/modules/dynamo-table/main.tf:206-208` — round 2's `ttl` typo fixed) at `leaseUntil + 7d`,
  unchanged from round 1/2's retention choice. Queued-but-unprocessed scan/claim messages age out
  via each queue's normal 4-day retention or get DLQ'd after `maxReceiveCount=5` — both bounded,
  self-cleaning, no manual drain step required, though a runbook note (not a blocking step) to
  purge the claim queue manually before an unusually long rollback window is worth adding in the
  final artifact.

## Self-grade (Claude, blind — before seeing Codex round 3)

**8.7/10.** The outbox-atomic checkpoint is the real fix this round needed — it's not a patch, it
reuses an existing, already-proven mechanism in this exact codebase rather than inventing new
choreography, which is the strongest kind of answer to a Codex correctness objection. Remaining
risk I can see: (a) the "~125s to drain a single-shard 10k burst" bound rests on an unmeasured
2s-per-hop assumption — reasonable but still a judgment call, not a citation; (b) I have not
traced `DispatchOutboxRelay`'s actual code to confirm it can be extended to a second destination
routing target as cleanly as described — asserted from the `destination`-discriminator doc comment
in `outbox.ts`, not from reading the relay's own implementation file; (c) the env-var toggle's
SQS-triggered-branch no-op-on-rollback behavior is new this round and hasn't been checked against
whether an event-source-mapping can even be left "enabled but effectively paused" safely under
Lambda concurrency throttling without messages piling up ugly (functionally fine since they'd just
redrive to DLQ eventually, but worth Codex's eye).
