# E-018/E-021 (full-audit round2) - closes "no custom metrics/dashboard exist", protocol
# Claude↔Codex APPROVED (docs/architecture/reviews/emf-metrics-dashboard-scoping/, 3 rounds,
# 6,8→7,2→9,2). Aggregate operational dashboard for the 4 async pipelines audited repeatedly
# as risk-relevant (reminder dispatch, notification outbox publish x2 - email/whatsapp share
# the same code but deploy as 2 separate functions - and guest credential delivery). Deliberately
# NEVER a per-tenant metric dimension (see src/shared/observability/metrics.ts's own doc
# comment) - per-tenant investigation is the 2 Logs Insights widgets below, not a dimension.

variable "name_prefix" {
  description = "Prefix for the dashboard name (e.g. exptrk-dev)."
  type        = string
}

variable "aws_region" {
  type = string
}

variable "dashboard_name" {
  description = "Dashboard name. Defaults to \"<name_prefix>-operations\" via a local, never a variable-referencing default (Terraform does not allow one var's default to reference another var)."
  type        = string
  default     = null
}

variable "table_name" {
  description = "Main DynamoDB table name (module.table.table_name)."
  type        = string
}

# --- reminder-dispatch (SQS-triggered - Errors/Invocations/Duration are valid native signals) -

variable "reminder_dispatch_function_name" {
  type = string
}

variable "reminder_dispatch_queue_name" {
  type = string
}

# --- notification-email-outbox-relay / notification-whatsapp-outbox-relay (DynamoDB Streams-
# triggered, ReportBatchItemFailures - AWS/Lambda Errors never reflects a retried record, so
# IteratorAge is the correct native signal here, not Errors - infra/main.tf's own
# guest_credential_delivery_iterator_age alarm comment documents why) ----------------------

variable "notification_email_outbox_relay_function_name" {
  type = string
}

variable "notification_whatsapp_outbox_relay_function_name" {
  type = string
}

# --- guest-credential-delivery (DynamoDB Streams-triggered, same ReportBatchItemFailures
# caveat as the 2 outbox relay functions above) --------------------------------------------

variable "guest_credential_delivery_function_name" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}
