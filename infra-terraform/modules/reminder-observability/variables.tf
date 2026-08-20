# CloudWatch alarms for the Reminder Engine's async pipeline — Terraform equivalent of
# infra/lib/reminder-observability.ts (ADR-0009). Alarms only (no dashboard, no SNS wiring —
# no notification target has been decided yet, same deliberately-deferred scope as the CDK
# construct).

variable "reminder_producer_function_name" {
  description = "Name of the ReminderProducer Lambda."
  type        = string
}

variable "reminder_dispatch_function_name" {
  description = "Name of the ReminderDispatch Lambda."
  type        = string
}

variable "reminder_reconciliation_function_name" {
  description = "Name of the ReminderReconciliation Lambda."
  type        = string
}

variable "dispatch_outbox_relay_function_name" {
  description = "Name of the DispatchOutboxRelay Lambda."
  type        = string
}

variable "outbox_sweeper_function_name" {
  description = "Name of the OutboxSweeperReminderDispatch Lambda."
  type        = string
}

variable "dispatch_queue_name" {
  description = "Name of the main ReminderDispatchQueue (reminder-queue module's queue_name output) — the backlog-age alarm watches this queue's ApproximateAgeOfOldestMessage metric."
  type        = string
}

variable "tags" {
  description = "Tags applied to the alarms."
  type        = map(string)
  default     = {}
}
