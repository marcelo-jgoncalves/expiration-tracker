# GSI3/GSI6 IAM isolation — the single most important invariant in this migration
# (AGENTS.md §7, ADR-0009). Runs against the REAL aws provider in read-only `plan` mode
# (never apply) because aws_iam_policy_document's rendered JSON is fully replaced by an
# opaque mock string under mock_provider — that would make these assertions vacuous. The
# module builds the table ARN deterministically from aws_region/aws_account_id instead of
# reading it off the live resource, so the policy documents are plan-time-known and this
# run never needs to create/modify/destroy anything. Requires AWS credentials (e.g.
# AWS_PROFILE=claude-dev) to initialize the provider, even though no API calls beyond a
# read-only plan of a table that doesn't need to exist are made.

provider "aws" {
  region = "us-east-1"
}

run "tenant_facing_policy_excludes_gsi3_and_gsi6" {
  command = plan

  variables {
    table_name     = "expiration-tracker-test"
    aws_region     = "us-east-1"
    aws_account_id = "123456789012"
  }

  assert {
    condition     = !strcontains(data.aws_iam_policy_document.tenant_facing_read_write.json, "/index/GSI3")
    error_message = "General read/write policy must NEVER reference GSI3"
  }

  assert {
    condition     = !strcontains(data.aws_iam_policy_document.tenant_facing_read_write.json, "/index/GSI6")
    error_message = "General read/write policy must NEVER reference GSI6"
  }

  assert {
    condition     = !strcontains(data.aws_iam_policy_document.tenant_facing_read.json, "/index/GSI3")
    error_message = "General read-only policy must NEVER reference GSI3"
  }

  assert {
    condition     = !strcontains(data.aws_iam_policy_document.tenant_facing_read.json, "/index/GSI6")
    error_message = "General read-only policy must NEVER reference GSI6"
  }

  assert {
    condition     = strcontains(data.aws_iam_policy_document.tenant_facing_read_write.json, "arn:aws:dynamodb:us-east-1:123456789012:table/expiration-tracker-test/index/GSI1")
    error_message = "Sanity check: general policy must still reference GSI1 (proves the assertion isn't vacuously true)"
  }
}

# GSI4 isolation — Wave B2B-3 of Multi-User B2B (docs/architecture/multi-user-b2b-physical-
# model.md §6). GSI4 previously sat in the general tenant-facing policy with zero real
# consumers (harmless while unused); this proves it is now excluded before any real
# Membership write can occur, same discipline as GSI3/GSI6 above.
run "tenant_facing_policy_excludes_gsi4" {
  command = plan

  variables {
    table_name     = "expiration-tracker-test"
    aws_region     = "us-east-1"
    aws_account_id = "123456789012"
  }

  assert {
    condition     = !strcontains(data.aws_iam_policy_document.tenant_facing_read_write.json, "/index/GSI4")
    error_message = "General read/write policy must NEVER reference GSI4"
  }

  assert {
    condition     = !strcontains(data.aws_iam_policy_document.tenant_facing_read.json, "/index/GSI4")
    error_message = "General read-only policy must NEVER reference GSI4"
  }
}

run "gsi4_narrow_policy_references_only_its_own_index" {
  command = plan

  variables {
    table_name     = "expiration-tracker-test"
    aws_region     = "us-east-1"
    aws_account_id = "123456789012"
  }

  assert {
    condition     = strcontains(data.aws_iam_policy_document.gsi4_read.json, "/index/GSI4")
    error_message = "gsi4_read policy must reference GSI4"
  }

  assert {
    condition     = !strcontains(data.aws_iam_policy_document.gsi4_read.json, "/index/GSI3")
    error_message = "gsi4_read policy must NOT reference GSI3"
  }

  assert {
    condition     = !strcontains(data.aws_iam_policy_document.gsi4_read.json, "/index/GSI6")
    error_message = "gsi4_read policy must NOT reference GSI6"
  }
}

run "gsi3_and_gsi6_narrow_policies_reference_only_their_own_index" {
  command = plan

  variables {
    table_name     = "expiration-tracker-test"
    aws_region     = "us-east-1"
    aws_account_id = "123456789012"
  }

  assert {
    condition     = strcontains(data.aws_iam_policy_document.gsi3_read.json, "/index/GSI3")
    error_message = "gsi3_read policy must reference GSI3"
  }

  assert {
    condition     = !strcontains(data.aws_iam_policy_document.gsi3_read.json, "/index/GSI6")
    error_message = "gsi3_read policy must NOT reference GSI6"
  }

  assert {
    condition     = strcontains(data.aws_iam_policy_document.gsi6_read.json, "/index/GSI6")
    error_message = "gsi6_read policy must reference GSI6"
  }

  assert {
    condition     = !strcontains(data.aws_iam_policy_document.gsi6_read.json, "/index/GSI3")
    error_message = "gsi6_read policy must NOT reference GSI3"
  }
}
