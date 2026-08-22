output "function_name" {
  value = aws_lambda_function.this.function_name
}

output "function_arn" {
  value = aws_lambda_function.this.arn
}

output "invoke_arn" {
  value = aws_lambda_function.this.invoke_arn
}

output "role_arn" {
  value = aws_iam_role.this.arn
}

output "role_name" {
  value = aws_iam_role.this.name
}

# Passthrough of the capability policy documents actually attached to this function's role
# (one aws_iam_role_policy.capabilities per entry, unconditionally - see main.tf). Exposed
# so callers (root-level `terraform test` acceptance suites) can assert on exactly which
# capabilities were wired to which function without needing to address resources inside this
# module directly (module internals aren't addressable from a caller's .tftest.hcl).
output "capability_policy_documents" {
  value = var.policy_documents_json
}

output "reserved_concurrent_executions" {
  value = aws_lambda_function.this.reserved_concurrent_executions
}

# m5-observability-design.md §3: exposed so root-level `terraform test` acceptance suites
# can assert the ADOT layer is attached without addressing this module's internals directly.
output "layers" {
  value = aws_lambda_function.this.layers
}

# Rollback design entrega 1 (docs/architecture/reviews/rollback-mechanism-design/
# codex-round2-final-design.md) — real invokers must use these, never function_arn/invoke_arn
# above directly, so an emergency alias repoint actually changes what gets invoked.
output "published_version" {
  value = aws_lambda_function.this.version
}

output "live_alias_name" {
  value = aws_lambda_alias.live.name
}

output "live_alias_arn" {
  value = aws_lambda_alias.live.arn
}

output "live_alias_invoke_arn" {
  value = aws_lambda_alias.live.invoke_arn
}
