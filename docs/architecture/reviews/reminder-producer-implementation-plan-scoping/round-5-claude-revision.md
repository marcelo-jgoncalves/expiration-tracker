# reminder-producer implementation plan — Round 5 (Claude revision)

Responds to Codex round 4 (8.4/10, 4 required changes — all others confirmed closed). Everything
from rounds 1-4 not contradicted here stands as the final plan.

## Required change 1: `leaseUntil >= :now` added to both checkpoint branches

Round 4's gap, confirmed: an expired owner could still renew/complete if no reclaimer had won yet.
Fixed — both checkpoint conditions (nonterminal and terminal, round 4's table) gain one more ANDed
clause: `extraConditions: [{ expression: "ownerToken = :myToken AND leaseUntil >= :now AND
#cursorCond", values: { ":now": Date.now() } }]` (the existing `occ.ts` `extraConditions` mechanism
already merges names/values with collision detection — no new primitive, just one more clause in
the same array). This makes checkpoint fail-closed the instant a lease has expired, even if the
original (slow, still technically alive) holder is the one attempting it — forcing that straggler
onto the same "stale message no-op" path a genuine redelivery would take, and leaving the row free
for the next reclaimer. New named test (round 4's inventory gains this item, previously only
implied by the unit-test list): **"renew with correct token, correct cursor, correct version, but
`leaseUntil` already passed → checkpoint conditional check fails, ack'd as stale no-op, row stays
reclaimable."**

## Required change 2: complete schemas — reuses `domain-event-envelope.v1.json`, no new base envelope

Round 4's mistake, found by Codex: `system-envelope.v1.json` doesn't exist and was only referenced,
never specified. Correction, and a SIMPLER answer than inventing one: the continuation is
constructed as a `DomainEvent` and passed through `appendToTransaction` exactly like
`ReminderDispatchRequested` is today (`producer.ts:274-287`) — its wire schema is therefore
properly `schemas/events/domain-event-envelope.v1.json` (verified this round: already has
`tenantId: { type: "string", minLength: 1 }`, no tenant-format constraint to violate, plus
`actor`/`aggregate`/`data`, exactly the shape a system event needs) with a NEW specializing schema,
matching `reminder-dispatch.v1.json`'s own extension pattern exactly:

```json
// schemas/events/reminder-scan-continuation.v1.json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://expiration-tracker/schemas/events/reminder-scan-continuation.v1.json",
  "title": "reminder.scan-continuation.v1",
  "description": "Cross-tenant system event, outbox-written atomically with a ReminderScanLease acquire/reclaim/checkpoint transition, relayed to the reminder-scan SQS queue by DispatchOutboxRelay (destination SQS_REMINDER_SCAN_CONTINUATION_V1).",
  "allOf": [{ "$ref": "../events/domain-event-envelope.v1.json" }],
  "type": "object",
  "properties": {
    "eventType": { "const": "reminder.scan-continuation.v1" },
    "tenantId": { "const": "SYSTEM" },
    "aggregate": {
      "type": "object",
      "properties": { "type": { "const": "ReminderScanLease" } }
    },
    "data": {
      "type": "object",
      "additionalProperties": false,
      "required": ["shardFnVersion", "shardId", "minute", "ownerToken"],
      "properties": {
        "shardFnVersion": { "type": "integer", "minimum": 1 },
        "shardId": { "type": "integer", "minimum": 0 },
        "minute": { "type": "string", "format": "date-time" },
        "ownerToken": { "type": "string", "format": "uuid" },
        "lastEvaluatedKey": { "type": "object" }
      }
    }
  }
}
```
The relay's own SQS send still wraps this in the project's `SqsCommandEnvelope` shape at publish
time (unchanged mechanism — `DispatchOutboxRelay` already does this translation for
`SQS_REMINDER_DISPATCH_V1` today, confirmed by re-checking `relay.ts`'s sender signature this
round), so the message actually landing in the scan queue is `SqsCommandEnvelope<{shardFnVersion,
shardId, minute, ownerToken, lastEvaluatedKey}>` with `commandType: "reminder.scan-continuation.v1"`,
`tenantId: "SYSTEM"` — its OWN queue-side schema,
`schemas/queues/reminder-scan-continuation.v1.json`, mirrors `reminder-dispatch.v1.json`'s exact
structure (`allOf: [{"$ref": "../queues/command-envelope.v1.json"}]`, `commandType: {"const":
"reminder.scan-continuation.v1"}`, same `data` shape as the event above). **Claim-candidate schema,
corrected per Codex's citations**: `$ref` path fixed to `"../queues/command-envelope.v1.json"`
(round 4's bare `"command-envelope.v1.json"` was wrong, matching the exact convention
`reminder-dispatch.v1.json:6` uses), `commandType: { "const": "reminder.claim-candidate.v1" }`
pinned (round 4 omitted this), `$schema`/`$id`/`title` added matching the exact top-level shape
every other file in `schemas/queues/` already has. Both queue schemas + the one new event schema
get valid/invalid fixtures in `test/contract/schemas.test.ts` (unchanged mechanism from round 2).

## Required change 3: rollback — bounded quiescence wait + epoch fence for residual messages

Two independent fixes, since Codex correctly separated "did admitted invocations finish" from "is
replaying old residual work semantically valid":

**Quiescence**: Rollback Apply A (disable both mappings) is followed by an explicit wait of
`max(scanLambdaTimeout, claimLambdaTimeout) = 90s` (round 3's scan Lambda timeout, still the
larger of the two) before Rollback Apply B may proceed — long enough that ANY invocation admitted
in the instant before the mapping was disabled has either completed or been killed by its own
Lambda timeout; this is a NAMED, bounded wait (not "monitoring, non-blocking" as round 4 wrongly
called it), stated as a concrete runbook step with a concrete number, not an operator's judgment
call.

**Epoch fence** (answers Codex's deeper point — a quiesced system can still hold OLD, valid-looking
messages whose replay is semantically stale): every start/continuation event's `data` gains one
more field, `rolloutEpoch` (an integer, incremented each time `SCAN_MODE` flips `LEGACY`→`PAGED`,
stored as a Lambda environment variable alongside `SCAN_MODE` itself, e.g.
`SCAN_MODE_EPOCH="2"`). The scan handler, on receiving ANY message (start or continuation),
compares the message's `rolloutEpoch` against its OWN environment's current `SCAN_MODE_EPOCH`; a
mismatch (message from a PRIOR epoch — i.e., queued before the last rollback/roll-forward cycle) is
treated as a stale no-op, ack'd and dropped, logged `"stale epoch, dropped"` with a
dedicated metric (`StaleEpochMessageDropped`, Count) so an operator can see this happening rather
than have it silently vanish. This makes "leave residual messages queued for a future re-enable"
actually safe by construction (Codex's exact objection) — a future re-enable bumps the epoch again,
so anything left over from BEFORE the rollback is automatically invalidated rather than assumed
valid via idempotency alone. Claim-candidate messages do NOT need this fence (they're not part of
the lease chain — a stale candidate simply attempts its normal conditional claim, which is either
still valid, in which case claiming it late is correct behavior no different from claiming it on
time, or already resolved, in which case the existing not-found/lost-race no-op paths handle it —
no new field needed there, kept as-is from round 4).

## Required change 4: stale "exactly two roles" citation retracted; D-299 scope updated

Round 4 wrongly cited `reminder-reconciliation-handler.ts`'s header comment ("um dos exatamente
dois papéis com gsi6Read()") as current-state confirmation. Codex is right that this comment is
stale — `infra/modules/dynamo-table/main.tf`'s actual GSI6 policy today authorizes **four** roles,
not two (this plan does not change that count further — reconciliation's role already has
unrestricted Query/GetItem on GSI6, confirmed independently this round by Codex's own citations,
`main.tf:298,310,312` + `dynamo-table/main.tf:395` — so the "no new IAM grant needed" conclusion
still holds, just not for the reason round 4 cited). Action item for the implementation session:
update that header comment's stale "exactly two" count to reflect current reality as an
unrelated-but-noticed doc-drift fix, not part of this design's own change set.

**D-299 scope correction, made explicit rather than left as two standing conflicting statements**:
D-299's original text ("a expectativa arquitetural é que não precise" for
`reminder-reconciliation`) is AMENDED by this implementation plan, with reasoning recorded here
rather than silently overridden: reconciliation gains a third pass (`SCANLEASE`, alongside existing
`CLAIMS`/`DST`) because the independent stalled-lease detection requirement (this plan's own scope,
item 5 of the original task) has no other implementation that satisfies "works even after the
producer's own lookback window can no longer rediscover the stale unit" without either a new
Lambda+schedule (more surface than needed) or coupling to the one component that already runs an
appropriately-scoped periodic sweep. The final consolidated artifact updates D-299's own text (a
short addendum note, not a rewrite) to reflect this correction, per the implementation task's
explicit instruction to "confirm or correct [D-299's] expectation with actual reasoning."

## Self-grade (Claude, blind — before seeing Codex round 5)

**9.2/10.** All 4 required changes closed with concrete mechanism, each traced to a specific
Codex citation rather than a generic response. The epoch-fence addition is the one genuinely new
mechanism introduced this late in the protocol — a real risk of a last-round surprise gap, but it's
a small, additive field on messages the plan already fully controls (not a structural change to
the transition table or queue topology), and it follows the same "one more field, one more
comparison" shape as every other fix this protocol has converged on, so I don't expect it to open
new ground the way the round 1→2 replan did.
