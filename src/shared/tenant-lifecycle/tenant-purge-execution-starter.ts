/**
 * W3-07 purge orchestrator (D-124, implementing D-121's approved design).
 *
 * Narrow port for starting the tenant-purge Step Functions execution — lives under
 * `src/shared/tenant-lifecycle/` (not inside either consumer) because BOTH the organization
 * module's `CloseOrganizationService` and the purge sweeper worker start the same execution, and
 * `shared/**` must never import from `modules/**` (`.dependency-cruiser.cjs`).
 *
 * `name` was originally ALWAYS the bare `tenantId`; D-127 (quarantine/recovery window) changed
 * this to `${tenantId}-${closureAttemptId}` so a second close-after-cancel never collides with
 * the (by then stopped) execution name of a prior attempt — see `tenant-lifecycle-record.ts`'s
 * `closureAttemptId` field doc. Name-based idempotency is still the whole mechanism: Step
 * Functions treats execution names as unique per state machine (while RUNNING), so a duplicate
 * launch of the SAME attempt is rejected by AWS itself rather than starting a second concurrent
 * purge. Implementations MUST therefore swallow `ExecutionAlreadyExists` as the expected
 * "already launched" outcome and never rethrow it — every caller in this design calls
 * `startExecution` unconditionally on every invocation (the `start-extraction-run.ts` idiom), so
 * treating that error as a failure would turn the normal case into an error path.
 *
 * D-127: returns `{ executionArn }` (previously `void`) — `CloseOrganizationService` persists it
 * on the lifecycle record (`attachTenantPurgeExecutionArn`) so `CancelOrganizationClosureService`
 * can later call `StopExecution` deterministically by ARN. On the (expected) `ExecutionAlreadyExists`
 * path the ARN is still resolvable (Step Functions' own naming convention:
 * `<stateMachineArn-with-":states:" account/region>:execution:<name>` is NOT assumed here —
 * implementations re-derive it via `DescribeExecution`/the SDK's own error payload rather than
 * string-building it, see `SfnTenantPurgeExecutionStarter`).
 */
export interface TenantPurgeExecutionStarter {
  startExecution(input: { name: string; input: { tenantId: string } }): Promise<{ executionArn: string }>;
}
