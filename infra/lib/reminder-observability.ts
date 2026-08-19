/**
 * CloudWatch alarms for the Reminder Engine's async pipeline - full-audit round1
 * (Arquitetura, Observability & Operability, docs/engineering/reviews/
 * full-audit-round1-arquitetura-*). Before this construct, the only synthesized alarm in
 * the entire stack was ReminderDispatchQueue's DLQ age alarm
 * (infra/lib/reminder-queue.ts) - both Claude and Codex round-1 reviews flagged that as a
 * concrete, correctable-without-AWS gap: no visibility into main-queue backlog or Lambda
 * error rate for producer/dispatch/relay/reconciliation/sweeper, the five functions whose
 * failure mode is exactly what G8 exists to catch.
 *
 * Scope: alarms only (CloudWatch Alarm resources on existing Lambda/SQS metrics) - no
 * dashboard, no SNS wiring (no notification target has been decided yet; that is a
 * separate, deliberately deferred follow-up, not silently skipped). Thresholds are
 * judgment calls proportional to this stage (no production traffic yet), documented inline;
 * revisit once real traffic data exists.
 */
import { Duration } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

export interface ReminderObservabilityProps {
  reminderProducer: lambda.IFunction;
  reminderDispatch: lambda.IFunction;
  reminderReconciliation: lambda.IFunction;
  dispatchOutboxRelay: lambda.IFunction;
  outboxSweeper: lambda.IFunction;
  dispatchQueue: sqs.IQueue;
}

export class ReminderObservability extends Construct {
  readonly alarms: cloudwatch.Alarm[] = [];

  constructor(scope: Construct, id: string, props: ReminderObservabilityProps) {
    super(scope, id);

    const criticalFunctions: Array<[string, lambda.IFunction]> = [
      ["ReminderProducer", props.reminderProducer],
      ["ReminderDispatch", props.reminderDispatch],
      ["ReminderReconciliation", props.reminderReconciliation],
      ["DispatchOutboxRelay", props.dispatchOutboxRelay],
      ["OutboxSweeperReminderDispatch", props.outboxSweeper],
    ];

    for (const [name, fn] of criticalFunctions) {
      this.alarms.push(
        new cloudwatch.Alarm(this, `${name}ErrorsAlarm`, {
          metric: fn.metricErrors({ period: Duration.minutes(5) }),
          threshold: 1,
          evaluationPeriods: 3,
          comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
          alarmDescription: `${name} raised errors in 3+ of the last 5-minute windows - investigate before backlog grows (async pipeline has no other automatic error signal).`,
          treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        }),
      );
    }

    // Main dispatch queue backlog age - distinct from ReminderDispatchQueue's own DLQ age
    // alarm (reminder-queue.ts): this one catches slow/stuck consumption BEFORE messages
    // exhaust maxReceiveCount and land in the DLQ, which is the earlier and more actionable
    // signal for the pipeline's core SLO (reminder freshness).
    this.alarms.push(
      new cloudwatch.Alarm(this, "DispatchQueueBacklogAlarm", {
        metric: props.dispatchQueue.metricApproximateAgeOfOldestMessage({ period: Duration.minutes(5) }),
        threshold: Duration.minutes(15).toSeconds(),
        evaluationPeriods: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: "ReminderDispatchQueue has messages older than 15 minutes - dispatch is falling behind producer; investigate before reminders become stale (toleranceMs default is 30 minutes).",
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
    );
  }
}
