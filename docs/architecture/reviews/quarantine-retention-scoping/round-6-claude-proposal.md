# Quarantine/Recovery Window + LGPD Retention Gaps — Round 6 (Claude proposal, reconciliation)

Round 5 scored 8.7/10. 2 items remain, both closed here with the exact corrections Codex named.

## Fix 1 — Reconciliation protocol reordered and made conservative about `SUCCEEDED`

Three concrete errors corrected:

1. **Ordering**: `cancellationRequested` is written as its OWN durable-intent write, BEFORE
   `StopExecution` is called — not bundled into the restore transaction (Round 5's actual bug:
   writing it together with the restore attempt implied restoring `ACTIVE` before confirming the
   execution stopped, exactly the danger every prior round has guarded against). Corrected sequence:
   `(1) write cancellationRequested=true (durable intent, no status change) → (2) StopExecution →
   (3) OCC-restore HELD_FOR_RECOVERY→ACTIVE`. If the process crashes between any of these steps, the
   sweeper (fix below) picks up from durable intent alone — it never needs step 3 to have run to
   know a cancellation was in flight.
2. **Discovery mechanism corrected**: the existing `tenant-purge-sweeper` discovers records via a
   full table `Scan` (not a GSI, as Round 5 wrongly claimed) — `cancellationRequested` is simply an
   additional filter predicate on that same existing `Scan`, no new index needed. Restated
   accurately instead of inventing an index that doesn't exist.
3. **`SUCCEEDED` is never treated as safe to restore from** — this is the real safety fix. The
   sweeper only restores `ACTIVE` when `DescribeExecution` reports `ABORTED` specifically (the
   deterministic result of a successful `StopExecution`). If the execution instead reports
   `SUCCEEDED`, that means the purge workflow completed before the stop landed — the sweeper does
   **not** restore `ACTIVE` (doing so would resurrect a tenant whose data may already be physically
   gone, corrupting the invariant far worse than staying stuck). Instead it raises an existing-class
   alarm (same `AWS/States` alarm pattern from D-124) for operator investigation — a genuinely rare
   race (`StopExecution` landing in the same window as natural completion), explicitly a fail-safe,
   not fail-silent, outcome. Every other terminal execution status
   (`FAILED`/`TIMED_OUT`/nonexistent) is treated the same as `ABORTED` — none of those states could
   have performed an irreversible purge, so restoring `ACTIVE` is safe.

## Fix 2 — `ReminderOccurrence` purge gets its own durable pointer, no join/ordering race

Corrected: the SAME event handler that reacts to `expiration.item-deactivated.v1` and cancels
`ReminderOccurrence` records (`ReminderMaterializer.cancelAllOccurrences()`) is extended, in this
design, to also stamp a `purgeAfter` field (ISO timestamp, `now + 30d`) directly onto each
`ReminderOccurrence` record at the moment it's cancelled — durable on the occurrence itself, not
derived later by joining against the parent. The occurrence-purge worker then scans/queries by
`purgeAfter` directly (same shape as any other TTL-driven purge worker in this codebase, e.g.
`InvitationTokenPointer`'s `purgeAfterTtl`) — **no dependency on the parent `ExpirationItem` still
existing**, closing the race Codex found (parent physically removed by the item-purge worker before
the occurrence-purge worker runs). The two workers become fully independent, ordering-agnostic —
either can run before or after the other with no correctness impact.

## Estado final

Ambos os itens da Rodada 5 fechados removendo, não reforçando, a fonte da insegurança apontada
(ordem incorreta de escrita, alarme explícito em vez de restauração otimista sob `SUCCEEDED`,
ponteiro durável em vez de join tardio). Nenhuma decisão anterior reaberta.
