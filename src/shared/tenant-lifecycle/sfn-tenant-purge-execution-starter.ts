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
 *
 * D-127: `ExecutionAlreadyExists` carries no `executionArn` field (verified against the SDK's own
 * exception shape, not assumed) — on that path this derives the ARN from the DOCUMENTED, stable
 * AWS Step Functions ARN format (`arn:...:stateMachine:<name>` -> `arn:...:execution:<name>:
 * <executionName>`, https://docs.aws.amazon.com/step-functions/latest/dg/concepts-amazon-resource-names.html),
 * never guessed/heuristic — the same construction Step Functions itself uses to produce the ARN
 * `StartExecutionCommand` returns on the non-conflict path, so both branches agree by construction.
 */
import { SFNClient, StartExecutionCommand, ExecutionAlreadyExists } from "@aws-sdk/client-sfn";
import type { TenantPurgeExecutionStarter } from "./tenant-purge-execution-starter.js";

/** `arn:aws:states:<region>:<account>:stateMachine:<name>` -> `arn:aws:states:<region>:<account>:execution:<name>:<executionName>`. */
export function deriveExecutionArn(stateMachineArn: string, executionName: string): string {
  const marker = ":stateMachine:";
  const idx = stateMachineArn.indexOf(marker);
  if (idx === -1) {
    throw new Error(`deriveExecutionArn: "${stateMachineArn}" is not a recognizable state machine ARN (missing "${marker}").`);
  }
  const prefix = stateMachineArn.slice(0, idx);
  const stateMachineName = stateMachineArn.slice(idx + marker.length);
  return `${prefix}:execution:${stateMachineName}:${executionName}`;
}

export class SfnTenantPurgeExecutionStarter implements TenantPurgeExecutionStarter {
  constructor(
    private readonly client: SFNClient,
    private readonly stateMachineArn: string,
  ) {}

  async startExecution(input: { name: string; input: { tenantId: string } }): Promise<{ executionArn: string }> {
    try {
      const result = await this.client.send(
        new StartExecutionCommand({
          stateMachineArn: this.stateMachineArn,
          name: input.name,
          input: JSON.stringify(input.input),
        }),
      );
      if (!result.executionArn) {
        throw new Error("StartExecutionCommand succeeded but returned no executionArn.");
      }
      return { executionArn: result.executionArn };
    } catch (err) {
      if (err instanceof ExecutionAlreadyExists) {
        return { executionArn: deriveExecutionArn(this.stateMachineArn, input.name) };
      }
      throw err;
    }
  }
}
