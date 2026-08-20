output "budget_id" {
  value = aws_budgets_budget.monthly_cost.id
}

output "budget_arn" {
  value = aws_budgets_budget.monthly_cost.arn
}
