output "budget_id" {
  value = aws_budgets_budget.monthly_cost.id
}

output "budget_arn" {
  value = aws_budgets_budget.monthly_cost.arn
}

# Passthrough for root-level acceptance-test assertions (module internals aren't
# addressable from a caller's .tftest.hcl).
output "time_unit" {
  value = aws_budgets_budget.monthly_cost.time_unit
}

output "limit_unit" {
  value = aws_budgets_budget.monthly_cost.limit_unit
}

output "limit_amount" {
  value = aws_budgets_budget.monthly_cost.limit_amount
}
