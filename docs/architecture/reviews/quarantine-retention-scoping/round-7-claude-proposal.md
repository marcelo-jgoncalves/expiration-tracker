# Quarantine/Recovery Window + LGPD Retention Gaps — Round 7 (Claude proposal, reconciliation)

Round 6 scored 8.7/10 (unchanged weighted total, narrower remaining gaps). 2 items, made maximally
conservative (fail-closed on ambiguity, no more "probably safe" reasoning) rather than argued.

## Fix 1 — Restoration requires `ABORTED` + matching `closureAttemptId` + record still `HELD_FOR_RECOVERY`; every other case alarms, none auto-restore

Removing the disputed claim entirely instead of defending it: `FAILED`/`TIMED_OUT`/nonexistent are
**no longer treated as safe** (Codex is right — a workflow can fail or time out after performing
partial irreversible purge work; this codebase's own `purgeTenant()` already models a `PARTIAL`
outcome for exactly this reason). The sweeper's restoration rule narrows to a single conjunction,
all three required:

1. `DescribeExecution` reports `ABORTED` (the one status that is the direct, deterministic result
   of `StopExecution` succeeding before any Task ran to completion — the only status with no path
   through the purge `Task`).
2. The execution's `closureAttemptId` (embedded in the execution name, `${tenantId}-
   {closureAttemptId}`) matches the CURRENT `TenantLifecycleRecord.closureAttemptId` — closes the
   stale-candidate gap: a sweeper pass that reads a record already reused by a later `ACTIVE →
   HELD_FOR_RECOVERY` cycle (a second close-then-cancel-then-close-again sequence) never restores
   against the wrong attempt.
3. `TenantLifecycleRecord.status` is still `HELD_FOR_RECOVERY` at read time (re-confirms nothing
   else moved it since the scan).

**Every other combination — `FAILED`/`TIMED_OUT`/`SUCCEEDED`/execution not found, or a
`closureAttemptId` mismatch — raises the same `AWS/States`-class alarm used since D-124 and leaves
the record untouched.** This is deliberately the more expensive branch (an operator has to look),
not a design gap: given this is `HELD_FOR_RECOVERY` (nothing physical has purged yet in the
overwhelmingly common case — quarantine is BEFORE any purge `Task` runs), the only way a
non-`ABORTED` terminal status happens at all is a genuinely unusual race (deadline firing and
`StopExecution` landing within the same window), which the alarm surfaces for a human to resolve
with full information rather than the sweeper guessing.

## Fix 2 — `ReminderOccurrence` purge deadline: DynamoDB-native TTL, stamped on every terminal transition, not only cancellation

Two corrections, both accepted without argument:

1. **Mechanism corrected to match the actual cited precedent**: `purgeAfterTtl` (epoch-seconds
   number, DynamoDB-native TTL attribute — `invitation-token.ts`), not an ISO string scanned by a
   worker. `ReminderOccurrence` gets the same kind of attribute, same mechanism, DynamoDB deletes it
   natively — no new worker/discovery code, no scan, no join, ever (stronger fix than Round 6's,
   which left "scans/queries by purgeAfter" undecided; this closes it by reusing the exact existing
   mechanism, not a variant of it).
2. **Stamped on every terminal transition, not only the cancellation path**: Codex correctly found
   `cancelAllOccurrences()` only touches `SCHEDULED`/`CLAIMED` occurrences — `DELIVERED`/`FAILED`
   occurrences (the majority of an occurrence's real lifetime outcomes, reached by other code paths
   entirely, e.g. successful delivery) never pass through that function and would stay
   TTL-less/undiscoverable under a narrower fix. Corrected: `purgeAfterTtl` is stamped by
   `ReminderMaterializer` at EVERY point an occurrence reaches a terminal status
   (`CANCELLED`/`DELIVERED`/`FAILED`) — not centralized in one cancellation-only function, one line
   added at each of the existing terminal-status write sites (already a small, enumerable set in
   `reminder-materializer.ts`). No occurrence can reach a terminal state without also gaining a
   purge deadline.

## Estado final

Ambos os itens fechados eliminando a ambiguidade em vez de argumentar contra ela: restauração
exige uma conjunção estrita de 3 condições, tudo mais vira alarme (fail-closed, não "provavelmente
seguro"); TTL nativo do DynamoDB reaproveitado exatamente como o precedente citado, carimbado em
todo ponto de transição terminal, não só cancelamento.
