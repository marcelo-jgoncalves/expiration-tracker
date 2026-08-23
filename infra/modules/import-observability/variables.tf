# Detection layer for M11 (CSV import) — mirrors infra/modules/document-observability's pattern
# over the structured logs already emitted by import-parse-handler.ts ("import-parse outcome",
# "import-parse failed") and import-commit-handler.ts ("import-commit outcome", "import-commit
# failed") — feeding real CloudWatch Alarms wired to the existing SNS alert topic
# (infra/modules/alert-topic), no new notification destination. Closes the residual documented
# in NEXT_SESSION_PROMPT.md/D-050: per-function alarms for ImportParseWorker/ImportCommitWorker,
# on top of the DLQ-age alarm each queue already has via sqs-worker-queue.

variable "import_parse_function_name" {
  description = "Real Lambda function name of import-parse-handler (ImportParseWorker)."
  type        = string
}

variable "import_commit_function_name" {
  description = "Real Lambda function name of import-commit-handler (ImportCommitWorker)."
  type        = string
}

variable "alert_topic_arn" {
  description = "ARN of the existing SNS alert topic (infra/modules/alert-topic) - reused, never a new notification destination."
  type        = string
}

variable "metric_namespace" {
  description = "CloudWatch custom metric namespace for M11 import metrics."
  type        = string
  default     = "ExpirationTracker/Import"
}

variable "tags" {
  description = "Tags applied to resources that support tagging."
  type        = map(string)
  default     = {}
}
