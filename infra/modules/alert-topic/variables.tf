# SNS -> e-mail alert destination (m5-observability-design.md §4). One topic per
# environment; every existing/future aws_cloudwatch_metric_alarm gets alarm_actions wired to
# this topic's ARN rather than each alarm managing its own notification target.

variable "name_prefix" {
  description = "Prefix for the SNS topic name."
  type        = string
}

variable "alert_email" {
  description = <<-EOT
    E-mail address that receives operational alerts (alarm state changes). No default -
    same fail-fast rationale as ses_from_address: an unconfirmed/placeholder subscription
    would silently deploy an alerting pipeline that notifies nobody. Note (§4, real finding):
    `terraform apply` creates the subscription in PendingConfirmation state - the recipient
    must click the AWS confirmation e-mail before alerts actually deliver. This is a real
    manual step, not closed by Terraform - see NEXT_SESSION_PROMPT.md for the milestone's
    acceptance criterion on this.
  EOT
  type        = string
}

variable "tags" {
  description = "Tags applied to the SNS topic."
  type        = map(string)
  default     = {}
}
