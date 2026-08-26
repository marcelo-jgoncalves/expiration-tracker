/** Real adapter for `TaskTokenSender` over `@aws-sdk/client-sfn`. Implements the exact
 * terminal-vs-transient classification from `claude-reconciliation-final-design.md` §3:
 * `TaskTimedOut`/`TaskDoesNotExist` -> silent success (`TERMINAL_QUIET`), `InvalidToken` ->
 * silent success but logged `warn` by the CALLER (`TERMINAL_WARN_INVALID_TOKEN` — this adapter
 * only classifies, it never logs), anything else rethrown untouched for the SQS consumer to
 * retry. */
import { SFNClient, SendTaskSuccessCommand, SendTaskFailureCommand } from "@aws-sdk/client-sfn";
import type { SendTaskOutcome, TaskTokenSender } from "../ports/task-token-sender.js";

const TERMINAL_QUIET_ERROR_NAMES = new Set(["TaskTimedOut", "TaskDoesNotExist"]);
const TERMINAL_WARN_ERROR_NAME = "InvalidToken";

function sdkErrorName(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "name" in err) {
    return String((err as { name?: unknown }).name);
  }
  return undefined;
}

function classify(err: unknown): SendTaskOutcome {
  const name = sdkErrorName(err);
  if (name && TERMINAL_QUIET_ERROR_NAMES.has(name)) return "TERMINAL_QUIET";
  if (name === TERMINAL_WARN_ERROR_NAME) return "TERMINAL_WARN_INVALID_TOKEN";
  throw err;
}

export class SfnTaskTokenSender implements TaskTokenSender {
  constructor(private readonly client: SFNClient) {}

  async sendTaskSuccess(taskToken: string, output: unknown): Promise<SendTaskOutcome> {
    try {
      await this.client.send(new SendTaskSuccessCommand({ taskToken, output: JSON.stringify(output) }));
      return "SENT";
    } catch (err) {
      return classify(err);
    }
  }

  async sendTaskFailure(taskToken: string, error: string, cause?: string): Promise<SendTaskOutcome> {
    try {
      await this.client.send(new SendTaskFailureCommand({ taskToken, error, cause }));
      return "SENT";
    } catch (err) {
      return classify(err);
    }
  }
}

export function createSfnClient(): SFNClient {
  return new SFNClient({});
}
