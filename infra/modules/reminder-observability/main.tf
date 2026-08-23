# CloudWatch alarms — Terraform equivalent of infra/lib/reminder-observability.ts. Scope:
# alarms only on existing Lambda/SQS metrics - no dashboard, no SNS wiring. Thresholds are
# judgment calls proportional to this stage (no production traffic yet), same as the CDK
# construct; revisit once real traffic data exists.

locals {
  # Mirrors the CDK construct's `criticalFunctions: Array<[string, lambda.IFunction]>` —
  # logical name (used for the alarm's Terraform resource key and its description) mapped to
  # the actual Lambda function name (used as the CloudWatch dimension).
  critical_functions = {
    ReminderProducer              = var.reminder_producer_function_name
    ReminderDispatch              = var.reminder_dispatch_function_name
    ReminderReconciliation        = var.reminder_reconciliation_function_name
    DispatchOutboxRelay           = var.dispatch_outbox_relay_function_name
    OutboxSweeperReminderDispatch = var.outbox_sweeper_function_name
    # M10 cluster 4 (D-039/D-046/D-048): ReminderProducer itself throws a distinct,
    # alarm-worthy error whenever a GSI3 row matches neither the reminder nor the chasing
    # entityType (producer.ts's `shouldAlarm()`) - already covered by the ReminderProducer
    # entry above. This entry covers the SEPARATE failure mode of the dispatch+delivery
    # worker itself (staleness/SES/rotation errors), which had zero alarm coverage until now.
    DocumentChasingDispatch = var.document_chasing_dispatch_function_name
  }
}

resource "aws_cloudwatch_metric_alarm" "function_errors" {
  for_each = local.critical_functions

  alarm_name          = "${each.value}-errors"
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  dimensions          = { FunctionName = each.value }
  statistic           = "Sum"
  period              = 300 # 5 minutes
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  alarm_description   = "${each.key} raised errors in 3+ of the last 5-minute windows - investigate before backlog grows (async pipeline has no other automatic error signal)."
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alert_topic_arn]
  tags                = var.tags
}

# Main dispatch queue backlog age - distinct from the reminder-queue module's own DLQ age
# alarm: this one catches slow/stuck consumption BEFORE messages exhaust maxReceiveCount and
# land in the DLQ, which is the earlier and more actionable signal for the pipeline's core
# SLO (reminder freshness).
resource "aws_cloudwatch_metric_alarm" "dispatch_queue_backlog" {
  alarm_name          = "${var.dispatch_queue_name}-backlog-age"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  dimensions          = { QueueName = var.dispatch_queue_name }
  statistic           = "Maximum"
  period              = 300 # 5 minutes
  evaluation_periods  = 2
  threshold           = 900 # 15 minutes, in seconds
  comparison_operator = "GreaterThanThreshold"
  alarm_description   = "ReminderDispatchQueue has messages older than 15 minutes - dispatch is falling behind producer; investigate before reminders become stale (toleranceMs default is 30 minutes)."
  treat_missing_data  = "notBreaching"
  alarm_actions       = [var.alert_topic_arn]
  tags                = var.tags
}
