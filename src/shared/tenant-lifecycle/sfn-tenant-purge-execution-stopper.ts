/** Real AWS Step Functions adapter for `TenantPurgeExecutionStopper` (D-127). Structural twin of
 * `SfnTenantPurgeExecutionStarter` — lives under `src/shared/` for the same cross-module reason
 * (both `CancelOrganizationClosureService` and, transitively, the sweeper's reconciliation need
 * it, and `shared/**` must never import from `modules/**`). */
import { SFNClient, StopExecutionCommand, ExecutionDoesNotExist } from "@aws-sdk/client-sfn";
import type { TenantPurgeExecutionStopper } from "./tenant-purge-execution-stopper.js";

export class SfnTenantPurgeExecutionStopper implements TenantPurgeExecutionStopper {
  constructor(private readonly client: SFNClient) {}

  async stopExecution(input: { executionArn: string }): Promise<{ stopped: true }> {
    try {
      await this.client.send(new StopExecutionCommand({ executionArn: input.executionArn }));
      return { stopped: true };
    } catch (err) {
      if (err instanceof ExecutionDoesNotExist) return { stopped: true };
      throw err;
    }
  }
}
