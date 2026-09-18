output "dashboard_arn" {
  value = aws_cloudwatch_dashboard.operations.dashboard_arn
}

output "dashboard_name" {
  value = aws_cloudwatch_dashboard.operations.dashboard_name
}

output "latency_alarm_names" {
  value = { for name, alarm in aws_cloudwatch_metric_alarm.latency_regression : name => alarm.alarm_name }
}

output "throttle_alarm_names" {
  value = { for name, alarm in aws_cloudwatch_metric_alarm.http_lambda_throttles : name => alarm.alarm_name }
}
