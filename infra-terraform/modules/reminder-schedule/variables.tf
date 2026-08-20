# EventBridge Scheduler wiring for the Reminder Engine's four periodic functions —
# Terraform equivalent of infra/lib/reminder-schedule.ts (ADR-0009). EventBridge Scheduler
# (not the legacy Rule) per implementation-blueprint.md line 162's already-approved
# decision, not reopened here.

variable "reminder_producer_function_arn" {
  description = "ARN of the ReminderProducer Lambda (invoked every 1 minute)."
  type        = string
}

variable "reminder_producer_function_name" {
  description = "Name of the ReminderProducer Lambda. Used to scope the invoke permission narrowly (not just the ARN string) and to name the schedule's IAM role."
  type        = string
}

variable "reminder_reconciliation_function_arn" {
  description = "ARN of the ReminderReconciliation Lambda (invoked by both the CLAIMS and DST schedules)."
  type        = string
}

variable "reminder_reconciliation_function_name" {
  description = "Name of the ReminderReconciliation Lambda."
  type        = string
}

variable "outbox_sweeper_function_arn" {
  description = "ARN of the OutboxSweeperReminderDispatch Lambda (invoked every 5 minutes)."
  type        = string
}

variable "outbox_sweeper_function_name" {
  description = "Name of the OutboxSweeperReminderDispatch Lambda."
  type        = string
}

variable "schedules_enabled" {
  description = "Kill switch (default enabled) - lets a deploy/test disable all four schedules without destroying the resources, same pattern as ReminderScheduleProps.schedulesEnabled in the CDK construct."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags applied to the schedule IAM roles."
  type        = map(string)
  default     = {}
}
