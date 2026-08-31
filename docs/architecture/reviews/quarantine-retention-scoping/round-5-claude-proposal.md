# Quarantine/Recovery Window + LGPD Retention Gaps — Round 5 (Claude proposal, reconciliation)

Round 4 scored 8.7/10. 4 items remain (1 partial + 1 new + 1 not-fixed + 1 Round-3 leftover). All
closed here.

## Fix 1 — Durable reconciliation for `HELD_FOR_RECOVERY` after `StopExecution` succeeds but the OCC restore keeps failing

The single retry in Round 4 was not durable. Fix: the SAME sweeper Lambda that already runs daily
post-`DELETED` (`tenant-purge-sweeper`, D-124) gains a second responsibility — reconcile
`HELD_FOR_RECOVERY` records where `recoveryDeadline` has passed AND a cancellation was attempted
(a new boolean flag, `cancellationRequested`, set by `CancelOrganizationClosureService` in the SAME
transaction as the first restore attempt, before calling `StopExecution` — durable evidence a
cancel was in flight even if the rest of the operation never completes). For each such record: call
`DescribeExecution` on the deterministic ARN; if the execution is confirmed
`ABORTED`/`SUCCEEDED`/nonexistent (i.e., genuinely not running), retry
`transitionTenantLifecycle(HELD_FOR_RECOVERY → ACTIVE, expectedVersion)` — same idempotent-repair
idiom the sweeper already uses for `DELETED` residue, just applied to a different terminal
condition. This closes the gap without inventing a new mechanism: the daily sweeper cadence is the
existing durable retry loop, not a new one. `cancellationRequested` gives the sweeper a way to find
these records without a table scan for `HELD_FOR_RECOVERY` alone (same GSI query shape the sweeper
already uses).

## Fix 2 — `security-audit.ts` contract corrected; new error given a real shape

The contract is `{ reason: string; action: string }`, `action` deliberately typed `string`
(confirmed by re-reading the file, not asserted) — so `"organization:cancel-close"` logs
correctly, no change needed there beyond describing it accurately. `ClosureCancellationDeniedError`
is specified concretely: extends `AppError`, `category: "AUTHORIZATION"`, `code:
"CLOSURE_CANCELLATION_DENIED"`, `retryable: false` — same shape every other `AppError` subclass in
`app-error.ts` already follows, not a hand-wave.

## Fix 3 — `ReminderOccurrence` (not the nonexistent `RecurrenceOccurrence`), real async cascade named honestly

Correcting the factual error: the entity is `ReminderOccurrence`
(`reminder-materializer.ts`), and `ExpirationService.deleteItem()` does NOT atomically purge it —
it emits `expiration.item-deactivated.v1`, and `ReminderMaterializer.cancelAllOccurrences()`
cancels (status change) occurrences asynchronously in response — cancellation, not physical
deletion. **This means `CORE_USER_DATA`'s backlog item #1 was actually two workers, not one**:
1. `ExpirationItem`/policy soft-deleted records past `deletedAt + 30d` — physical purge worker
   (as Round 3 described, now correctly scoped to just these two entities).
2. `ReminderOccurrence` records left `CANCELLED` by the existing event-driven flow above — a
   SEPARATE physical purge worker, triggered off the same `deletedAt + 30d` signal read from the
   parent item (occurrences don't carry their own `deletedAt`; the purge worker for these joins
   against the parent's status, same join the reminder flow itself already performs to find them).

Named as 2 backlog units instead of 1 — the priority order itself is unchanged (still slot #1
overall), only the internal decomposition is corrected.

## Fix 4 — Identity resolution for the cancel path, closing Round 3's still-open item

`CancelOrganizationClosureService`'s entry point resolves `cognitoSub → userId` via a direct
`IdentityMapping` lookup (`identity-mapping-repository.ts`, already used read-only elsewhere in this
codebase for exactly this kind of lookup, e.g. by `resolve-request-context.ts` itself before it
goes on to the parts of resolution this cancel path deliberately skips) — **read-only, never
triggers `bootstrapUser()`/onboarding**: if no `IdentityMapping` exists for the `cognitoSub`, the
cancel request fails with `NotFoundError` (the user has never completed login/bootstrap at all,
which cannot be true for anyone who could have triggered the original `close()` — `close()` itself
requires a resolved `RequestContext`). This is the one explicit deviation from normal resolution:
skip `RequestContextResolver`'s Organization-membership/lifecycle-status gating (the entire reason
this dedicated path exists) while still reusing its identity primitive, not reinventing identity
lookup.

## Estado final

Todos os 4 itens da Rodada 4 (incluindo o remanescente da Rodada 3) fechados com mecanismo
concreto, reusando primitives já existentes do código real (sweeper, `IdentityMapping`,
`AppError`/`security-audit.ts` shapes) em vez de inventar novos. Nenhuma decisão anterior
(mecanismo, duração de 30 dias, prioridade LGPD, escopo design-only) reaberta.
