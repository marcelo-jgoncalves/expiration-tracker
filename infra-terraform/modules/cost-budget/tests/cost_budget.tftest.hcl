# Recreates the acceptance criteria implied by infra/lib/cost-budget.ts as native
# `terraform test` assertions. mock_provider — no real AWS credentials/resources needed.

mock_provider "aws" {}

run "default_budget_has_fifty_dollar_monthly_ceiling_and_no_subscribers" {
  command = apply

  assert {
    condition     = aws_budgets_budget.monthly_cost.budget_type == "COST"
    error_message = "Budget type must be COST"
  }

  assert {
    condition     = aws_budgets_budget.monthly_cost.time_unit == "MONTHLY"
    error_message = "Budget time unit must be MONTHLY"
  }

  assert {
    condition     = aws_budgets_budget.monthly_cost.limit_amount == "50"
    error_message = "Default monthly limit must be 50 (matches CDK construct's default)"
  }

  assert {
    condition     = aws_budgets_budget.monthly_cost.limit_unit == "USD"
    error_message = "Budget limit unit must be USD"
  }

  assert {
    condition     = length(aws_budgets_budget.monthly_cost.notification) == 0
    error_message = "No notifications should be configured when notification_emails is empty (documented gap, not silently dropped)"
  }
}

run "custom_limit_is_honored" {
  command = apply

  variables {
    monthly_limit_usd = 200
  }

  assert {
    condition     = aws_budgets_budget.monthly_cost.limit_amount == "200"
    error_message = "Custom monthly limit must be honored"
  }
}

run "notifications_created_at_80_forecasted_and_100_actual_when_emails_supplied" {
  command = apply

  variables {
    notification_emails = ["ops@example.com"]
  }

  assert {
    condition     = length(aws_budgets_budget.monthly_cost.notification) == 2
    error_message = "Exactly 2 notifications must exist when subscribers are supplied (80% forecasted + 100% actual)"
  }

  assert {
    condition = anytrue([
      for n in aws_budgets_budget.monthly_cost.notification :
      n.notification_type == "FORECASTED" && n.threshold == 80 && n.comparison_operator == "GREATER_THAN"
    ])
    error_message = "Must have an 80% FORECASTED GREATER_THAN notification"
  }

  assert {
    condition = anytrue([
      for n in aws_budgets_budget.monthly_cost.notification :
      n.notification_type == "ACTUAL" && n.threshold == 100 && n.comparison_operator == "GREATER_THAN"
    ])
    error_message = "Must have a 100% ACTUAL GREATER_THAN notification"
  }

  assert {
    condition = alltrue([
      for n in aws_budgets_budget.monthly_cost.notification :
      contains(n.subscriber_email_addresses, "ops@example.com")
    ])
    error_message = "Every notification must subscribe the supplied email address"
  }
}
