# One SNS topic per environment + one e-mail subscription (m5-observability-design.md §4).
# Rejected: Slack/PagerDuty - no vendor/webhook contracted for either at this stage; e-mail
# is the smallest surface that closes the real "alarms exist but nobody is notified" gap.
# Migrating to Slack/PagerDuty later is additive (another subscription on this same topic),
# not a redesign.

resource "aws_sns_topic" "this" {
  name = "${var.name_prefix}-alerts"
  tags = var.tags
}

# Stays PendingConfirmation until the recipient clicks the AWS confirmation e-mail -
# Terraform cannot confirm this on the operator's behalf (§4 "Confirmação da subscription é
# um passo manual real"). A green `terraform apply` here does NOT mean alerts are deliverable
# yet - see this module's variables.tf and NEXT_SESSION_PROMPT.md for the milestone's
# explicit acceptance criterion on confirming it.
resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.this.arn
  protocol  = "email"
  endpoint  = var.alert_email
}
