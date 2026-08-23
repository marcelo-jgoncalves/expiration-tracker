# Single-table DynamoDB module — Terraform equivalent of infra/lib/dynamo-table.ts
# (ADR-0009). GSI1-GSI6, PITR, AWS-managed encryption, DynamoDB Streams (NEW_IMAGE),
# TTL attribute purgeAfterTtl.
#
# GSI3 and GSI6 isolation (data-model.md §3, AGENTS.md §7): these two indexes are
# deliberately EXCLUDED from `tenant_facing_policy_json` (the general read/write policy
# document). They are exposed only via `gsi3_read_policy_json` / `gsi6_read_policy_json`
# outputs, which callers must attach explicitly only to the roles that need them
# (ReminderProducer for GSI3; ReminderReconciliation and OutboxSweeperReminderDispatch for
# GSI6). This mirrors the CDK construct's `grantGsi3ReadTo`/`grantGsi6ReadTo` methods and
# is the single most important invariant in this migration — do not add GSI3/GSI6 to the
# general policy document.

resource "aws_dynamodb_table" "this" {
  name         = var.table_name
  billing_mode = "PAY_PER_REQUEST" # D-014: on-demand
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }
  attribute {
    name = "SK"
    type = "S"
  }
  attribute {
    name = "GSI1PK"
    type = "S"
  }
  attribute {
    name = "GSI1SK"
    type = "S"
  }
  attribute {
    name = "GSI2PK"
    type = "S"
  }
  attribute {
    name = "GSI2SK"
    type = "S"
  }
  attribute {
    name = "GSI3PK"
    type = "S"
  }
  attribute {
    name = "GSI3SK"
    type = "S"
  }
  attribute {
    name = "GSI4PK"
    type = "S"
  }
  attribute {
    name = "GSI4SK"
    type = "S"
  }
  attribute {
    name = "GSI5PK"
    type = "S"
  }
  attribute {
    name = "GSI5SK"
    type = "S"
  }
  attribute {
    name = "GSI6PK"
    type = "S"
  }
  attribute {
    name = "GSI6SK"
    type = "S"
  }
  attribute {
    name = "GSI7PK"
    type = "S"
  }
  attribute {
    name = "GSI7SK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "GSI2"
    hash_key        = "GSI2PK"
    range_key       = "GSI2SK"
    projection_type = "ALL"
  }

  # GSI3 - scheduler. Global PK (no tenantId), IAM-restricted to ReminderProducer only.
  # KEYS_ONLY: minimal projection, no business content (data-model.md §3).
  global_secondary_index {
    name            = "GSI3"
    hash_key        = "GSI3PK"
    range_key       = "GSI3SK"
    projection_type = "KEYS_ONLY"
  }

  global_secondary_index {
    name            = "GSI4"
    hash_key        = "GSI4PK"
    range_key       = "GSI4SK"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "GSI5"
    hash_key        = "GSI5PK"
    range_key       = "GSI5SK"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "GSI6"
    hash_key        = "GSI6PK"
    range_key       = "GSI6SK"
    projection_type = "ALL"
  }

  # GSI7 - listagem de TrackedSubject por status/tipo/nome (M9, D-036,
  # 03-domain-model-tracked-subject-requirement.md). Tenant-scoped (nao e exceção
  # tenantless como GSI3/GSI6) - entra na politica geral de leitura/escrita abaixo.
  global_secondary_index {
    name            = "GSI7"
    hash_key        = "GSI7PK"
    range_key       = "GSI7SK"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true # AWS-managed key (default), CMK upgrade tracked as infra follow-up
  }

  ttl {
    attribute_name = "purgeAfterTtl"
    enabled        = true
  }

  stream_enabled   = true
  stream_view_type = "NEW_IMAGE"

  tags = var.tags
}

locals {
  # Table ARN is constructed deterministically (not read from aws_dynamodb_table.this.arn)
  # so that the IAM policy documents below are plan-time-known and don't depend on the
  # table resource actually existing yet — this keeps them independently testable via
  # `terraform test` without requiring `apply` against real AWS. DynamoDB ARN format is
  # stable/documented: arn:aws:dynamodb:<region>:<account>:table/<name>.
  table_arn = "arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/${var.table_name}"

  # Resource ARNs for every GSI EXCEPT GSI3/GSI6 (data-model.md §3's isolation safeguard).
  # DynamoDB IAM cannot restrict by SK prefix, so grants are table-level per index
  # (documented judgment call, same as the CDK construct's tenantFacingResources()).
  tenant_facing_index_names = ["GSI1", "GSI2", "GSI4", "GSI5", "GSI7"]
  tenant_facing_resources = concat(
    [local.table_arn],
    [for name in local.tenant_facing_index_names : "${local.table_arn}/index/${name}"],
  )
  gsi3_resource = "${local.table_arn}/index/GSI3"
  gsi6_resource = "${local.table_arn}/index/GSI6"
}

# General read/write policy on the base table + GSI1/GSI2/GSI4/GSI5 (tenant-scoped
# indexes). Never includes GSI3/GSI6 — see locals above.
data "aws_iam_policy_document" "tenant_facing_read_write" {
  statement {
    sid = "TenantFacingReadWrite"
    actions = [
      "dynamodb:BatchGetItem",
      "dynamodb:GetItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:BatchWriteItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:ConditionCheckItem",
      "dynamodb:DescribeTable",
    ]
    resources = local.tenant_facing_resources
  }
}

data "aws_iam_policy_document" "tenant_facing_read" {
  statement {
    sid = "TenantFacingRead"
    actions = [
      "dynamodb:BatchGetItem",
      "dynamodb:GetItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:DescribeTable",
    ]
    resources = local.tenant_facing_resources
  }
}

# The ONLY sanctioned way to read GSI3 - resource is the GSI3 index ARN exclusively
# (never the table or any other index), intended solely for the M3 ReminderProducer.
data "aws_iam_policy_document" "gsi3_read" {
  statement {
    sid       = "Gsi3ReadOnly"
    actions   = ["dynamodb:Query", "dynamodb:GetItem"]
    resources = [local.gsi3_resource]
  }
}

# The ONLY sanctioned way to read GSI6 - resource is the GSI6 index ARN exclusively.
# Exactly two callers are permitted to attach this: ReminderReconciliation and
# OutboxSweeperReminderDispatch (m3.5-runtime-design.md).
data "aws_iam_policy_document" "gsi6_read" {
  statement {
    sid       = "Gsi6ReadOnly"
    actions   = ["dynamodb:Query", "dynamodb:GetItem"]
    resources = [local.gsi6_resource]
  }
}
