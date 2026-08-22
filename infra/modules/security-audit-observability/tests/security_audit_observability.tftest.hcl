mock_provider "aws" {}

run "three_alarms_wired_to_the_real_alert_topic" {
  command = apply

  variables {
    http_function_names         = ["exptrk-test-items-handler", "exptrk-test-reminders-handler", "exptrk-test-notifications-handler", "exptrk-test-test-ping-handler"]
    global_index_function_names = ["exptrk-test-reminder-producer", "exptrk-test-reminder-reconciliation", "exptrk-test-outbox-sweeper-reminder-dispatch"]
    alert_topic_arn             = "arn:aws:sns:us-east-1:123456789012:exptrk-test-alerts"
    tags                        = { Project = "expiration-tracker", Environment = "test" }
  }

  assert {
    condition     = length(aws_cloudwatch_log_metric_filter.authorization_denied) == 4
    error_message = "One authorization_denied metric filter per HTTP function (4 expected)"
  }

  assert {
    condition     = length(aws_cloudwatch_log_metric_filter.authorization_denied_tenant_mismatch) == 4
    error_message = "One TENANT_MISMATCH metric filter per HTTP function (4 expected)"
  }

  assert {
    condition     = length(aws_cloudwatch_log_metric_filter.global_index_access_denied) == 3
    error_message = "One global_index_access_denied metric filter per privileged worker (3 expected)"
  }

  assert {
    condition     = contains(aws_cloudwatch_metric_alarm.authorization_denied_burst.alarm_actions, "arn:aws:sns:us-east-1:123456789012:exptrk-test-alerts")
    error_message = "AuthorizationDeniedBurst alarm must notify the real alert topic"
  }

  assert {
    condition     = contains(aws_cloudwatch_metric_alarm.authorization_tenant_boundary_denied.alarm_actions, "arn:aws:sns:us-east-1:123456789012:exptrk-test-alerts")
    error_message = "TenantBoundaryDenied alarm must notify the real alert topic"
  }

  assert {
    condition     = contains(aws_cloudwatch_metric_alarm.global_index_access_denied.alarm_actions, "arn:aws:sns:us-east-1:123456789012:exptrk-test-alerts")
    error_message = "GlobalIndexAccessDenied alarm must notify the real alert topic"
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.authorization_tenant_boundary_denied.threshold == 1
    error_message = "TENANT_MISMATCH is the highest-severity signal - threshold must be 1, not batched"
  }

  assert {
    condition = alltrue([
      for a in [aws_cloudwatch_metric_alarm.authorization_denied_burst, aws_cloudwatch_metric_alarm.authorization_tenant_boundary_denied, aws_cloudwatch_metric_alarm.global_index_access_denied] :
      a.treat_missing_data == "notBreaching"
    ])
    error_message = "All 3 alarms must treat missing data as not breaching (absence of denials is not itself an incident)"
  }
}
