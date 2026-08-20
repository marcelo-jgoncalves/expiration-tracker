# Recreates the acceptance criteria from test/infra/stack.test.ts (6-GSI /
# KEYS_ONLY-projection test) as native `terraform test` assertions. Uses a mocked AWS
# provider (no real credentials/resources needed or created — see ADR-0009 and the repo's
# hard rule against `terraform apply` against real AWS; this mocked apply never touches
# AWS at all).
#
# The GSI3/GSI6 IAM isolation assertions (the highest-risk invariant) live in
# dynamo_table_policy.tftest.hcl instead, because aws_iam_policy_document's rendered JSON
# is itself replaced by an opaque mock value under mock_provider, so it must run against
# the real (unmocked) provider in read-only `plan` mode.

mock_provider "aws" {}

run "creates_one_table_with_six_gsis" {
  # command = apply here (not plan): with the mocked provider, the
  # global_secondary_index set's identity can't be resolved from an unapplied plan alone.
  # mock_provider means no real AWS resources are ever created — safe, same as `terraform
  # test`'s other ephemeral ad-hoc plans (see infra-terraform task brief / repo safety rule).
  command = apply

  variables {
    table_name     = "expiration-tracker-test"
    aws_region     = "us-east-1"
    aws_account_id = "123456789012"
  }

  assert {
    condition     = length(aws_dynamodb_table.this.global_secondary_index) == 6
    error_message = "Expected exactly 6 GSIs on the table"
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
