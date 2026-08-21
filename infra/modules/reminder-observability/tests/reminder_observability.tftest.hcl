# Recreates the acceptance criteria implied by infra/lib/reminder-observability.ts as
# native `terraform test` assertions. mock_provider — no real AWS credentials/resources
# needed (all resources here are aws_cloudwatch_metric_alarm, no policy-document data
# sources).

mock_provider "aws" {}

run "exactly_five_function_error_alarms_plus_one_backlog_alarm" {
  command = apply

  variables {
    reminder_producer_function_name       = "reminder-producer"
    reminder_dispatch_function_name       = "reminder-dispatch"
    reminder_reconciliation_function_name = "reminder-reconciliation"
    dispatch_outbox_relay_function_name   = "dispatch-outbox-relay"
    outbox_sweeper_function_name          = "outbox-sweeper-reminder-dispatch"
    dispatch_queue_name                   = "reminder-dispatch-queue"
    alert_topic_arn                       = "arn:aws:sns:us-east-1:123456789012:exptrk-test-alerts"
  }

  # Exactly 5 critical-function error alarms - not more, not fewer.
  assert {
    condition     = length(aws_cloudwatch_metric_alarm.function_errors) == 5
    error_message = "Expected exactly 5 Lambda Errors alarms (producer/dispatch/reconciliation/relay/sweeper)"
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.function_errors["ReminderProducer"].dimensions["FunctionName"] == "reminder-producer"
    error_message = "ReminderProducer alarm must watch the reminder-producer function"
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.function_errors["ReminderDispatch"].dimensions["FunctionName"] == "reminder-dispatch"
    error_message = "ReminderDispatch alarm must watch the reminder-dispatch function"
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.function_errors["ReminderReconciliation"].dimensions["FunctionName"] == "reminder-reconciliation"
    error_message = "ReminderReconciliation alarm must watch the reminder-reconciliation function"
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.function_errors["DispatchOutboxRelay"].dimensions["FunctionName"] == "dispatch-outbox-relay"
    error_message = "DispatchOutboxRelay alarm must watch the dispatch-outbox-relay function"
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.function_errors["OutboxSweeperReminderDispatch"].dimensions["FunctionName"] == "outbox-sweeper-reminder-dispatch"
    error_message = "OutboxSweeperReminderDispatch alarm must watch the outbox-sweeper-reminder-dispatch function"
  }

  # Each alarm watches the Errors metric on AWS/Lambda, threshold 1, 3 evaluation periods,
  # >= comparison (matches CDK's GREATER_THAN_OR_EQUAL_TO_THRESHOLD).
  assert {
    condition = alltrue([
      for name, alarm in aws_cloudwatch_metric_alarm.function_errors :
      alarm.namespace == "AWS/Lambda" && alarm.metric_name == "Errors" && alarm.threshold == 1 && alarm.evaluation_periods == 3 && alarm.comparison_operator == "GreaterThanOrEqualToThreshold"
    ])
    error_message = "Every function error alarm must watch AWS/Lambda Errors with threshold=1, evaluation_periods=3, comparison=GreaterThanOrEqualToThreshold"
  }

  # Descriptions must contain the specific function's logical name (previous test's
  # pattern, per the task's explicit instruction to replicate it).
  assert {
    condition     = strcontains(aws_cloudwatch_metric_alarm.function_errors["ReminderProducer"].alarm_description, "ReminderProducer")
    error_message = "ReminderProducer alarm description must mention ReminderProducer by name"
  }

  assert {
    condition     = strcontains(aws_cloudwatch_metric_alarm.function_errors["DispatchOutboxRelay"].alarm_description, "DispatchOutboxRelay")
    error_message = "DispatchOutboxRelay alarm description must mention DispatchOutboxRelay by name"
  }

  assert {
    condition     = strcontains(aws_cloudwatch_metric_alarm.function_errors["OutboxSweeperReminderDispatch"].alarm_description, "OutboxSweeperReminderDispatch")
    error_message = "OutboxSweeperReminderDispatch alarm description must mention OutboxSweeperReminderDispatch by name"
  }

  # Exactly one queue backlog-age alarm, on ApproximateAgeOfOldestMessage / AWS/SQS,
  # 15-minute threshold, 2 evaluation periods.
  assert {
    condition     = aws_cloudwatch_metric_alarm.dispatch_queue_backlog.namespace == "AWS/SQS"
    error_message = "Backlog alarm must watch AWS/SQS namespace"
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.dispatch_queue_backlog.metric_name == "ApproximateAgeOfOldestMessage"
    error_message = "Backlog alarm must watch ApproximateAgeOfOldestMessage"
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.dispatch_queue_backlog.dimensions["QueueName"] == "reminder-dispatch-queue"
    error_message = "Backlog alarm must watch the main dispatch queue"
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.dispatch_queue_backlog.threshold == 900
    error_message = "Backlog alarm threshold must be 15 minutes (900s)"
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.dispatch_queue_backlog.evaluation_periods == 2
    error_message = "Backlog alarm must use 2 evaluation periods"
  }

  # m5-observability-design.md §4: every alarm must have a real notification target.
  assert {
    condition = alltrue([
      for name, alarm in aws_cloudwatch_metric_alarm.function_errors :
      contains(alarm.alarm_actions, "arn:aws:sns:us-east-1:123456789012:exptrk-test-alerts")
    ])
    error_message = "Every function error alarm must have alarm_actions pointing at the alert topic"
  }

  assert {
    condition     = contains(aws_cloudwatch_metric_alarm.dispatch_queue_backlog.alarm_actions, "arn:aws:sns:us-east-1:123456789012:exptrk-test-alerts")
    error_message = "Backlog alarm must have alarm_actions pointing at the alert topic"
  }
}
