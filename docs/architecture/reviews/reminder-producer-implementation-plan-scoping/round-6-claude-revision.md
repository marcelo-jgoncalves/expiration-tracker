# reminder-producer implementation plan — Round 6 (Claude revision)

Responds to Codex round 5 (8.2/10, 4 required changes, all mechanical/precise — no new structural
issues found this round, a good convergence signal). Everything from rounds 1-5 not contradicted
here is final.

## Required change 1: placeholder collision fixed

`:now` collides with `occ.ts`'s reserved placeholder (`occ.ts:85,96`, throws on collision per
`occ.ts:130` — confirmed by re-reading). Fixed: the checkpoint's `extraConditions` entry uses
`:leaseNow` instead, and — since `leaseUntil` is persisted as an ISO string (consistent with
`GSI6SK`'s existing `<leaseUntil-ISO>#...` sort-key design from round 4's reconciliation pointer,
confirmed against that shape) — the comparison value is `new Date().toISOString()`, not
`Date.now()`: `extraConditions: [{ expression: "ownerToken = :myToken AND leaseUntil >= :leaseNow
AND #cursorCond", values: { ":leaseNow": new Date().toISOString(), ... } }]`. ISO-8601 timestamps
compare correctly lexicographically (same property this codebase's other ISO-sortable keys, e.g.
`GSI6SK`, already rely on), so a plain string `>=` DynamoDB condition is sound without any numeric
conversion.

## Required change 2: continuation event carries a COMPLETE `SqsCommandEnvelope` in `data`, matching the existing dispatch pattern exactly

Codex's finding, verified: `DispatchOutboxRelay` does NOT wrap `event.data` into an
`SqsCommandEnvelope` — it forwards `record.payload` (i.e. `event.data`) to the destination's sender
as-is (`relay.ts:91`, `composition/reminder.ts:140-144`). Today's dispatch path only works because
`producer.ts` builds the COMPLETE `DispatchCommand` (`messageVersion`, `messageId`, `commandType`,
`tenantId`, `deduplicationKey`, `data`, `producer.ts:246-262`) and assigns it directly as
`event.data` (`producer.ts:284`, `command as unknown as Record<string, unknown>`) — the event's
`data` field IS the wire message, not a wrapper around it. This plan's continuation event follows
the IDENTICAL shape, corrected from round 4/5's "inner fields only" mistake:

```ts
const continuationCommand: SqsCommandEnvelope<{
  shardFnVersion: number; shardId: number; minute: string;
  ownerToken: string; lastEvaluatedKey?: Record<string, unknown>; rolloutEpoch: number;
}> = {
  messageVersion: 1,
  messageId: deps.newEventId(),
  commandType: "reminder.scan-continuation.v1",
  createdAt: now,
  correlationId,
  tenantId: "SYSTEM",
  deduplicationKey: `${shardFnVersion}|${shardId}|${minuteISO}|${pagesProcessed + 1}`,
  data: { shardFnVersion, shardId, minute: minuteISO, ownerToken, lastEvaluatedKey: nextKey, rolloutEpoch: currentEpoch },
};
const event: DomainEvent = { specVersion: "1.0", eventId: deps.newEventId(), eventType: "reminder.scan-continuation.v1", source: "expiration-tracker.reminder-producer", occurredAt: now, correlationId, tenantId: "SYSTEM", actor: { type: "SYSTEM" }, aggregate: { type: "ReminderScanLease", id: `${shardFnVersion}#${shardId}#${minuteISO}`, version: newLeaseVersion }, data: continuationCommand as unknown as Record<string, unknown> };
```
`schemas/events/reminder-scan-continuation.v1.json`'s `data` sub-schema is corrected to describe
this FULL `SqsCommandEnvelope` shape (not just the inner fields) — effectively
`allOf: [{"$ref": "../queues/command-envelope.v1.json"}, {"properties": {"commandType": {"const":
"reminder.scan-continuation.v1"}, "tenantId": {"const": "SYSTEM"}, "data": {"required": [...,
"rolloutEpoch"], "properties": {..., "rolloutEpoch": {"type": "integer", "minimum": 1}}}}}]`
nested inside the outer `domain-event-envelope.v1.json`'s own `data: {"type": "object"}` slot —
i.e. the event schema's `data` property is now `{"allOf": [{"$ref":
"../queues/command-envelope.v1.json"}, {...as above...}]}` rather than a flat field list. The
QUEUE-side schema (`schemas/queues/reminder-scan-continuation.v1.json`, what the claim/scan
consumer actually validates against on receipt) is now identical in shape to this embedded `data`
description — both describe the exact same wire bytes, since no relay-side transformation happens
between them (this is what makes the "mirrors" language from round 5 concrete rather than
hand-wavy: they're not just similar, they're validating the identical object).

## Required change 3: `rolloutEpoch` — required, present everywhere a start/continuation is emitted

Added to BOTH schemas' `required` arrays (event-side and queue-side, both corrected above).
**Every emitter of a start or continuation message stamps it**, named explicitly: (a) the
EventBridge-triggered enumeration's fresh-acquire path, (b) the reclaim path (both the
EventBridge-tick reclaim AND, critically per Codex's specific catch, reminder-reconciliation's new
`SCANLEASE` reclaim pass — round 4/5 hadn't named this second reclaim site as an epoch-stamping
site, now explicit: `runReconciliation`'s new pass reads the SAME `SCAN_MODE_EPOCH` environment
variable, requiring reconciliation's Lambda config to also carry it, one more env var on an
existing function), and (c) the checkpoint path (carries forward the SAME epoch the invocation
itself was invoked under — read once from its own environment at cold start, not re-read per
message, so a long-lived warm invocation spanning an epoch bump still finishes its in-flight page
under the OLD epoch consistently rather than mixing epochs mid-page — acceptable since the 90s
quiescence wait, §4, guarantees no such invocation survives across a real rollback/roll-forward
cycle anyway).

## Required change 4: rollback/roll-forward ordering — explicit gates, not implied sequencing

**Rollback**, restated as a strict, named sequence:
1. Terraform apply: both event-source-mappings' `enabled = false`.
2. **Gate**: poll `aws lambda get-event-source-mapping` (via the `claude-dev` profile, per this
   repo's existing AWS-verification convention) for BOTH mappings until `State == "Disabled"`
   (AWS's own documented terminal state, distinct from the transitional `Disabling` — confirmed
   via AWS Lambda's `UpdateEventSourceMapping`/`GetEventSourceMapping` API reference this round,
   Codex's own citation). Do NOT start the quiescence timer on apply-success alone.
3. **Gate**: 90-second bounded wait (unchanged number/reasoning from round 5) starts only after
   step 2's poll confirms both `Disabled`.
4. Terraform apply: `SCAN_MODE = "LEGACY"`.

**Roll-forward** (new/re-enable — not previously given its own explicit gate order, added this
round): 1. Terraform apply: bump `SCAN_MODE_EPOCH` to `N+1` (deployed as a Lambda environment
variable change, same mechanism as `SCAN_MODE` itself) — this MUST land before step 2, so anything
that starts matching from step 2 onward is unambiguously post-bump. 2. Terraform apply:
`SCAN_MODE = "PAGED"`. 3. Terraform apply: both mappings' `enabled = true`. Any message left queued
from before the rollback (necessarily stamped with epoch ≤ N, since nothing could stamp `N+1`
before step 1 completed) is now provably stale the instant a handler reads it under the new
`SCAN_MODE_EPOCH = N+1` — closing required change 3's residual-message concern with the exact
ordering guarantee Codex asked for, not just the comparison mechanism alone.

## Self-grade (Claude, blind — before seeing Codex round 6)

**9.3/10.** All 4 fixes are narrow, mechanical, and each traces to a specific Codex citation with
no new structural surface introduced (round 5's own critique confirmed 3 of 4 items were
"conceptually closed, integration incomplete" — this round is exactly that integration, not a new
idea). The one piece I'd flag as still worth a skeptical read: the `data.data` nesting in the event
schema (an `SqsCommandEnvelope` embedded inside a `DomainEvent`'s `data` field, itself containing
ANOTHER `data`) is verbose and easy to get subtly wrong in a real Ajv schema file — it's correct by
construction (matches `producer.ts`'s own existing double-nesting exactly) but worth the
implementer writing the actual schema file carefully rather than trusting this doc's prose
one-for-one.
