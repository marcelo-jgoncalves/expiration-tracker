/** Real AWS Step Functions adapter for `TenantPurgeExecutionDescriber` (D-127). `ExecutionDoesNotExist`
 * maps to `{ status: "NOT_FOUND" }` rather than throwing — the sweeper's reconciliation treats a
 * vanished execution as one more non-ABORTED outcome to alarm on, never a crash. */
import { SFNClient, DescribeExecutionCommand, ExecutionDoesNotExist } from "@aws-sdk/client-sfn";
import type { TenantPurgeExecutionDescriber, TenantPurgeExecutionDescription, TenantPurgeExecutionStatus } from "./tenant-purge-execution-describer.js";

export class SfnTenantPurgeExecutionDescriber implements TenantPurgeExecutionDescriber {
  constructor(private readonly client: SFNClient) {}

  async describeExecution(input: { executionArn: string }): Promise<TenantPurgeExecutionDescription> {
    try {
      const result = await this.client.send(new DescribeExecutionCommand({ executionArn: input.executionArn }));
      const status = (result.status ?? "RUNNING") as TenantPurgeExecutionStatus;
      const name = result.name ?? input.executionArn.split(":").pop() ?? "";
      return { status, name };
    } catch (err) {
      if (err instanceof ExecutionDoesNotExist) {
        return { status: "NOT_FOUND", name: input.executionArn.split(":").pop() ?? "" };
      }
      throw err;
    }
  }
}
