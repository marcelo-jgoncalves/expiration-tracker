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
# general policy document. GSI6 gained a FOURTH consumer in W3-06/D-061: DocumentPurgeWorker
# (alongside ReminderReconciliation/OutboxSweeperReminderDispatch/
# UploadSlotReconciliationWorker) - acknowledged explicitly, not silently expanded.
#
# GSI4 joined this isolation family in Wave B2B-3 of Multi-User B2B (D-08x,
# docs/architecture/multi-user-b2b-physical-model.md §6): previously in the general policy
# but with zero real consumers (data-model.md's old pre-multi-org "membership por usuário"
# documentation was never implemented in code) — harmless while unused, but its NEW
# `MembershipByUser` semantics cross tenants by design (resolves which Organizations a User
# belongs to, given only a userId), so it must never be reachable via the general
# tenant-facing role. `gsi4_read_policy_json` exists now so the isolation is correct from
# the first real Membership write; no Lambda role attaches it yet (Wave B2B-3 doesn't wire
# any consumer) — that attachment happens when Wave B2B-5/B2B-6's BFF/RequestContext/
# onboarding code is built, mirroring gsi3_read/gsi6_read's own attach-when-consumed pattern.

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
  attribute {
    name = "GSI8PK"
    type = "S"
  }
  attribute {
    name = "GSI8SK"
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

  # GSI8 - MaintenanceDueIndex (D-179/D-180). Global PK (no tenantId, sparse), KEYS_ONLY
  # projection - discovery-only for maintenance/purge workers, never a source of eligibility
  # (every consumer revalidates the base item before acting). PK="WORK#<workerType>" or
  # "DLQ#<workerType>" for quarantined poison records; SK="<dueAtIso>#TENANT#<tenantId>#
  # <entityId>", ordered by due date so a Query replaces the Scan+Limit+bounded-pages pattern
  # D-170 confirmed permanently starves candidates past a single run's page cap. Same isolation
  # discipline as GSI3/GSI6: IAM access is per-worker via `dynamodb:LeadingKeys`, never a general
  # "read GSI8" grant (round-1 finding of the approved design - "por índice não é por worker").
  global_secondary_index {
    name            = "GSI8"
    hash_key        = "GSI8PK"
    range_key       = "GSI8SK"
    projection_type = "KEYS_ONLY"
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

  # Resource ARNs for every GSI EXCEPT GSI3/GSI6/GSI4 (data-model.md §3's isolation
  # safeguard, extended to GSI4 in Wave B2B-3 of Multi-User B2B — see comment above).
  # DynamoDB IAM cannot restrict by SK prefix, so grants are table-level per index
  # (documented judgment call, same as the CDK construct's tenantFacingResources()).
  tenant_facing_index_names = ["GSI1", "GSI2", "GSI5", "GSI7"]
  tenant_facing_resources = concat(
    [local.table_arn],
    [for name in local.tenant_facing_index_names : "${local.table_arn}/index/${name}"],
  )
  gsi3_resource = "${local.table_arn}/index/GSI3"
  gsi4_resource = "${local.table_arn}/index/GSI4"
  gsi6_resource = "${local.table_arn}/index/GSI6"
  gsi8_resource = "${local.table_arn}/index/GSI8"

  # GSI8 worker namespaces actually wired to a Lambda role today (D-179/D-180 pilot slice,
  # D-181's invitation_purge slice 2, D-179 slice 3's document_file_reconciliation, D-179 slice
  # 4's requirement_reindex, D-179/D-186 slice 5's quota_telemetry_purge - 5th of 9).
  # Each key gets its own gsi8_read_policy_json[key]/worker_transact_write_policy_json[key]
  # output below, scoped via `dynamodb:LeadingKeys` so one worker's role can never read (or claim)
  # another worker's GSI8/DLQ candidates. Extending this map is how each of the other 4
  # maintenance workers named in D-179 joins the pattern later - never by widening an existing
  # worker's LeadingKeys list.
  gsi8_worker_types = {
    membership_purge             = "MEMBERSHIP_PURGE"
    invitation_purge             = "INVITATION_PURGE"
    document_file_reconciliation = "DOCUMENT_FILE_RECONCILIATION"
    requirement_reindex          = "REQUIREMENT_REINDEX"
    quota_telemetry_purge        = "QUOTA_TELEMETRY"
    security_audit_purge         = "SECURITY_AUDIT"
  }
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
# Exactly four callers are permitted to attach this: ReminderReconciliation,
# OutboxSweeperReminderDispatch (m3.5-runtime-design.md), UploadSlotReconciliationWorker
# (M6 design), and DocumentPurgeWorker (W3-06/D-061).
data "aws_iam_policy_document" "gsi6_read" {
  statement {
    sid       = "Gsi6ReadOnly"
    actions   = ["dynamodb:Query", "dynamodb:GetItem"]
    resources = [local.gsi6_resource]
  }
}

# The ONLY sanctioned way to read GSI4 (`MembershipByUser`, Wave B2B-3 of Multi-User B2B) -
# resource is the GSI4 index ARN exclusively. No caller attaches this yet (Wave B2B-3 adds
# no consumer); future callers are limited to identity-context resolution only (BFF/session
# context, RequestContextResolver, onboarding) — never a general tenant-facing role, per
# docs/architecture/multi-user-b2b-physical-model.md §6.
data "aws_iam_policy_document" "gsi4_read" {
  statement {
    sid       = "Gsi4ReadOnly"
    actions   = ["dynamodb:Query", "dynamodb:GetItem"]
    resources = [local.gsi4_resource]
  }
}

# GSI8 (MaintenanceDueIndex, D-179/D-180) - one policy document per worker in
# `local.gsi8_worker_types`, condition-scoped to that worker's exact WORK#/DLQ# namespace pair
# via `dynamodb:LeadingKeys`. Deliberately `Query` only (never `GetItem`) - every consumer reads
# a due-ordered range, never a single known key. Resource is the GSI8 index ARN exclusively,
# same isolation discipline as gsi3_read/gsi6_read above.
data "aws_iam_policy_document" "gsi8_read" {
  for_each = local.gsi8_worker_types

  statement {
    # IAM Sid must be alpha-numeric only ([0-9A-Za-z]*) - each.key ("membership_purge") carries
    # underscores from the Terraform map key, so the Sid is built from PascalCase-joined segments
    # instead (live CD failure caught this: MalformedPolicyDocument on the first real apply).
    sid       = "Gsi8ReadOnly${join("", [for part in split("_", each.key) : title(part)])}"
    actions   = ["dynamodb:Query"]
    resources = [local.gsi8_resource]

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "dynamodb:LeadingKeys"
      values   = ["WORK#${each.value}", "DLQ#${each.value}"]
    }
  }
}

# `dynamodb:TransactWriteItems` on the base table - a real action gap the approved design found:
# `tenant_facing_read_write` grants Get/Put/Update/Delete/ConditionCheckItem but never
# TransactWriteItems, and this capability is deliberately NOT added to the general policy (only
# the workers that actually need atomic claim/revalidation get it, one policy per worker so a
# future audit can see exactly who holds it). Table-level, not GSI8-scoped - TransactWriteItems
# always targets the base table's own items (ConditionCheck/Delete/Update), never a GSI directly.
data "aws_iam_policy_document" "worker_transact_write" {
  for_each = local.gsi8_worker_types

  statement {
    # Same alpha-numeric-only Sid fix as gsi8_read above.
    sid       = "TransactWriteItems${join("", [for part in split("_", each.key) : title(part)])}"
    actions   = ["dynamodb:TransactWriteItems"]
    resources = [local.table_arn]
  }
}
