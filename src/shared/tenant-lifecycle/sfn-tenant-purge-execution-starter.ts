/**
 * Real AWS Step Functions adapter for `TenantPurgeExecutionStarter` (W3-07/D-124). Structural twin
 * of `modules/extraction/persistence/sfn-extraction-execution-starter.ts`; it lives under
 * `src/shared/` rather than a module's `persistence/` because both a module
 * (`CloseOrganizationService`) and a worker (the sweeper) start this same execution, and
 * `shared/**` must never import from `modules/**`.
 *
 * `ExecutionAlreadyExists` is swallowed, never rethrown — see the port's doc comment. Every caller
 * in this design calls `startExecution` unconditionally on every invocation, so this error IS the
 * expected steady-state outcome for a tenant whose purge is already running, not a failure.
 */
import { SFNClient, StartExecutionCommand, ExecutionAlreadyExists } from "@aws-sdk/client-sfn";
import type { TenantPurgeExecutionStarter } from "./tenant-purge-execution-starter.js";

export class SfnTenantPurgeExecutionStarter implements TenantPurgeExecutionStarter {
  constructor(
    private readonly client: SFNClient,
    private readonly stateMachineArn: string,
  ) {}

  async startExecution(input: { name: string; input: { tenantId: string } }): Promise<void> {
    try {
      await this.client.send(
        new StartExecutionCommand({
          stateMachineArn: this.stateMachineArn,
          name: input.name,
          input: JSON.stringify(input.input),
        }),
      );
    } catch (err) {
      if (err instanceof ExecutionAlreadyExists) return;
      throw err;
    }
  }
}
