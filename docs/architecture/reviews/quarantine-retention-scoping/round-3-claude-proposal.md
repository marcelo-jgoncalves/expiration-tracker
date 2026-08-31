# Quarantine/Recovery Window + LGPD Retention Gaps — Round 3 (Claude proposal, reconciliation)

Round 2 scored 7.3/10 — real progress (5.5→7.3) but Codex correctly flagged the `executionArn`
persistence race as still-open, the RBAC/no-RequestContext contradiction, missing legal-hold
interaction, retry idempotency (new UUID per retry vs. per attempt), an ASL modeling error, and a
LGPD backlog with real omissions/an incorrect semantic claim. Fixing all of these, not just the
labeled ones.

## Fix 1 — `executionArn` persistence race (Codex's "most important remaining gap")

Solved by removing the race entirely, not by hardening the write: **Step Functions execution ARNs
are deterministic** — `arn:aws:states:{region}:{account}:execution:{stateMachineName}:{executionName}`.
Since `executionName = ${tenantId}-${closureAttemptId}` is already chosen by the caller BEFORE
`StartExecution` runs (fix 3 below fixes when it's chosen), the ARN needs no read-back and no
separate persistence step — the cancellation path (and the composition root generally) computes it
from `(stateMachineArn, tenantId, closureAttemptId)`, all of which are already persisted on
`TenantLifecycleRecord` at the moment `HELD_FOR_RECOVERY` is written, in the SAME
`TransactWriteItems` as the status transition. No `executionArn` field needed at all — it is a pure
function of already-persisted data, so it is removed from the persisted schema (was a real
complexity Codex correctly flagged; the right fix is deleting it, not defending it).

## Fix 2 — Retry idempotency: `closureAttemptId` generated once per attempt, not per call

`closureAttemptId` is generated **only** on the `ACTIVE → HELD_FOR_RECOVERY` transition itself (one
UUID, written in that transaction). Every subsequent call to `close()` while already
`HELD_FOR_RECOVERY` (retry, double-click) reads the EXISTING `closureAttemptId`/`recoveryDeadline`
off the record and reuses them for the (idempotent, name-derived) `StartExecution` call — never
generates a new one. This is the same idiom `close-organization.ts` already uses for the
`ACTIVE`-only branch (`transitioned=false` path calling the shared launch with the existing name) —
extended, not invented. Execution name length: `tenantId` in this system is `org_${ulid()}` (`src/runtime/aws/ids.ts`,
`newOrganizationId`) = 4 + 26 = 30 chars; `closureAttemptId` as a UUID v4 = 36 chars; concatenated
with a `-` separator = 67 chars, inside Step Functions' 80-character execution name limit —
verified against the actual ID format, not assumed (Round 2 cited a nonexistent `src/shared/ids.ts`
and asserted "16-64 chars" without checking; corrected here after actually reading the real file).

## Fix 3 — Dedicated authorization primitive for the no-RequestContext cancel path

Codex is right that `organization:cancel-close` in `ACTION_ROLES` is dead code if the cancel path
never builds a `RequestContext` to call `authorize()` with. Fix: **no generic `Action` union entry**
— the cancel path uses a new, narrow, dedicated function
`authorizeCancelClosure(membership: Membership): void` (co-located with `authorization.ts`, not
inside it) that throws the SAME `AuthorizationDeniedError` type and emits the SAME
`security-audit.ts` denial-event shape (`action: "organization:cancel-close"` as a literal string
tag in the event payload, not a member of the `Action` union — the taxonomy in `security-audit.ts`
already accepts arbitrary action strings for audit purposes, only `authorize()`'s `ACTION_ROLES`
matrix requires the union) if `membership.role !== "OWNER" || membership.status !== "ACTIVE"`. This
is named explicitly as a deliberate, audited exception to the normal `authorize()` path — not a
second RBAC system — because the entire premise of this cancel path is operating on a tenant that
cannot resolve a normal `RequestContext` in the first place.

## Fix 4 — Legal hold / `BLOCKED` interaction during the quarantine window

Named explicitly (was silently absent in Round 2): `HELD_FOR_RECOVERY → BLOCKED` is added as a
legal transition (`blockedFrom: "HELD_FOR_RECOVERY"`), triggered the same way `DELETING`&co. already
enter `BLOCKED` today (operator action / a purge-adjacent error — during quarantine specifically,
this is realistically only a manual legal hold, since no purge work runs yet). Remediation from
`BLOCKED` returns to `blockedFrom` (existing pattern, unchanged) — i.e., back to
`HELD_FOR_RECOVERY`, resuming the SAME `recoveryDeadline`/`closureAttemptId` (not restarting the
clock; a legal hold pauses enforcement, it does not reset the countdown, consistent with
`privacy-lgpd.md` §3's "hold suspends purge, never cancels it permanently without review").
Cancellation is unavailable while `BLOCKED` (already covered by
`CLOSURE_UNAVAILABLE_STATUSES` unchanged from Round 1/2).

**Metadata retention on cancel**: `recoveryDeadline`/`closureAttemptId` are never cleared on
`HELD_FOR_RECOVERY → ACTIVE` — retained on the record as an audit trail of the last closure attempt
(read-only once the status moves off `HELD_FOR_RECOVERY`); the NEXT close() attempt overwrites them
with a fresh value on the next `ACTIVE → HELD_FOR_RECOVERY` transition. No separate cleanup step.

## Fix 5 — ASL modeling error: `Choice` cannot read DynamoDB

Codex is correct — a `Choice` state evaluates its own input, it cannot query DynamoDB. Corrected
shape: `Wait(30d) → Task(ReadTenantLifecycleRecord, ConsistentRead) → Choice(status ==
"HELD_FOR_RECOVERY"?) → [true: Task(TransitionToDeleting) → existing Wait(1800s)+purge chain] /
[false: Succeed("cancelled-or-already-progressed")]`. One new Lambda (`ReadTenantLifecycleRecord`,
thin wrapper over the same reader interface `CloseOrganizationService` already uses) — named
explicitly as new infra surface for the future implementation session, not glossed over as "just a
Choice".

## Fix 6 — LGPD backlog: correcting the real omissions

Codex found real gaps, accepted without argument:

- **`USER_DOCUMENT`/`EXTRACTION_TRANSIENT`/`InvitationTokenPointer` (TRANSIENT)** were omitted from
  the backlog because they already have real physical purge (W3-06, M7 lifecycle, `invitation-
  token.ts`) — should have been listed explicitly as **"already implemented, zero backlog work"**
  rather than silently absent (a reader diffing this list against `privacy-lgpd.md`'s 9 classes
  would reasonably read the omission as an oversight, not a decision).
- **`CORE_USER_DATA`** scope corrected to match the matrix definition exactly ("itens, políticas,
  ocorrências" — `privacy-lgpd.md` line 38): includes policies, not just items/occurrences.
- **Semantic error corrected**: the matrix's event for `CORE_USER_DATA` is "exclusão/encerramento",
  not "vencimento" — an item's due date passing is NOT a deletion trigger (items past due stay
  fully live in this product, that's the entire point of an expiration tracker). The real gap is:
  when a user/service **explicitly deletes** an `ExpirationItem` (soft-delete already exists per
  the domain model), nothing purges the underlying record 30 days later. Backlog item #1 restated
  correctly: worker that scans soft-deleted `ExpirationItem`/policy records past `deletedAt + 30d`.

**Corrected executable-lane backlog** (same 6 slots, semantics fixed):
1. `CORE_USER_DATA` — soft-deleted `ExpirationItem`/policy records, `deletedAt + 30d` (corrected
   trigger event).
2. `DELIVERY_RECORD` — `createdAt + 180d`, unchanged from Round 2.
3. `SECURITY_AUDIT` — `createdAt + 365d`, unchanged.
4. `QUOTA_TELEMETRY` — window-end + 30d, unchanged.
5. `ACCOUNT_ACTIVE` (non-closure case) — `Invitation` expired/revoked, then removed `Membership`,
   then `Channel` (unchanged ordering, still the most ambiguous sub-case).
6. `TRANSIENT` remainder (`WebhookInbox`, `UploadSlot`) — unchanged, lowest exposure.

**Already done, explicitly not backlog** (the correction itself): `USER_DOCUMENT`,
`EXTRACTION_TRANSIENT`, `InvitationTokenPointer`/`TRANSIENT`'s token-pointer slice.

**Blocked lane** (unchanged from Round 2): `LEGAL_EVIDENCE`, gated on legal approval + independent
KMS + Object Lock, not part of the linear order.

## Estado desta rodada

Escopo de implementação permanece **design-only** (Round 2's correction stands, Codex confirmed it
as fixed) — a lista de trabalho futuro cresceu (novo Lambda de leitura, primitive de autorização
dedicado, transição `BLOCKED` nova, backlog LGPD corrigido), reforçando, não enfraquecendo, essa
decisão.
