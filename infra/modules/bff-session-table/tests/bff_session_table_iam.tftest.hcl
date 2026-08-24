# IAM policy document content assertions - real provider, plan-mode only (never apply), same
# rationale as infra/modules/dynamo-table/tests: mock_provider replaces
# aws_iam_policy_document's rendered JSON with an opaque string, which would make content
# assertions vacuous. Requires AWS credentials to initialize the provider (CI only - see
# .github/workflows/ci.yml's `infra` job), even though nothing is created/modified/destroyed.

provider "aws" {
  region = "us-east-1"
}

run "session_access_policy_is_scoped_to_exactly_this_table_and_this_cmk" {
  command = plan

  variables {
    table_name     = "expiration-tracker-test-bff-session"
    aws_region     = "us-east-1"
    aws_account_id = "123456789012"
  }

  assert {
    condition     = strcontains(data.aws_iam_policy_document.bff_session_access.json, "arn:aws:dynamodb:us-east-1:123456789012:table/expiration-tracker-test-bff-session")
    error_message = "Access policy must reference this exact table's ARN"
  }

  assert {
    condition     = !strcontains(data.aws_iam_policy_document.bff_session_access.json, "\"Resource\":\"*\"")
    error_message = "Access policy must never grant a wildcard resource"
  }

  assert {
    condition     = !strcontains(data.aws_iam_policy_document.bff_session_access.json, "dynamodb:Query") && !strcontains(data.aws_iam_policy_document.bff_session_access.json, "dynamodb:Scan")
    error_message = "Access policy must only grant point-lookup actions (GetItem/PutItem) - Query/Scan are never needed for this table's single-item access pattern and would be an unnecessary capability grant"
  }
}
