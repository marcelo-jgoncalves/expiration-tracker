# Detection layer for the security audit trail (design:
# docs/architecture/reviews/security-audit-trail-design/codex-reconciliation-round2-final-design.md).
# CloudWatch Logs Metric Filters over the closed-taxonomy JSON events emitted by
# src/shared/observability/security-audit.ts, feeding real CloudWatch Alarms wired to the
# existing SNS alert topic (infra/modules/alert-topic) - no new notification destination.

variable "http_function_names" {
  description = <<-EOT
    Real Lambda function names of the 4 HTTP handlers that can emit
    security.authorization_denied (item-handlers, policy-handlers, preferences-handlers,
    test-route-handler's real functions) - log group names are derived deterministically as
    "/aws/lambda/<name>".
  EOT
  type        = list(string)
}

variable "global_index_function_names" {
  description = <<-EOT
    Real Lambda function names of the 3 privileged workers that query GSI3/GSI6 and can emit
    security.global_index_access / security.global_index_access_denied (reminder-producer,
    reminder-reconciliation, outbox-sweeper-reminder-dispatch).
  EOT
  type        = list(string)
}

variable "alert_topic_arn" {
  description = "ARN of the existing SNS alert topic (infra/modules/alert-topic) - reused, never a new notification destination."
  type        = string
}

variable "metric_namespace" {
  description = "CloudWatch custom metric namespace for security audit metrics."
  type        = string
  default     = "ExpirationTracker/Security"
}

variable "tags" {
  description = "Tags applied to resources that support tagging."
  type        = map(string)
  default     = {}
}
