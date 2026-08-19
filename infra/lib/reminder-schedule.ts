/**
 * EventBridge Scheduler wiring for the Reminder Engine's four periodic functions (M3.5,
 * docs/architecture/m3.5-runtime-design.md §"EventBridge Scheduler"). EventBridge
 * Scheduler (not the legacy Rule) per implementation-blueprint.md line 162's already-
 * approved decision - not reopened here.
 */
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import type * as lambda from "aws-cdk-lib/aws-lambda";

function grantInvoke(scope: Construct, id: string, fn: lambda.IFunction): iam.Role {
  const role = new iam.Role(scope, `${id}Role`, {
    assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
  });
  fn.grantInvoke(role);
  return role;
}

export interface ReminderScheduleProps {
  reminderProducer: lambda.IFunction;
  reminderReconciliation: lambda.IFunction;
  outboxSweeper: lambda.IFunction;
  /** Kill switch (default enabled) - lets a deploy/test disable all four schedules without
   * destroying the construct, same pattern as ExpirationTrackerStackProps.mfaPolicy. */
  schedulesEnabled?: boolean;
}

export class ReminderSchedule extends Construct {
  constructor(scope: Construct, id: string, props: ReminderScheduleProps) {
    super(scope, id);

    const state = (props.schedulesEnabled ?? true) ? "ENABLED" : "DISABLED";

    new scheduler.CfnSchedule(this, "ReminderProducerSchedule", {
      scheduleExpression: "rate(1 minute)",
      state,
      flexibleTimeWindow: { mode: "OFF" },
      target: {
        arn: props.reminderProducer.functionArn,
        roleArn: grantInvoke(this, "ReminderProducer", props.reminderProducer).roleArn,
      },
    });

    // Two independent schedules invoking the SAME ReminderReconciliation function with
    // different `detail.mode` (m3.5-runtime-design.md: "mesmo handler pode receber mode,
    // mantendo lógicas e métricas separadas").
    new scheduler.CfnSchedule(this, "ReminderClaimReconciliationSchedule", {
      scheduleExpression: "rate(5 minutes)",
      state,
      flexibleTimeWindow: { mode: "OFF" },
      target: {
        arn: props.reminderReconciliation.functionArn,
        roleArn: grantInvoke(this, "ReminderClaimReconciliation", props.reminderReconciliation).roleArn,
        input: JSON.stringify({ mode: "CLAIMS" }),
      },
    });

    new scheduler.CfnSchedule(this, "ReminderDstReconciliationSchedule", {
      scheduleExpression: "cron(0 3 * * ? *)", // daily 03:00 UTC
      scheduleExpressionTimezone: "UTC",
      state,
      flexibleTimeWindow: { mode: "FLEXIBLE", maximumWindowInMinutes: 15 },
      target: {
        arn: props.reminderReconciliation.functionArn,
        roleArn: grantInvoke(this, "ReminderDstReconciliation", props.reminderReconciliation).roleArn,
        input: JSON.stringify({ mode: "DST" }),
      },
    });

    new scheduler.CfnSchedule(this, "OutboxSweeperReminderDispatchSchedule", {
      scheduleExpression: "rate(5 minutes)",
      state,
      flexibleTimeWindow: { mode: "OFF" },
      target: {
        arn: props.outboxSweeper.functionArn,
        roleArn: grantInvoke(this, "OutboxSweeperReminderDispatch", props.outboxSweeper).roleArn,
      },
    });

  }
}
