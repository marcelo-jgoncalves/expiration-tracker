output "topic_arn" {
  description = "ARN of the alert SNS topic - pass to alarm_actions on any aws_cloudwatch_metric_alarm."
  value       = aws_sns_topic.this.arn
}

output "subscription_arn" {
  description = "ARN of the e-mail subscription - \"pending confirmation\" until the recipient confirms it."
  value       = aws_sns_topic_subscription.email.arn
}
