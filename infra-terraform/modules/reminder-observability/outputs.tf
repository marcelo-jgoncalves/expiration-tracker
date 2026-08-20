output "function_error_alarm_arns" {
  value = { for name, alarm in aws_cloudwatch_metric_alarm.function_errors : name => alarm.arn }
}

output "dispatch_queue_backlog_alarm_arn" {
  value = aws_cloudwatch_metric_alarm.dispatch_queue_backlog.arn
}

output "dispatch_queue_backlog_alarm_name" {
  value = aws_cloudwatch_metric_alarm.dispatch_queue_backlog.alarm_name
}

output "function_error_alarm_names" {
  value = { for name, alarm in aws_cloudwatch_metric_alarm.function_errors : name => alarm.alarm_name }
}
