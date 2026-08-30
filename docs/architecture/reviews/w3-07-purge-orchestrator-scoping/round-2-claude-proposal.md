# W3-07 Purge Orchestrator — Round 2 (Claude proposal, addressing Codex Round 1: 6,7/10)

Codex Round 1 found 5 blocking gaps, all confirmed real on re-reading the code. Fixes below, each
tied to the specific finding.

## Fix 1 (Codex finding 1) — cross-service atomicity was impossible, replaced with the project's
own established launch-repair idiom

Verified by reading `src/modules/extraction/application/start-extraction-run.ts` line-by-line (not
just its existence): the REAL established pattern is not atomicity — it's **calling `StartExecution`
unconditionally on every invocation of the launcher function**, relying on (a) the DynamoDB write
being idempotent (`putIfAbsent`) and (b) Step Functions' own `name`-based idempotency (confirmed via
official AWS docs, `docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html`,
accessed 2026-08-30: *"Automatically returns an idempotent response on starting an execution with
the same name as a currently-running workflow. The new workflow doesn't start and an exception is
thrown once the currently-running workflow is complete."*). The comment in
`start-extraction-run.ts` states this explicitly: `startExecution` is "called EVERY time... not
gated on `created`... Gating it would orphan a run whenever `putIfAbsent` succeeds but the
subsequent `startExecution` call fails transiently."

`CloseOrganizationService.close(tenantId)` (still out of scope to CODE this rodada — this section
specifies its CONTRACT, which Codex correctly flagged Round 1 left too vague):

```text
1. Read TenantLifecycleRecord(tenantId) — always exists (every tenant is bootstrapped ACTIVE
   since D-068/TenantBootstrapService).
2. If status == "ACTIVE": call transitionTenantLifecycle({from: "ACTIVE", to: "DELETING",
   expectedVersion: record.version}). On SystemMutationConflictError, re-read the record — if
   status is now "DELETING" or later, this is a legitimate concurrent-retry landing, proceed to
   step 3; otherwise rethrow (unexpected state, e.g. someone raced a BLOCKED transition).
3. Call StartExecution({name: tenantId, input: {tenantId}}) UNCONDITIONALLY — whether step 2 just
   ran or was skipped because status was already DELETING+ (a retry of this whole function after
   a previous StartExecution failure lands here). ExecutionAlreadyExists is caught and treated as
   the expected "already launched" outcome, never re-thrown.
4. If status is VERIFIED/DELETED/BLOCKED/HELD: return a domain error (organization already
   closing/closed, or blocked — contact support), never attempt a nonsensical transition.
```

This closes the specific orphan case Codex named (write succeeds, `StartExecution` fails, tenant
stuck `DELETING` forever) **for the case where the caller (or a legitimate retry of the same HTTP
request) runs again** — same guarantee level `start-extraction-run.ts` already has in production
today, nothing weaker.

**Durable repair for the case where NO retry of `close()` ever happens** (browser closed, human
never retries, Lambda crashed entirely) — this is Codex's finding 4, addressed without inventing new
infrastructure: the sweeper (already planned for post-`DELETED` residual repair, see Fix 5 below)
gets a SECOND responsibility — scan for `TenantLifecycleRecord`s in any of
`DELETING`/`QUIESCING`/`PURGING`/`VERIFIED` whose `updatedAt` is older than 1 hour (comfortably past
the 1800s quiescence bound, so this never fires on a healthy in-flight execution) and call the exact
same idempotent `StartExecution({name: tenantId, ...})` again for each — a real running execution
makes this a safe no-op (`ExecutionAlreadyExists`); a genuinely orphaned tenant gets its execution
started for the first time. Reuses the one recurring scheduled mechanism this design already has,
rather than adding a third.

## Fix 2 (Codex finding 2) — replaced `Retry`/`Catch` with an explicit `Choice` loop matching
`purgeTenant()`'s real contract

Verified: `purgeTenant()` returns `{status: "SUCCESS"|"PARTIAL"|"FAILED", checkpoint}` as a normal
resolved value, never throws for `PARTIAL` (only `FAILED` reflects an unexpected exception it
couldn't recover from, per its own doc comment). ASL `Retry` fires on a Lambda Task raising an
error, not on a successful result carrying a status field — Round 1 conflated the two. Corrected
state machine for the `QUIESCING -> PURGING -> VERIFIED` segment:

```text
AdvanceToPurging (Task: transitionTenantLifecycle QUIESCING->PURGING, same read-then-conflict-
  handling pattern as Fix 1 step 2)
  -> RunPurge (Task: invokes purge Lambda with {tenantId, checkpoint: null on first entry})
    -> EvaluatePurgeResult (Choice, NOT Retry/Catch):
       - $.status == "SUCCESS"                       -> AdvanceToVerified
       - $.status == "PARTIAL" AND $.retryCount < 20  -> RunPurge again, input =
                                                          {tenantId, checkpoint: $.checkpoint,
                                                           retryCount: $.retryCount + 1}
       - $.status == "PARTIAL" AND $.retryCount >= 20 -> MarkBlocked (blockedReason:
                                                          "PURGE_NOT_CONVERGING")
       - $.status == "FAILED"                         -> MarkBlocked (blockedReason:
                                                          "PURGE_FAILED")
AdvanceToVerified (Task: transitionTenantLifecycle PURGING->VERIFIED, same pattern)
  -> AdvanceToDeleted (Task: transitionTenantLifecycle VERIFIED->DELETED, same pattern) -> Success
MarkBlocked (Task: transitionTenantLifecycle {to: "BLOCKED", blockedReason, blockedFrom: "PURGING"})
  -> Fail (surfaces as a failed Step Functions execution -> CloudWatch alarm, same alarming pattern
     `extraction-workflow`'s own Task failures already use — reused, not invented)
```

The `retryCount < 20` bound (a concrete, arbitrary-but-explicit number, not "retry forever") closes
a real gap Round 1 left open: an unbounded `PARTIAL` loop against a permanently-stuck purge (e.g. a
malformed S3 target) would otherwise run until Step Functions' own hard quota of "25,000 events in
a single state machine execution history" (`docs.aws.amazon.com/step-functions/latest/dg/
service-quotas.md`, fetched directly 2026-08-30: "If the execution history reaches this quota, the
execution will fail") eventually kills the execution as an unexplained failure, rather than
surfacing as an operator-visible `BLOCKED` state deliberately.

## Fix 3 (Codex finding 3) — concrete transition tasks + version-read strategy

Every `Task` labeled "transitionTenantLifecycle X->Y, same pattern" above follows one concrete,
single Lambda handler contract (`tenant-lifecycle-transition-handler`, reused by all 4 forward
transitions — one handler, parameterized by `from`/`to` in the state's own `Parameters`, not 4
separate handlers):

```text
input: {tenantId, from, to}
1. GetItem TenantLifecycleRecord(tenantId), ConsistentRead: true (same posture as
   resolve-request-context.ts's own lifecycle reads elsewhere in this codebase)
2. If record.status == to already: return {alreadyAdvanced: true} (idempotent no-op — a retried
   Task execution, e.g. after a Lambda timeout whose transactWrite actually succeeded, must not
   throw on its own success)
3. If record.status != from: throw InvalidTenantLifecycleTransitionError-equivalent (unexpected
   state — surfaces as a genuine Task failure, Step Functions' native error handling applies here,
   this IS the correct place for Catch->MarkBlocked, unlike Fix 2's PARTIAL/SUCCESS/FAILED case)
4. Call transitionTenantLifecycle({tenantId, from, to, expectedVersion: record.version}) - on
   SystemMutationConflictError, re-read once; if now == to, treat as step-2 idempotent no-op;
   else rethrow.
```

This is the missing "read/version strategy" Codex asked for, expressed as one reusable handler
contract rather than 4 bespoke ones — smaller surface to review/test later.

## Fix 4 (Codex finding 3, Wait-state verification) — confirmed via official AWS source, not
asserted

`docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html` (fetched directly,
2026-08-30): Standard Workflow "Maximum duration: One year" — 1800s (the already-approved D-066
cutoff) is trivially within this; no redesign needed, just the citation Round 1 was missing.

## Fix 5 (Codex finding 5) — sweeper discovery mechanism named explicitly, with its cost tradeoff
stated, not hidden

The sweeper (EventBridge Scheduler, recurring `rate` expression — daily is proposed, not load-
bearing, adjustable without a design change) does a `Scan` of the main table filtered to
`SK = "LIFECYCLE"` (a `FilterExpression`, same mechanism `purgeTenant`'s own scan already uses for a
much larger row set). **Explicit cost tradeoff, not hidden**: DynamoDB `Scan` bills for every item
read BEFORE filtering, so this still costs proportionally to total table size, not to the (much
smaller) number of `TenantLifecycleRecord` tombstones — acceptable at this project's current/near-
future scale (same proportionality argument `w3-07-writer-inventory.md` already made for
`purgeTenant`'s own Scan, "nenhuma GSI indexada só por tenantId existe hoje"), explicitly NOT
proposed as a permanent answer — a future dedicated sparse GSI (tenant lifecycle status as its own
index) is named as the real upgrade path, itself a separate level-5 decision, deferred, not silently
smuggled into this one.

## Updated checklist self-assessment

```text
1. (30%) Full problem shape covered — Choice loop (not Retry/Catch) for the data-level PARTIAL/
   FAILED result; Wait state verified against real AWS Standard Workflow limits; launch-repair
   contract specified for StartExecution failure. SATISFIED.
2. (25%) Reuses existing precedent (extraction-workflow's Step Functions + reminder-schedule's
   EventBridge Scheduler; sweeper reuses purge Scan pattern) — no third mechanism invented, even
   for the StartExecution-repair gap (folded into the already-planned sweeper). SATISFIED.
3. (20%) No D-066/D-067/D-081-083 parameter reopened (1800s cutoff cited+verified, not changed;
   SES policy untouched; sweeper's existence/90-day window unchanged, only its discovery mechanism
   specified). SATISFIED.
4. (15%) StartExecution idempotency now backed by an official AWS citation AND a durable repair
   path for the case the caller never retries (sweeper's second responsibility). SATISFIED.
5. (10%) CloseOrganizationService's CONTRACT is now fully specified (4-step pseudocode above) even
   though its actual code/RBAC/confirmation-UX remains explicitly out of scope for this rodada.
   SATISFIED.
```
