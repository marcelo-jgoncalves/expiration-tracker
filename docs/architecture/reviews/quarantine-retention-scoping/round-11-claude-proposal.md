# Quarantine/Recovery Window + LGPD Retention Gaps — Round 11 (Claude proposal, mechanical enforcement)

Round 10 correctly distinguished "helper exists" from "helper is the only path" — closing that gap
with actual mechanical enforcement, matching the `occ.ts` precedent exactly instead of analogizing
to it loosely.

## Fix — ESLint rule forbidding the literal pattern outside the one file allowed to write it

Same enforcement CLASS this codebase already uses (`AGENTS.md` §7: `no-console` is a real ESLint
error outside `src/shared/observability/**`, mechanically, not by convention) — added here for this
transition specifically:

**New ESLint rule** (`.eslintrc`/flat config, scoped via `overrides`/per-directory `files` glob,
same mechanism `no-console`'s carve-out already uses): `no-restricted-syntax` forbidding an object
literal property `status: "CANCELLED"` (AST pattern: `Property[key.name='status'][value.value=
'CANCELLED']`) in any file under `src/modules/reminder/**` and `src/workers/**` EXCEPT
`src/modules/reminder/domain/reminder-occurrence.ts` itself (where `cancelOccurrenceUpdate()` lives
and is allowed to construct the literal). This makes the 5 known call sites (and any future one) a
**lint failure**, not a convention — `npm run lint` (already part of the mandatory command set,
`AGENTS.md` §7, already gates CI) catches a direct `set: { status: "CANCELLED" }` anywhere else in
the tree, including one nobody manually found in 4 rounds of enumeration.

This closes Codex's exact objection: the guarantee no longer depends on "was every existing site
found" — it depends on `npm run lint` passing, which by construction cannot pass with a bypass
anywhere in the linted tree. The migration of the 5 known sites (implementation session) is still
needed, but the ESLint rule is what proves completeness afterward — a 6th undiscovered site becomes
a lint CI failure the moment `npm run lint` runs against it, not a silent gap discovered in a future
round 12.

## Estado final

Última objeção do Codex (Rodada 10) fechada com um mecanismo real de imposição, não uma convenção —
mesmo padrão de enforcement (`no-console`/`no-restricted-syntax` escopado) já em uso neste
repositório, verificável por `npm run lint` já hoje no CI. Nenhuma decisão anterior reaberta.
