output "canary_name" { value = aws_synthetics_canary.edge.name }
output "failure_alarm_name" { value = aws_cloudwatch_metric_alarm.failed.alarm_name }
