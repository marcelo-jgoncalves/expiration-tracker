output "import_parse_errors_alarm_name" {
  value = aws_cloudwatch_metric_alarm.import_parse_errors.alarm_name
}

output "import_commit_errors_alarm_name" {
  value = aws_cloudwatch_metric_alarm.import_commit_errors.alarm_name
}
