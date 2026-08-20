# Reminder dispatch queue + DLQ — Terraform equivalent of infra/lib/reminder-queue.ts.
# See variables.tf for the sizing rationale (maxReceiveCount=5, visibility timeout = 6x
# consumer timeout, long polling, DLQ age alarm at 1h per implementation-blueprint.md
# line 879).

resource "aws_sqs_queue" "dlq" {
  name                      = "${var.queue_name}-dlq"
  message_retention_seconds = 14 * 24 * 60 * 60 # 14 days
  sqs_managed_sse_enabled   = true
  tags                      = var.tags
}

resource "aws_sqs_queue" "this" {
  name                       = var.queue_name
  message_retention_seconds  = 4 * 24 * 60 * 60 # 4 days
  visibility_timeout_seconds = var.consumer_timeout_seconds * 6
  receive_wait_time_seconds  = 20 # long polling
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 5
  })

  tags = var.tags
}

# implementation-blueprint.md line 879: DLQ age alarm at 1h/4h.
resource "aws_cloudwatch_metric_alarm" "dlq_age" {
  alarm_name          = "${var.queue_name}-dlq-age"
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateAgeOfOldestMessage"
  dimensions          = { QueueName = aws_sqs_queue.dlq.name }
  statistic           = "Maximum"
  period              = 300 # 5 minutes
  evaluation_periods  = 1
  threshold           = 3600 # 1 hour, in seconds
  comparison_operator = "GreaterThanThreshold"
  alarm_description   = "ReminderDispatchQueue DLQ has messages older than 1 hour - investigate and redrive per runbook (never blind redrive)."
  treat_missing_data  = "notBreaching"
  tags                = var.tags
}

# Queue ARN constructed deterministically (not read from aws_sqs_queue.this.arn) so the IAM
# policy documents below are plan-time-known and don't depend on the queue resource actually
# existing yet — same pattern as the dynamo-table module. SQS ARN format is stable/documented:
# arn:aws:sqs:<region>:<account>:<queue-name>.
locals {
  queue_arn = "arn:aws:sqs:${var.aws_region}:${var.aws_account_id}:${var.queue_name}"
}

# IAM policy documents mirroring scoped-lambda-function.ts's queueAccessFor() capabilities.
data "aws_iam_policy_document" "consume" {
  statement {
    sid = "ReminderQueueConsume"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
    ]
    resources = [local.queue_arn]
  }
}

data "aws_iam_policy_document" "send" {
  statement {
    sid       = "ReminderQueueSend"
    actions   = ["sqs:SendMessage"]
    resources = [local.queue_arn]
  }
}
