# Reminder dispatch queue + DLQ — Terraform equivalent of infra/lib/reminder-queue.ts
# (ADR-0009). Standard queue (idempotency comes from dispatch's own claim-by-occurrenceId,
# FIFO would add throughput limits without removing that need), maxReceiveCount=5 per
# implementation-blueprint.md §26, visibility timeout >= 6x the ReminderDispatch Lambda
# timeout.

variable "queue_name" {
  description = "Name of the main reminder dispatch queue. The DLQ is named \"<queue_name>-dlq\"."
  type        = string
}

variable "consumer_timeout_seconds" {
  description = <<-EOT
    ReminderDispatch Lambda's own timeout in seconds. The main queue's visibility timeout is
    set to 6x this value (visibility timeout sizing rule from infra/lib/reminder-queue.ts).
    Defaults to 10s, matching ScopedLambdaFunction's/lambda-function module's default timeout.
  EOT
  type        = number
  default     = 10
}

variable "tags" {
  description = "Tags applied to both queues."
  type        = map(string)
  default     = {}
}

variable "aws_region" {
  description = "AWS region the queues are deployed to. Used only to construct the queue ARNs deterministically for IAM policy documents (same rationale as the dynamo-table module), so those documents don't depend on the queue resources actually existing yet — keeps them plan-time-known and independently testable via `terraform test` without requiring `apply` against real AWS."
  type        = string
}

variable "aws_account_id" {
  description = "AWS account ID the queues are deployed to. Same rationale as aws_region."
  type        = string
}
