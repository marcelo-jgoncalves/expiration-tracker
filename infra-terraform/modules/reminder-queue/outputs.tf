output "queue_url" {
  value = aws_sqs_queue.this.url
}

output "queue_arn" {
  value = aws_sqs_queue.this.arn
}

output "queue_name" {
  value = aws_sqs_queue.this.name
}

output "dlq_url" {
  value = aws_sqs_queue.dlq.url
}

output "dlq_arn" {
  value = aws_sqs_queue.dlq.arn
}

# Attach consume_policy_json to ReminderDispatch's role; send_policy_json to
# DispatchOutboxRelay/OutboxSweeperReminderDispatch's roles (relay/sweeper capability
# pattern from scoped-lambda-function.ts's queueAccessFor()).
output "consume_policy_json" {
  value = data.aws_iam_policy_document.consume.json
}

output "send_policy_json" {
  value = data.aws_iam_policy_document.send.json
}

# Passthrough for root-level acceptance-test assertions (module internals aren't
# addressable from a caller's .tftest.hcl).
# A literal 5, not decoded from aws_sqs_queue.this.redrive_policy - that JSON string also
# embeds the DLQ's live ARN (aws_sqs_queue.dlq.arn), which is only known after apply, which
# would make this output (and any plan-mode `terraform test` assertion on it) unknown too.
output "dlq_max_receive_count" {
  value = 5
}

output "dlq_age_alarm_name" {
  value = aws_cloudwatch_metric_alarm.dlq_age.alarm_name
}

output "dlq_age_alarm_threshold" {
  value = aws_cloudwatch_metric_alarm.dlq_age.threshold
}
