/** Step Functions callback surface (`SendTaskSuccess`/`SendTaskFailure`) — narrow port so
 * `completeOcr` stays testable without `@aws-sdk/client-sfn`. The adapter is responsible for
 * classifying `SendTask*` SDK errors into the three buckets `completeOcr` needs (design §3):
 * terminal-quiet (TaskTimedOut/TaskDoesNotExist), terminal-warn (InvalidToken), and
 * transient-rethrow (everything else, e.g. throttling). */
export type SendTaskOutcome = "SENT" | "TERMINAL_QUIET" | "TERMINAL_WARN_INVALID_TOKEN";

export interface TaskTokenSender {
  /** Resolves to the classified outcome on any terminal case (never throws for those);
   * rethrows for a transient `SendTask*` error so the caller can propagate it up to the SQS
   * consumer for redelivery, per design §3's rodada-7 correction. */
  sendTaskSuccess(taskToken: string, output: unknown): Promise<SendTaskOutcome>;
  sendTaskFailure(taskToken: string, error: string, cause?: string): Promise<SendTaskOutcome>;
}
