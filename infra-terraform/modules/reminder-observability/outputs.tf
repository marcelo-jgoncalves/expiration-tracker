output "function_error_alarm_arns" {
  value = { for name, alarm in aws_cloudwatch_metric_alarm.function_errors : name => alarm.arn }
}

output "dispatch_queue_backlog_alarm_arn" {
  value = aws_cloudwatch_metric_alarm.dispatch_queue_backlog.arn
}
