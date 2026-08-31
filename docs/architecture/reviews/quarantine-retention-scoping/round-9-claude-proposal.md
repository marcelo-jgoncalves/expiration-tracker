# Quarantine/Recovery Window + LGPD Retention Gaps — Round 9 (Claude proposal, reconciliation)

Round 8 scored 8.9/10 — 1 missed writer site, added.

## Fix — 4th `CANCELLED` writer added: `cancelStaleOccurrences()`

Confirmed by Codex's direct read: `cancelStaleOccurrences()` (`reminder-materializer.ts`) has its
own independent `buildVersionedUpdate({ set: { status: "CANCELLED" } })`, not routed through
`cancelOccurrencesFencedByPolicy()` as Round 8 assumed. Corrected inventory — **4 real `CANCELLED`
writers, all 4 stamp `purgeAfterTtl` in the same existing `set` clause**:

1. `cancelStaleOccurrences()` (`reminder-materializer.ts`) — added this round.
2. `cancelOccurrencesFencedByPolicy()` (`reminder-materializer.ts`).
3. `cancelAllOccurrences()` (`reminder-materializer.ts`).
4. The freshness-fence conditional cancel (`reminder-dispatch/dispatch.ts` line 108).

`TRIGGERED` (1 writer, not retention-terminal) and `ACKED` (no current writer, standing constraint
on any future one) unchanged from Round 8 — Codex confirmed both accurate.

## Estado final

Inventário agora cobre os 4 sites reais de escrita de `CANCELLED` confirmados por leitura direta do
Codex nesta própria rodada — não reconstruído de memória. Nenhum outro item em aberto.
