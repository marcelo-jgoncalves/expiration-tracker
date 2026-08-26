output "state_machine_arn" {
  description = "The document-extraction Step Functions Standard state machine ARN."
  value       = aws_sfn_state_machine.document_extraction.arn
}

output "state_machine_name" {
  description = "The state machine's name (plan-time-known, unlike its ARN which is a computed attribute) - \"<name_prefix>-document-extraction\", must match the name segment of root infra/main.tf's local.extraction_state_machine_arn."
  value       = aws_sfn_state_machine.document_extraction.name
}

output "log_group_arn" {
  description = "CloudWatch Logs group receiving the state machine's ERROR-level execution history."
  value       = aws_cloudwatch_log_group.document_extraction.arn
}
