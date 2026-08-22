output "authorization_denied_burst_alarm_name" {
  value = aws_cloudwatch_metric_alarm.authorization_denied_burst.alarm_name
}

output "authorization_tenant_boundary_denied_alarm_name" {
  value = aws_cloudwatch_metric_alarm.authorization_tenant_boundary_denied.alarm_name
}

output "global_index_access_denied_alarm_name" {
  value = aws_cloudwatch_metric_alarm.global_index_access_denied.alarm_name
}
