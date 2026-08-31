# Quarantine/Recovery Window + LGPD Retention Gaps — Round 4 (Claude proposal, reconciliation)

Round 3 scored 8.5/10. 4 concrete gaps remain, all fixed here — no new ground, closing what's open.

## Fix 1 — Compensation when `StopExecution` succeeds but the OCC transition back to `ACTIVE` fails for a reason other than legitimate `DELETING` progress

Named explicitly (Round 3 left it implicit): if `StopExecution` succeeds and the subsequent
`transitionTenantLifecycle(HELD_FOR_RECOVERY → ACTIVE)` fails with `SystemMutationConflictError`,
the service re-reads the record once (same idiom `CloseOrganizationService.close()` already uses
for its own race, `close-organization.ts` lines 91-98):
- If the re-read shows `DELETING`+ — the deadline legitimately won the race before `StopExecution`
  landed; return "too late, closure already proceeding" (not an error — a correct outcome).
- If the re-read shows `HELD_FOR_RECOVERY` still, with the SAME `closureAttemptId` — a transient
  write conflict (e.g. concurrent cancel calls); retry the transition once more with the fresh
  `expectedVersion`, since the execution is already confirmed stopped and idempotent to re-stop.
- Any other status (`BLOCKED`, `HELD`) — genuinely unexpected; fail loudly, do not silently report
  success. This closes the one path Round 3 left as "the execution stays alive with no owner" —
  after `StopExecution` succeeds, the execution is never alive; the only question is which status
  the record lands on, and every branch above is accounted for.

## Fix 2 — Legal hold uses `HELD`, not `BLOCKED` (Round 3 mismodeled this)

Corrected: `HELD_FOR_RECOVERY → HELD` (not `BLOCKED`) for a manual legal hold during quarantine —
`blockedReason: "LEGAL_HOLD"`, `blockedFrom: "HELD_FOR_RECOVERY"`, consistent with the pre-existing
distinction already coded (`HELD` = legal hold, `BLOCKED` = operational failure — Round 3 conflated
them). `HELD_FOR_RECOVERY → BLOCKED` is reserved for a genuine operational failure during quarantine
(there is realistically none today, since no purge work runs during `HELD_FOR_RECOVERY` — this
transition is named for completeness/future-proofing, not because a concrete trigger exists yet).

**Behavior on releasing a legal hold past `recoveryDeadline`** (Round 3 left this an implicit
consequence of "the clock keeps running" — made an explicit decision here): remediation from `HELD`
back to `HELD_FOR_RECOVERY` re-evaluates the deadline immediately — if `recoveryDeadline` has
already passed while held, the very next sweeper/execution tick proceeds straight to `DELETING`
(the hold suspended enforcement, it did not extend the window — consistent with `privacy-lgpd.md`
§3's "hold suspende o purge, nunca o cancela permanentemente"). If the OWNER wants more recovery
time after a long hold, that is a future decision this rodada does not need to solve (no product
requirement raised it) — noted as an open question for the future implementation session, not
silently assumed.

## Fix 3 — `authorizeCancelClosure` error/audit contract that actually compiles

Round 3's primitive threw `AuthorizationDeniedError` with `action: "organization:cancel-close"`,
which does not typecheck against `AuthorizationInput.action: Action`. Fix: a **dedicated error
type**, `ClosureCancellationDeniedError` (same family as `OrganizationClosureUnavailableError`
already in `app-error.ts`, not a reuse of `AuthorizationDeniedError`) — this is honest to what's
actually happening: this is not a call into the `authorize()`/`ACTION_ROLES` system at all, it's a
narrow guard outside that system, so it should not borrow that system's error shape. The HTTP
handler boundary that catches it maps it to 403, and logs a `security-audit.ts` event using the
taxonomy's existing free-form `reason`/`context` fields (already accept arbitrary strings for
context — confirmed by re-reading `security-audit.ts`'s existing denial-event shape) instead of
requiring an `Action` union member. `authorizeCancelClosure()` itself stays a pure function (throws
only) — the HTTP handler, not the primitive, is responsible for the audit-logging side effect, same
separation already used for `authorize()` today (callers own logging, not the checker).

## Fix 4 — `RecurrenceOccurrence` explicitly enumerated in the `CORE_USER_DATA` backlog

Round 3 said "itens, políticas, ocorrências" but only listed items/policies in the executable
backlog. Corrected: `RecurrenceOccurrence` records are NOT independently purged — they are owned by
and cascade-deleted with their parent `ExpirationItem`/policy in the SAME purge operation (already
true of the existing soft-delete cascade in this codebase, `expiration-service.ts`) — stated
explicitly, not left to be inferred, per Round 3's own request. No separate backlog line needed; the
`CORE_USER_DATA` backlog item is item+policy+their occurrences as one atomic worker, not three.

## Estado final

Nenhum novo gap introduzido pelos 4 fixes acima — todos resolvem exatamente o que a Rodada 3 deixou
aberto, sem reabrir nada já `FIXED` (ARN determinístico, retry idempotente, classificação in-flight,
fundamentação dos 30 dias, escopo design-only — todos confirmados `FIXED` na Rodada 3, preservados
sem alteração aqui).
