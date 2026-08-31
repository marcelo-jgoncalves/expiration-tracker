# W3-07 Purge Orchestrator — Round 3 (Claude proposal, addressing Codex Round 2: 8,2/10)

Round 2 closed all 5 Round 1 blockers but introduced/left 2 new ones. Fixes below. Per `AGENTS.md`
§4 this is the mandatory 3rd round regardless of score trajectory.

## Fix 6 (Codex finding 1, Round 2) — purge Task never returns the raw, potentially-unbounded
`TenantPurgeResult` to Step Functions

Verified: `TenantPurgeResult.s3` is `S3TenantPurgeResult[]`, and each entry's `unresolvedErrors:
S3DeleteError[]` is genuinely unbounded (one entry per failed `DeleteObjects` call, `{key,
versionId, code, message}` each) — a large tenant with many S3 delete failures could exceed Step
Functions' 256 KiB (262,144 bytes) task/state input-output quota (confirmed, `docs.aws.amazon.com/
step-functions/latest/dg/service-quotas.md`, "Maximum input or output size for a task, state, or
execution: 256 KiB"). `TenantPurgeCheckpoint` itself (re-verified, `purge-tenant.ts` lines 65-72) is
NOT the risk — it only carries pagination markers (`dynamoStartAfter`/`sessionTableStartAfter`,
small DynamoDB `LastEvaluatedKey` shapes, plus per-S3-target string markers), bounded regardless of
tenant size.

**Fix**: the purge Lambda handler (the thin wrapper the `RunPurge` Task invokes around
`purgeTenant()`) returns to Step Functions a projected, always-small envelope — never the raw
result:

```text
{
  status: TenantPurgeStatus,
  checkpoint: TenantPurgeCheckpoint | undefined,   // unchanged, already bounded
  counters: {
    s3UnresolvedCount: number,        // result.s3.reduce(sum of unresolvedErrors.length)
    dynamoRejectedCount: number,      // already-existing itemsRejectedBySafetyCondition
    sessionRejectedCount: number,     // already-existing sessionsRejectedBySafetyCondition
  },
  failure: result.failure,            // already small (stage + one message string)
}
```

The FULL `TenantPurgeResult` (including every `unresolvedErrors` entry) is still logged in full via
structured logging (`SecureLogger`, `AGENTS.md` §7 — every handler already does this, no new
mechanism) — nothing is lost, it just never round-trips through Step Functions state
input/output, which was never meant to carry unbounded diagnostic detail in the first place. The
`Choice` state (Fix 2, Round 2) reads `$.status`/`$.counters.*`/`$.checkpoint` exactly as before —
no change to the control-flow logic itself, only to what crosses the ASL boundary.

## Fix 7 (Codex finding 2, Round 2) — no free alarm reuse; explicit new CloudWatch alarm required

Verified by reading `infra/modules/extraction-workflow/`: it wires the state machine, a log group,
and X-Ray tracing — **no `aws_cloudwatch_metric_alarm`** on `AWS/States`
`ExecutionsFailed`/`ExecutionsTimedOut` exists there or anywhere else in `infra/` for a Step
Functions state machine specifically (existing alarms are all Lambda/SQS/security/import/document-
specific). Round 2's "reused, not invented" claim was wrong.

**Fix**: this rodada's mechanism-level design now explicitly includes, as a required part of a
future implementation (not built this rodada, same as everything else): a new
`aws_cloudwatch_metric_alarm` on the new state machine's `ExecutionsFailed` and `ExecutionsTimedOut`
metrics — confirmed real metric names in the `AWS/States` namespace, filterable by `StateMachineArn`
dimension (`docs.aws.amazon.com/step-functions/latest/dg/procedure-cw-metrics.html`, cross-checked
2026-08-30), wired to the same alert SNS topic every other alarm in this project already uses
(`AGENTS.md` §7) — named explicitly here so it is not silently forgotten when implementation
starts, exactly the same discipline D-116 (GSI4 IAM) was a lesson about (a mechanism "should exist"
is not the same as it existing).

## Fix 8 (non-blocking findings, Round 2) — incorporated

- **`CloseOrganizationService` step ordering corrected**: Fix 1's step 3 ("call StartExecution
  unconditionally... whether status was already DELETING+") wrongly implied any post-`ACTIVE`
  status triggers a fresh `StartExecution` call. Corrected: step 4 (terminal-state check) now runs
  **before** step 3, not after — `VERIFIED`/`DELETED`/`BLOCKED`/`HELD` return their own domain
  error immediately; only `DELETING`/`QUIESCING`/`PURGING` (the genuinely in-flight, still-being-
  driven-by-this-workflow states) fall through to the unconditional `StartExecution` retry call.
- **`retryCount` bound named as a constant, not a bare literal**: `PURGE_RETRY_LIMIT = 20` (still
  the same value — Codex accepted it as "acceptable as a default", the finding was about it being
  an inline magic number, not about the number itself) — declared once, referenced by the ASL
  `Choice` condition, with a code comment naming it as a deliberately-conservative default subject
  to revision once real tenant-size data exists (no real tenant has been purged in production yet
  to derive a data-driven number from — same proportionality this project already applies
  elsewhere, e.g. `enable_reserved_concurrency`'s account-quota-driven placeholder).
- **Minimum IAM surface enumerated explicitly** (Codex Round 2 finding 7 — implementation detail
  deferred, but the SURFACE must be named now so a future session doesn't have to re-derive it):
  ```text
  - CloseOrganizationService's execution role: states:StartExecution on the new state machine's
    ARN only (not states:* or a wildcard resource).
  - The state machine's own execution role: lambda:InvokeFunction on exactly the transition
    handler and the purge worker handler (2 ARNs, not a wildcard).
  - The transition handler's role: read/write access to TenantLifecycleRecord only — same
    tenant_facing_read_write_policy_json already granted to every other handler touching this
    table (no new policy needed, D-068 already put this record in the main table).
  - The purge worker handler's role: exactly what purgeTenant()'s real dependencies already need
    (main table read/delete, bff-session-table read/delete, the S3 buckets from
    TenantS3Target[] - list/delete/abort-multipart) - no new capability class, this Lambda's
    role is a strict subset of what test/unit/workers/tenant-purge/*.ts already exercises against
    fakes.
  - The sweeper's role: states:StartExecution (same ARN as above) + read-only Scan on the main
    table filtered to SK=LIFECYCLE.
  ```

## Updated checklist self-assessment (final)

```text
1. (30%) Full problem shape covered, INCLUDING the 2 gaps this round closes (payload-size-safe
   Task output; a real alarm, not an assumed one). SATISFIED.
2. (25%) Reuses existing precedent, no third mechanism; the new alarm is the same PATTERN every
   other alarm in this project already uses (SNS topic, metric+dimension), not a new alarming
   mechanism. SATISFIED.
3. (20%) No D-066/D-067/D-081-083 parameter reopened. SATISFIED.
4. (15%) StartExecution idempotency + durable sweeper-based repair, now with corrected step
   ordering (terminal-state check before the unconditional retry call). SATISFIED.
5. (10%) CloseOrganizationService's contract, retry bound, and now the minimum IAM surface are all
   named explicitly, even though none of it is coded this rodada. SATISFIED.
```
