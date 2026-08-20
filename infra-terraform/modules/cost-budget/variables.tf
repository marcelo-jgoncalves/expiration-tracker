# AWS Budgets alarm — Terraform equivalent of infra/lib/cost-budget.ts (ADR-0009).
# aws_budgets_budget is an account/billing resource (not scoped to this stack's own
# resources), same as the CDK construct's AWS::Budgets::Budget.

variable "monthly_limit_usd" {
  description = "Monthly USD ceiling before the alarm fires. Default: 50 (dev/pre-production ceiling, matches the CDK construct's default)."
  type        = number
  default     = 50
}

variable "notification_emails" {
  description = <<-EOT
    Email(s) notified at 80% forecasted and 100% actual spend. If empty, the budget still
    gets created (visible in Billing console) but has no active subscriber - documented gap,
    not silently dropped, until a notification owner is decided (same as the CDK construct).
  EOT
  type        = list(string)
  default     = []
}
