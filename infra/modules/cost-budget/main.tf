# AWS Budgets alarm — Terraform equivalent of infra/lib/cost-budget.ts. Threshold is a
# judgment call proportional to this stage (no production traffic yet) - a low fixed
# monthly ceiling meant to catch runaway cost early, not to model real unit economics.
# Revisit once real traffic/cost data exists.

resource "aws_budgets_budget" "monthly_cost" {
  name         = var.name
  budget_type  = "COST"
  time_unit    = "MONTHLY"
  limit_amount = tostring(var.monthly_limit_usd)
  limit_unit   = "USD"

  dynamic "notification" {
    for_each = length(var.notification_emails) > 0 ? [1] : []
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = 80
      threshold_type             = "PERCENTAGE"
      notification_type          = "FORECASTED"
      subscriber_email_addresses = var.notification_emails
    }
  }

  dynamic "notification" {
    for_each = length(var.notification_emails) > 0 ? [1] : []
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = 100
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = var.notification_emails
    }
  }
}
