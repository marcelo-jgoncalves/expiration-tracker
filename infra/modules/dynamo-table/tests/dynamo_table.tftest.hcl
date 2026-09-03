# Recreates the acceptance criteria from test/infra/stack.test.ts (originally 6-GSI,
# 7 after GSI7 - M9, D-036 -, 8 after GSI8 - D-179/D-180 MaintenanceDueIndex -, now 9 after
# GSI9 - D-193, GSI_EVIDENCE - / KEYS_ONLY-projection test) as native `terraform test`
# assertions. Uses a mocked AWS
# provider (no real credentials/resources needed or created — see ADR-0009 and the repo's
# hard rule against `terraform apply` against real AWS; this mocked apply never touches
# AWS at all).
#
# The GSI3/GSI6 IAM isolation assertions (the highest-risk invariant) live in
# dynamo_table_policy.tftest.hcl instead, because aws_iam_policy_document's rendered JSON
# is itself replaced by an opaque mock value under mock_provider, so it must run against
# the real (unmocked) provider in read-only `plan` mode.

mock_provider "aws" {}

run "creates_one_table_with_nine_gsis" {
  # command = apply here (not plan): with the mocked provider, the
  # global_secondary_index set's identity can't be resolved from an unapplied plan alone.
  # mock_provider means no real AWS resources are ever created — safe, same as `terraform
  # test`'s other ephemeral ad-hoc plans (see infra task brief / repo safety rule).
  command = apply

  variables {
    table_name     = "expiration-tracker-test"
    aws_region     = "us-east-1"
    aws_account_id = "123456789012"
  }

  assert {
    condition     = length(aws_dynamodb_table.this.global_secondary_index) == 9
    error_message = "Expected exactly 9 GSIs on the table"
  }

  assert {
    condition     = aws_dynamodb_table.this.billing_mode == "PAY_PER_REQUEST"
    error_message = "Table must use on-demand billing (D-014)"
  }

  assert {
    condition     = aws_dynamodb_table.this.point_in_time_recovery[0].enabled == true
    error_message = "PITR must be enabled"
  }

  assert {
    condition     = aws_dynamodb_table.this.stream_view_type == "NEW_IMAGE"
    error_message = "Stream must be NEW_IMAGE"
  }

  assert {
    condition     = aws_dynamodb_table.this.ttl[0].attribute_name == "purgeAfterTtl"
    error_message = "TTL attribute must be purgeAfterTtl"
  }
}

run "gsi3_has_global_key_shape_and_keys_only_projection" {
  command = apply

  variables {
    table_name     = "expiration-tracker-test"
    aws_region     = "us-east-1"
    aws_account_id = "123456789012"
  }

  assert {
    condition = anytrue([
      for gsi in aws_dynamodb_table.this.global_secondary_index :
      gsi.name == "GSI3" && gsi.projection_type == "KEYS_ONLY" && gsi.hash_key == "GSI3PK"
    ])
    error_message = "GSI3 must exist with KEYS_ONLY projection and GSI3PK hash key"
  }
}

run "gsi9_has_all_projection_for_evidence_reverse_lookup" {
  command = apply

  variables {
    table_name     = "expiration-tracker-test"
    aws_region     = "us-east-1"
    aws_account_id = "123456789012"
  }

  assert {
    condition = anytrue([
      for gsi in aws_dynamodb_table.this.global_secondary_index :
      gsi.name == "GSI9" && gsi.projection_type == "ALL" && gsi.hash_key == "GSI9PK" && gsi.range_key == "GSI9SK"
    ])
    error_message = "GSI9 (GSI_EVIDENCE, D-193) must exist with ALL projection and GSI9PK/GSI9SK key shape"
  }
}
