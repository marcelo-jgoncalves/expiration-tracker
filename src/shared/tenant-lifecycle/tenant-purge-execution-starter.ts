/**
 * W3-07 purge orchestrator (D-124, implementing D-121's approved design).
 *
 * Narrow port for starting the tenant-purge Step Functions execution — lives under
 * `src/shared/tenant-lifecycle/` (not inside either consumer) because BOTH the organization
 * module's `CloseOrganizationService` and the purge sweeper worker start the same execution, and
 * `shared/**` must never import from `modules/**` (`.dependency-cruiser.cjs`).
 *
 * `name` is ALWAYS the `tenantId`. That is the whole idempotency mechanism the approved design
 * rests on: Step Functions treats execution names as unique per state machine, so a duplicate
 * launch of the same tenant's purge is rejected by AWS itself rather than starting a second
 * concurrent purge. Implementations MUST therefore swallow `ExecutionAlreadyExists` as the
 * expected "already launched" outcome and never rethrow it — every caller in this design calls
 * `startExecution` unconditionally on every invocation (the `start-extraction-run.ts` idiom), so
 * treating that error as a failure would turn the normal case into an error path.
 */
export interface TenantPurgeExecutionStarter {
  startExecution(input: { name: string; input: { tenantId: string } }): Promise<void>;
}
