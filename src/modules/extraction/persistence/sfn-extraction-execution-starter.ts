/** Real AWS Step Functions adapter for ExtractionExecutionStarter. `name` is always the
 * deterministic `runId` (see the port's own doc comment) - StartExecution's own uniqueness
 * constraint on (state machine, execution name) is the AWS-level idempotency backstop on top
 * of the DynamoDB `ExtractionRun.putIfAbsent` check in `startExtractionRun`. */
import { SFNClient, StartExecutionCommand, ExecutionAlreadyExists } from "@aws-sdk/client-sfn";
import type { ExtractionExecutionStarter, ExtractionExecutionInput } from "../ports/extraction-execution-starter.js";

export class SfnExtractionExecutionStarter implements ExtractionExecutionStarter {
  constructor(
    private readonly client: SFNClient,
    private readonly stateMachineArn: string,
  ) {}

  async startExecution(input: { name: string; input: ExtractionExecutionInput }): Promise<void> {
    try {
      await this.client.send(
        new StartExecutionCommand({
          stateMachineArn: this.stateMachineArn,
          name: input.name,
          input: JSON.stringify(input.input),
        }),
      );
    } catch (err) {
      // Same execution name + same input already running/completed - exactly the idempotent
      // no-op this port's doc comment describes. A DIFFERENT input under the same name (which
      // should never happen - `name` is derived from the same key the input is built from)
      // still surfaces as ExecutionAlreadyExists from the AWS API; swallowing it either way is
      // safe because the input is always deterministically reconstructed from the same
      // tenantId/documentId/documentVersion/pipelineVersion this name was derived from.
      if (err instanceof ExecutionAlreadyExists) return;
      throw err;
    }
  }
}

export function createSfnClient(): SFNClient {
  return new SFNClient({});
}
