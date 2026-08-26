# M7 extraction pipeline Step Functions Standard state machine (D-035, claude-reconciliation-
# final-design.md). Deliberately NOT called from infra/main.tf yet (2026-08-26) — item 4
# (TextractTaskHandler) exists, but items 5-7 (PdfParserTaskHandler/BedrockExtractionTaskHandler/
# ExtractionValidationTaskHandler) referenced by the stub states in document-extraction.asl.json
# don't exist yet, and Terraform apply (not just runtime) fails if a Task state's FunctionName
# resolves to a non-existent Lambda ARN. Parameterized by ARN so wiring is a one-line `module`
# block addition once those Lambdas exist — see NEXT_SESSION_PROMPT.md for exact next steps.

variable "name_prefix" {
  description = "Prefix for the state machine name — MUST resolve to the same value as root infra/main.tf's local.extraction_state_machine_arn (name_prefix + \"-document-extraction\"), already referenced by ExtractionStarterWorker (item 2)."
  type        = string
}

variable "textract_task_function_arn" {
  description = "TextractTaskHandler Lambda ARN (item 4) — the only real Task state, RunTextract."
  type        = string
}

variable "pdf_parser_task_function_arn" {
  description = "PdfParserTaskHandler Lambda ARN (item 5, not yet implemented)."
  type        = string
}

variable "bedrock_extraction_task_function_arn" {
  description = "BedrockExtractionTaskHandler Lambda ARN (item 6, not yet implemented)."
  type        = string
}

variable "extraction_validation_task_function_arn" {
  description = "ExtractionValidationTaskHandler Lambda ARN (item 7, not yet implemented) — backs ValidateSchema/CompareExtractors/PersistExtractedFields/MarkPendingConfirmation/CompleteRun."
  type        = string
}

variable "state_machine_role_arn" {
  description = "IAM role for the state machine execution (lambda:InvokeFunction on the four function ARNs above, states:SendTaskSuccess/Failure/Heartbeat is NOT needed here — that's the Lambda's own IAM, not the state machine's)."
  type        = string
}

variable "tags" {
  description = "Tags applied to the state machine."
  type        = map(string)
  default     = {}
}
