# Quarantine/Recovery Window + LGPD Retention Gaps — Round 10 (Claude proposal, structural fix)

Rounds 6-9 kept the same weighted score (87/100) while 3 successive rounds each found one more
hand-enumerated `CANCELLED` writer site (3→4→5). That pattern itself is the real finding: **manual
enumeration of scattered call sites is not a reliable design for a retention guarantee** — this
round replaces the approach instead of continuing to hand-count.

## Structural fix — stop enumerating writers; make the guarantee inseparable from the enum value

Instead of requiring every present-and-future `CANCELLED`-writing call site (3 confirmed in
`reminder-materializer.ts`, 1 in `reminder-dispatch/dispatch.ts`, 1 in
`reminder-reconciliation/reconciliation.ts` — 5 found across 4 rounds, an already-demonstrated
error-prone approach) to remember to stamp `purgeAfterTtl` correctly and forever, this round moves
the guarantee to a single, structurally-enforced choke point:

**A single shared helper, `cancelOccurrenceUpdate(occurrence, tenantId)`, in
`reminder-occurrence.ts`** (domain layer, not application — same layer `tenantLifecycleKey()` and
similar key/update builders already live in for other entities), returning the
`buildVersionedUpdate(...)` shape (`set: { status: "CANCELLED", purgeAfterTtl: nowEpochSeconds() +
2592000 }`, same `remove: [...]` GSI-pointer clearing already done today) — **every one of the 5
known call sites, and any future one, is required to call this helper instead of constructing its
own inline `set: { status: "CANCELLED" }`.** This is enforceable exactly the same way this codebase
already enforces "no raw `UpdateItem`/`PutItem`" (`AGENTS.md` §7: "toda escrita mutável usa os
builders de `src/shared/dynamodb/occ.ts`") — a code-review/lint-level invariant, not a memorized
list. The 5 existing call sites are migrated to call it in the implementation session (small,
mechanical diff — replace each inline `set: { status: "CANCELLED" }` with a call to the shared
helper); no call site needs to be "found" again by a future reviewer, because there is exactly one
place `purgeAfterTtl` is ever written for this transition.

This removes the actual failure mode 3 rounds demonstrated (a human/reviewer enumerating scattered
sites by memory/grep and missing one) rather than trying to enumerate more carefully a 4th time.

## `TRIGGERED`/`ACKED` — unchanged, already confirmed accurate 3 rounds running

No change: `TRIGGERED` (1 writer, `reminder-dispatch/dispatch.ts`) stays non-retention-terminal by
explicit decision; `ACKED` (0 writers today) keeps the standing constraint on any future writer.
Both confirmed accurate by Codex across Rounds 8 and 9 without objection — not reopened.

## Estado final

O padrão de 3 rodadas encontrando mais um site cada vez era ele mesmo o achado real: a lista
manual não escala. A correção estrutural (um único helper compartilhado, migração mecânica dos 5
sites conhecidos) elimina a classe de erro em vez de tentar enumerar uma vez a mais — consistente
com o próprio padrão já usado neste repositório para builders de escrita mutável (`AGENTS.md` §7).
