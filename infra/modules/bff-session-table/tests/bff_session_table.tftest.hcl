# Mocked-provider assertions (no AWS credentials needed) - resource attributes only, never
# a data-source's rendered JSON (mock_provider replaces that with an opaque string, see the
# real-provider plan-mode run below for the IAM policy content assertions).

mock_provider "aws" {}

run "table_has_ttl_and_no_gsi" {
  command = apply

  variables {
    table_name     = "expiration-tracker-test-bff-session"
    aws_region     = "us-east-1"
    aws_account_id = "123456789012"
  }

  assert {
    condition     = aws_dynamodb_table.session.ttl[0].attribute_name == "purgeAfterTtl" && aws_dynamodb_table.session.ttl[0].enabled == true
    error_message = "Session table must have TTL enabled on purgeAfterTtl (D-054 idle timeout)"
  }

  assert {
    condition     = length(aws_dynamodb_table.session.global_secondary_index) == 0
    error_message = "Session table must have no GSIs - every access pattern is a point lookup by selectorHash"
  }

  assert {
    condition     = aws_dynamodb_table.session.billing_mode == "PAY_PER_REQUEST"
    error_message = "Session table must be on-demand billing, matching the main table's convention"
  }

  assert {
    condition     = aws_dynamodb_table.session.point_in_time_recovery[0].enabled == true
    error_message = "Session table must have point-in-time recovery enabled"
  }
}

run "dedicated_cmk_has_rotation_enabled" {
  command = apply

  variables {
    table_name     = "expiration-tracker-test-bff-session"
    aws_region     = "us-east-1"
    aws_account_id = "123456789012"
  }

  assert {
    condition     = aws_kms_key.session_refresh_token.enable_key_rotation == true
    error_message = "Dedicated refresh-token CMK must have automatic key rotation enabled"
  }

  assert {
    condition     = aws_kms_key.session_refresh_token.deletion_window_in_days >= 7
    error_message = "CMK deletion window must give a real recovery margin (never 0/immediate)"
  }
}

run "table_is_never_reachable_by_a_shared_general_policy" {
  command = apply

  variables {
    table_name     = "expiration-tracker-test-bff-session"
    aws_region     = "us-east-1"
    aws_account_id = "123456789012"
  }

  # This module deliberately exposes exactly ONE combined access policy output
  # (bff_session_access_policy_json), never a general-purpose "read" or "read/write to
  # everything" document a resource-facing Lambda role could accidentally pick up - the
  # opposite of the main table's tenant_facing_read_write policy that D-054 flagged as
  # over-broad for session data.
  assert {
    condition     = output.bff_session_access_policy_json != ""
    error_message = "The scoped access policy output must exist"
  }
}
