output "malware_threats_found_alarm_name" {
  value = aws_cloudwatch_metric_alarm.malware_threats_found.alarm_name
}

output "malware_scan_unhealthy_alarm_name" {
  value = aws_cloudwatch_metric_alarm.malware_scan_unhealthy.alarm_name
}

output "documents_timed_out_burst_alarm_name" {
  value = aws_cloudwatch_metric_alarm.documents_timed_out_burst.alarm_name
}

output "reconciliation_errors_alarm_name" {
  value = aws_cloudwatch_metric_alarm.reconciliation_errors.alarm_name
}
