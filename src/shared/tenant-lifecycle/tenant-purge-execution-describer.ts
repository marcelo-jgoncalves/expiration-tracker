/**
 * D-127 (quarantine/recovery window) — narrow port for reading a tenant-purge Step Functions
 * execution's terminal/live status by ARN. Used ONLY by the sweeper's `HELD_FOR_RECOVERY`
 * reconciliation branch (`tenant-purge-sweep.ts`): a strict conjunction of this status, the
 * execution's own name, and the current lifecycle record decides whether a stalled cancellation
 * can be safely completed — see that file for the full "never restore under ambiguity" logic.
 */
export type TenantPurgeExecutionStatus = "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "ABORTED" | "NOT_FOUND";

export interface TenantPurgeExecutionDescription {
  status: TenantPurgeExecutionStatus;
  /** The execution's own name (NOT its ARN) — Step Functions names are always the last ARN
   * segment, but callers use this field rather than re-parsing the ARN themselves. */
  name: string;
}

export interface TenantPurgeExecutionDescriber {
  describeExecution(input: { executionArn: string }): Promise<TenantPurgeExecutionDescription>;
}
