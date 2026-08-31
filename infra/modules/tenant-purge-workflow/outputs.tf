output "state_machine_arn" {
  description = "The tenant-purge Step Functions Standard state machine ARN."
  value       = aws_sfn_state_machine.tenant_purge.arn
}

output "state_machine_name" {
  description = "The state machine's name (plan-time-known, unlike its ARN) - \"<name_prefix>-tenant-purge\"."
  value       = aws_sfn_state_machine.tenant_purge.name
}

output "log_group_arn" {
  description = "CloudWatch Logs group receiving the state machine's ERROR-level execution history."
  value       = aws_cloudwatch_log_group.tenant_purge.arn
}

output "executions_failed_alarm_name" {
  description = "Name of the AWS/States ExecutionsFailed alarm (D-121 Rodada 3 Fix 7 - genuinely new, no prior AWS/States alarm existed in this project)."
  value       = aws_cloudwatch_metric_alarm.executions_failed.alarm_name
}

output "executions_timed_out_alarm_name" {
  description = "Name of the AWS/States ExecutionsTimedOut alarm."
  value       = aws_cloudwatch_metric_alarm.executions_timed_out.alarm_name
}

output "purge_retry_limit" {
  description = "The PURGE_RETRY_LIMIT actually substituted into the ASL Choice condition - exposed so a test can assert the ASL and this constant never drift apart."
  value       = local.purge_retry_limit
}
