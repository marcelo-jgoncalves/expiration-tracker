output "state_machine_arn" {
  description = "The document-extraction Step Functions Standard state machine ARN."
  value       = aws_sfn_state_machine.document_extraction.arn
}
