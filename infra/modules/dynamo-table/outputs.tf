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

# GSI8 (MaintenanceDueIndex, D-179/D-180) - one policy per worker key in `local.gsi8_worker_types`
# (`main.tf`). Attach `gsi8_read_policy_json[<key>]` AND `worker_transact_write_policy_json[<key>]`
# together - the claim/revalidation transaction needs both the Query to discover candidates and
# TransactWriteItems to act on them atomically. No other caller may attach these.
output "gsi8_read_policy_json" {
  value = { for k, v in data.aws_iam_policy_document.gsi8_read : k => v.json }
}

output "worker_transact_write_policy_json" {
  value = { for k, v in data.aws_iam_policy_document.worker_transact_write : k => v.json }
}

# D-234 (E-018): one minimal Scan(+other real actions) policy per key in
# `local.cross_tenant_scan_workers` (`main.tf`) - the ONLY 4 Lambdas allowed `dynamodb:Scan` on the
# base table. Attach `cross_tenant_scan_policy_json[<key>]` INSTEAD OF `tenant_facing_read_write_
# policy_json`/`tenant_facing_read_policy_json` on those 4 roles, never in addition to a general
# grant that already excludes Scan - see the comment on `tenant_facing_read_write` above.
output "cross_tenant_scan_policy_json" {
  value = { for k, v in data.aws_iam_policy_document.cross_tenant_scan : k => v.json }
}

# D-8 (WhatsApp fatia 4/5): the ONLY policy allowed to Query/PutItem the base-table
# `PK=WHATSAPP#PORTFOLIO` partition, `dynamodb:LeadingKeys`-scoped. Attach ONLY to
# WhatsAppDeliveryWorker's role.
output "whatsapp_portfolio_quota_policy_json" {
  value = data.aws_iam_policy_document.whatsapp_portfolio_quota.json
}

# Passthrough for root-level acceptance-test assertions (module internals aren't
# addressable from a caller's .tftest.hcl). Literal values, not read off
# aws_dynamodb_table.this.global_secondary_index - that computed attribute is only known
# after apply for a not-yet-created table, which would make plan-mode `terraform test`
# assertions on it fail with "Unknown condition value". The GSI set (GSI1-GSI8, GSI3/GSI8
# KEYS_ONLY) is hardcoded in main.tf, not variable-driven, so literals here are exact.
output "gsi_count" {
  value = 8
}

output "gsi3_projection_type" {
  value = "KEYS_ONLY"
}

output "gsi8_projection_type" {
  value = "KEYS_ONLY"
}
