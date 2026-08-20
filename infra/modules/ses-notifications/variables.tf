# SES Configuration Set + event destination (SNS) for M4's SesCallbackWorker
# (docs/architecture/m4-notification-engine-design.md §11.1). SES sandbox/test account for
# this milestone (implementation-blueprint.md §19 M4 scope) - identity verification itself
# (aws_sesv2_email_identity + DNS records) is NOT managed here: it's an out-of-band, one-time
# setup step against whichever domain/address the sandbox test account uses, tracked
# separately (not a repeatable per-environment resource the way queues/topics are).

variable "name_prefix" {
  description = "Prefix for the Configuration Set and SNS topic names."
  type        = string
}

variable "callback_queue_arn" {
  description = "ARN of the SesCallbackQueue (SQS) that subscribes to the SNS topic."
  type        = string
}

variable "aws_region" {
  description = "AWS region - used only to construct the SNS topic ARN deterministically for the subscription/queue policy documents, same rationale as the dynamo-table/sqs-worker-queue modules (keeps policy documents plan-time-known)."
  type        = string
}

variable "aws_account_id" {
  description = "AWS account ID - same rationale as aws_region."
  type        = string
}

variable "tags" {
  description = "Tags applied to the Configuration Set and SNS topic."
  type        = map(string)
  default     = {}
}
