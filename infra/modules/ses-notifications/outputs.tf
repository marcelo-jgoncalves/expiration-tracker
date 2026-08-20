output "configuration_set_name" {
  value = aws_sesv2_configuration_set.this.configuration_set_name
}

output "topic_arn" {
  value = aws_sns_topic.ses_events.arn
}

# The caller (root main.tf) attaches this as an aws_sqs_queue_policy on the callback queue -
# this module doesn't own that queue resource (it's created by the sqs-worker-queue module
# instance the caller wires separately), so it can only hand back the policy document.
output "queue_policy_json" {
  value = data.aws_iam_policy_document.sns_to_queue.json
}
