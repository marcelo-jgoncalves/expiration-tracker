/**
 * ReminderDispatchQueue + DLQ (M3.5, docs/architecture/m3.5-runtime-design.md
 * §"SQS + DLQ"): Standard queue (idempotency is required regardless of ordering -
 * dispatch's own claim-by-occurrenceId already provides it, FIFO would add throughput
 * limits without removing that need), maxReceiveCount=5 per implementation-blueprint.md
 * §26, visibility timeout >= 6x the ReminderDispatch Lambda timeout.
 */
import { Duration } from "aws-cdk-lib";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import { Construct } from "constructs";

export interface ReminderDispatchQueueProps {
  /** Must be >= 6x this value (visibility timeout sizing rule). Defaults to the
   * ReminderDispatch Lambda's own default timeout (10s, ScopedLambdaFunction). */
  consumerTimeoutSeconds?: number;
}

export class ReminderDispatchQueue extends Construct {
  readonly queue: sqs.Queue;
  readonly deadLetterQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props: ReminderDispatchQueueProps = {}) {
    super(scope, id);

    this.deadLetterQueue = new sqs.Queue(this, "Dlq", {
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    const consumerTimeout = props.consumerTimeoutSeconds ?? 10;
    this.queue = new sqs.Queue(this, "Queue", {
      retentionPeriod: Duration.days(4),
      visibilityTimeout: Duration.seconds(consumerTimeout * 6),
      receiveMessageWaitTime: Duration.seconds(20), // long polling
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: { queue: this.deadLetterQueue, maxReceiveCount: 5 },
    });

    // implementation-blueprint.md line 879: DLQ age alarm at 1h/4h.
    new cloudwatch.Alarm(this, "DlqAgeAlarm", {
      metric: this.deadLetterQueue.metricApproximateAgeOfOldestMessage({ period: Duration.minutes(5) }),
      threshold: Duration.hours(1).toSeconds(),
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: "ReminderDispatchQueue DLQ has messages older than 1 hour - investigate and redrive per runbook (never blind redrive).",
    });
  }
}
