mock_provider "aws" {}

run "three_alarms_wired_to_the_real_alert_topic" {
  command = apply

  variables {
    # Mirrors the real 8 HTTP / 5 GSI wiring in infra/main.tf (Codex round 1, 2026-08-29 finding:
    # this fixture used to encode a stale 4/3 view that masked a real root-wiring gap —
    # documents/subjects/imports handlers and document-purge/upload-slot-reconciliation workers
    # were missing from the real lists for weeks before this test's names were corrected to
    # match). See test/architecture/security-audit-observability-coverage.test.ts for the
    # regression-proof cross-check against real call sites, which this module-local fixture
    # cannot provide on its own.
    http_function_names = [
      "exptrk-test-items-handler",
      "exptrk-test-reminders-handler",
      "exptrk-test-notifications-handler",
      "exptrk-test-profile-handler",
      "exptrk-test-test-ping-handler",
      "exptrk-test-documents-handler",
      "exptrk-test-subjects-handler",
      "exptrk-test-imports-handler",
    ]
    global_index_function_names = [
      "exptrk-test-reminder-producer",
      "exptrk-test-reminder-reconciliation",
      "exptrk-test-outbox-sweeper-reminder-dispatch",
      "exptrk-test-document-purge-handler",
      "exptrk-test-upload-slot-reconciliation-handler",
    ]
    alert_topic_arn = "arn:aws:sns:us-east-1:123456789012:exptrk-test-alerts"
    tags            = { Project = "expiration-tracker", Environment = "test" }
  }

  assert {
    condition     = length(aws_cloudwatch_log_metric_filter.authorization_denied) == 8
    error_message = "One authorization_denied metric filter per HTTP function (8 expected)"
  }

  assert {
    condition     = length(aws_cloudwatch_log_metric_filter.authorization_denied_tenant_mismatch) == 8
    error_message = "One TENANT_MISMATCH metric filter per HTTP function (8 expected)"
  }

  assert {
    condition     = length(aws_cloudwatch_log_metric_filter.global_index_access_denied) == 5
    error_message = "One global_index_access_denied metric filter per privileged worker (5 expected)"
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
