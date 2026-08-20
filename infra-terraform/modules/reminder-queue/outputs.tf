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
