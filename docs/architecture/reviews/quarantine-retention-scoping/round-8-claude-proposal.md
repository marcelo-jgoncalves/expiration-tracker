# Quarantine/Recovery Window + LGPD Retention Gaps — Round 8 (Claude proposal, reconciliation)

Round 7 scored 8.9/10 — 1 item left, precisely named by Codex. Fixed with the real inventory.

## Fix — Real `ReminderOccurrenceStatus` inventory, real writer sites, explicit `ACKED` rule

Round 7's `DELIVERED`/`FAILED` invented statuses corrected to the real 3-value
`ReminderOccurrenceStatus` (`reminder-occurrence.ts`: `CANCELLED`/`TRIGGERED`/`ACKED`) and the real
writer sites, all confirmed by direct read this round:

- **`CANCELLED`** — 3 real writers: `reminder-materializer.ts`'s
  `cancelOccurrencesFencedByPolicy()` (backing both `cancelStaleOccurrences()` and
  `reconcilePolicyOccurrences()`) and `cancelAllOccurrences()`; `reminder-dispatch/dispatch.ts` line
  108 (the freshness-fence conditional cancel). All three already do a `buildVersionedUpdate` with
  `set: { status: "CANCELLED" }` — each gains one added field in that same `set`:
  `purgeAfterTtl: nowEpochSeconds + 2592000` (30d, same constant used elsewhere in this design).
- **`TRIGGERED`** — 1 real writer: `reminder-dispatch/dispatch.ts` line 164
  (`CLAIMED→TRIGGERED`). **Decided explicitly** (Codex's exact ask): `TRIGGERED` is NOT
  retention-terminal today — it is the state that leads to actual notification delivery
  (`NotificationIntent`/`NotificationAttempt`, `DELIVERY_RECORD` retention class, already tracked
  separately at 180 days) — the occurrence record itself remains referenced by that in-flight
  delivery attempt, so no `purgeAfterTtl` is stamped at this transition.
- **`ACKED`** — **no real writer exists in the codebase today** (confirmed absent by Codex's own
  read, matching this round's re-check) — `ACKED` is a defined status with no code path that
  reaches it yet. Explicit rule for when one is added: any future `ACKED` writer MUST stamp
  `purgeAfterTtl` in the same transaction, exactly like the 3 `CANCELLED` writers above — named here
  as a standing constraint on that future code, not silently assumed. Until such a writer exists,
  `ACKED` occurrences cannot occur, so there is no live gap today.

This makes the inventory exhaustive against the REAL 3-status enum and the REAL 4 writer call
sites (3 `CANCELLED` + 1 `TRIGGERED`, explicitly not stamped there) — no invented statuses, no
missed file.

## Estado final

Último item aberto fechado com o inventário real confirmado por leitura direta, não reconstruído de
memória — mesma disciplina que corrigiu os 2 erros factuais anteriores desta rodada (Round 3's
`src/shared/ids.ts` inexistente, Round 4's `RecurrenceOccurrence` inexistente). Nenhum novo problema
introduzido: os 3 escritores de `CANCELLED` ganham 1 campo cada na mesma escrita já existente;
`TRIGGERED` recebe uma decisão explícita de não ser terminal para fins de retenção; `ACKED` recebe
uma regra para quando/se um escritor futuro existir.
