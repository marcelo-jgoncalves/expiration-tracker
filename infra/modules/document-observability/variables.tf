# Detection layer for M6 (document upload/malware boundary) — CloudWatch Logs Metric Filters
# over the structured logs already emitted by malware-result-handler.ts
# ("malware-result outcome", fields event/status/documentId — src/shared/observability/
# logger.ts's SecureLogger writes `event`, never `message`) and
# upload-slot-reconciliation-handler.ts ("upload-slot-reconciliation complete", fields
# documentsTimedOut/errors), feeding real CloudWatch Alarms wired to the existing SNS alert
# topic (infra/modules/alert-topic) — no new notification destination, same pattern as
# security-audit-observability.

variable "malware_result_function_name" {
  description = "Real Lambda function name of malware-result-handler (the only emitter of GuardDuty scan outcomes)."
  type        = string
}

variable "upload_slot_reconciliation_function_name" {
  description = "Real Lambda function name of upload-slot-reconciliation-handler."
  type        = string
}

variable "alert_topic_arn" {
  description = "ARN of the existing SNS alert topic (infra/modules/alert-topic) - reused, never a new notification destination."
  type        = string
}

variable "metric_namespace" {
  description = "CloudWatch custom metric namespace for M6 document/malware metrics."
  type        = string
  default     = "ExpirationTracker/Document"
}

variable "tags" {
  description = "Tags applied to resources that support tagging."
  type        = map(string)
  default     = {}
}
