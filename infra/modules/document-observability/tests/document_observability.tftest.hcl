mock_provider "aws" {}

run "alarms_wired_to_correct_log_groups_and_alert_topic" {
  command = apply

  variables {
    malware_result_function_name             = "exptrk-test-malware-result-handler"
    upload_slot_reconciliation_function_name = "exptrk-test-upload-slot-reconciliation-handler"
    alert_topic_arn                          = "arn:aws:sns:us-east-1:123456789012:exptrk-test-alerts"
    tags                                     = { Project = "expiration-tracker", Environment = "test" }
  }

  assert {
    condition     = aws_cloudwatch_log_metric_filter.malware_threats_found.log_group_name == "/aws/lambda/exptrk-test-malware-result-handler"
    error_message = "THREATS_FOUND metric filter must read the malware-result-handler log group"
  }

  assert {
    condition     = aws_cloudwatch_log_metric_filter.malware_scan_unhealthy.log_group_name == "/aws/lambda/exptrk-test-malware-result-handler"
    error_message = "ACCESS_DENIED/FAILED metric filter must read the malware-result-handler log group"
  }

  assert {
    condition     = aws_cloudwatch_log_metric_filter.documents_timed_out.log_group_name == "/aws/lambda/exptrk-test-upload-slot-reconciliation-handler"
    error_message = "Timeout metric filter must read the reconciliation handler log group"
  }

  assert {
    condition     = contains(aws_cloudwatch_metric_alarm.malware_threats_found.alarm_actions, "arn:aws:sns:us-east-1:123456789012:exptrk-test-alerts")
    error_message = "Malware threats alarm must notify the existing alert topic, not a new destination"
  }

  assert {
    condition = alltrue([
      contains(aws_cloudwatch_metric_alarm.malware_scan_unhealthy.alarm_actions, "arn:aws:sns:us-east-1:123456789012:exptrk-test-alerts"),
      contains(aws_cloudwatch_metric_alarm.documents_timed_out_burst.alarm_actions, "arn:aws:sns:us-east-1:123456789012:exptrk-test-alerts"),
      contains(aws_cloudwatch_metric_alarm.reconciliation_errors.alarm_actions, "arn:aws:sns:us-east-1:123456789012:exptrk-test-alerts"),
    ])
    error_message = "Every M6 alarm must notify the existing alert topic"
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.malware_threats_found.treat_missing_data == "notBreaching"
    error_message = "Alarms must not fire on missing data (no uploads is not an incident)"
  }
}
