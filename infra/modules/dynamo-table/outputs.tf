output "table_name" {
  value = aws_dynamodb_table.this.name
}

output "table_arn" {
  value = aws_dynamodb_table.this.arn
}

output "stream_arn" {
  value = aws_dynamodb_table.this.stream_arn
}

# General read/write and read-only policy documents — safe to attach to any
# tenant-facing Lambda role. NEVER includes GSI3, GSI4, or GSI6.
output "tenant_facing_read_write_policy_json" {
  value = data.aws_iam_policy_document.tenant_facing_read_write.json
}

output "tenant_facing_read_policy_json" {
  value = data.aws_iam_policy_document.tenant_facing_read.json
}

# Narrow, single-purpose policy documents. Attach gsi3_read only to ReminderProducer's
# role, gsi6_read only to ReminderReconciliation's / OutboxSweeperReminderDispatch's /
# UploadSlotReconciliationWorker's / DocumentPurgeWorker's roles, and gsi4_read only to
# roles that resolve identity context (BFF/session context, RequestContextResolver,
# onboarding — none exist yet, Wave B2B-3 of Multi-User B2B). No other caller may attach these.
output "gsi3_read_policy_json" {
  value = data.aws_iam_policy_document.gsi3_read.json
}

output "gsi4_read_policy_json" {
  value = data.aws_iam_policy_document.gsi4_read.json
}

output "gsi6_read_policy_json" {
  value = data.aws_iam_policy_document.gsi6_read.json
}

# Passthrough for root-level acceptance-test assertions (module internals aren't
# addressable from a caller's .tftest.hcl). Literal values, not read off
# aws_dynamodb_table.this.global_secondary_index - that computed attribute is only known
# after apply for a not-yet-created table, which would make plan-mode `terraform test`
# assertions on it fail with "Unknown condition value". The GSI set (GSI1-GSI7, GSI3
# KEYS_ONLY) is hardcoded in main.tf, not variable-driven, so literals here are exact.
output "gsi_count" {
  value = 7
}

output "gsi3_projection_type" {
  value = "KEYS_ONLY"
}
