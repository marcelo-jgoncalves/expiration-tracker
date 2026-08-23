mock_provider "aws" {}

run "alarms_wired_to_correct_log_groups_and_alert_topic" {
  command = apply

  variables {
    import_parse_function_name  = "exptrk-test-import-parse-handler"
    import_commit_function_name = "exptrk-test-import-commit-handler"
    alert_topic_arn             = "arn:aws:sns:us-east-1:123456789012:exptrk-test-alerts"
    tags                        = { Project = "expiration-tracker", Environment = "test" }
  }

  assert {
    condition     = aws_cloudwatch_log_metric_filter.import_parse_exception.log_group_name == "/aws/lambda/exptrk-test-import-parse-handler"
    error_message = "Parse exception metric filter must read the import-parse-handler log group"
  }

  assert {
    condition     = aws_cloudwatch_log_metric_filter.import_parse_job_failed.log_group_name == "/aws/lambda/exptrk-test-import-parse-handler"
    error_message = "Parse job-failed metric filter must read the import-parse-handler log group"
  }

  assert {
    condition     = aws_cloudwatch_log_metric_filter.import_commit_exception.log_group_name == "/aws/lambda/exptrk-test-import-commit-handler"
    error_message = "Commit exception metric filter must read the import-commit-handler log group"
  }

  assert {
    condition     = aws_cloudwatch_log_metric_filter.import_commit_integrity_mismatch.log_group_name == "/aws/lambda/exptrk-test-import-commit-handler"
    error_message = "Integrity-mismatch metric filter must read the import-commit-handler log group"
  }

  assert {
    condition = alltrue([
      contains(aws_cloudwatch_metric_alarm.import_parse_errors.alarm_actions, "arn:aws:sns:us-east-1:123456789012:exptrk-test-alerts"),
      contains(aws_cloudwatch_metric_alarm.import_commit_errors.alarm_actions, "arn:aws:sns:us-east-1:123456789012:exptrk-test-alerts"),
    ])
    error_message = "Every M11 import alarm must notify the existing alert topic, not a new destination"
  }

  assert {
    condition = alltrue([
      aws_cloudwatch_metric_alarm.import_parse_errors.treat_missing_data == "notBreaching",
      aws_cloudwatch_metric_alarm.import_commit_errors.treat_missing_data == "notBreaching",
    ])
    error_message = "Alarms must not fire on missing data (no imports running is not an incident)"
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.import_parse_errors.metric_name == aws_cloudwatch_log_metric_filter.import_parse_job_failed.metric_transformation[0].name
    error_message = "The parse alarm must watch the same metric name the job-failed filter emits"
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.import_commit_errors.metric_name == aws_cloudwatch_log_metric_filter.import_commit_integrity_mismatch.metric_transformation[0].name
    error_message = "The commit alarm must watch the same metric name the integrity-mismatch filter emits"
  }
}
