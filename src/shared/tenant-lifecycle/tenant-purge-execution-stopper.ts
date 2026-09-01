/**
 * D-127 (quarantine/recovery window) — narrow port for stopping a tenant-purge Step Functions
 * execution deterministically by ARN. Used ONLY by `CancelOrganizationClosureService`: `stop`
 * MUST be called and MUST succeed (or be confirmed idempotent) BEFORE any data-restoration write
 * — never restore-then-stop, which would race the execution's own next transition (see that
 * service's file header for the full ordering argument).
 *
 * `ExecutionDoesNotExist` (the execution already finished/never existed) is swallowed and
 * reported as `{ stopped: true }` — idempotent by the same reasoning `TenantPurgeExecutionStarter`
 * swallows `ExecutionAlreadyExists`: a retry of a cancel request (or a sweeper repair of a crashed
 * first attempt) must not fail just because the first attempt's `StopExecution` already landed.
 */
export interface TenantPurgeExecutionStopper {
  stopExecution(input: { executionArn: string }): Promise<{ stopped: true }>;
}
