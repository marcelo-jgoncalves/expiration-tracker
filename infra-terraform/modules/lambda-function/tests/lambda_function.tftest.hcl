# Recreates the acceptance criteria implied by infra/lib/scoped-lambda-function.ts as native
# `terraform test` assertions. The "aws" provider is mocked (no real credentials/resources
# needed or created — see ADR-0009 and the repo's hard rule against `terraform apply` against
# real AWS; this mocked apply never touches AWS at all). The "archive" provider is real but
# only ever zips a local fixture directory on disk — no network/AWS calls.

mock_provider "aws" {
  # The default mock_provider computed-attribute generator produces a random string, not a
  # valid ARN, for aws_iam_role.arn — but aws_lambda_function.role validates its input looks
  # like an ARN even under mock_provider. Override just that attribute with a realistic value.
  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::123456789012:role/mock-role"
    }
  }
}

run "grants_exactly_the_capabilities_passed_in" {
  command = apply

  variables {
    function_name = "expiration-tracker-test-fn"
    handler_name   = "dummy-handler"
    source_dir     = "tests/fixtures/dummy-handler"
    policy_documents_json = [
      jsonencode({
        Version = "2012-10-17"
        Statement = [
          {
            Sid      = "OnlyThisStatement"
            Effect   = "Allow"
            Action   = ["dynamodb:GetItem"]
            Resource = ["arn:aws:dynamodb:us-east-1:123456789012:table/expiration-tracker-test"]
          }
        ]
      })
    ]
  }

  # Exactly one caller-supplied capability policy attached — nothing table-wide by default.
  assert {
    condition     = length(aws_iam_role_policy.capabilities) == 1
    error_message = "Expected exactly one capability policy (one entry in policy_documents_json)"
  }

  assert {
    condition     = strcontains(aws_iam_role_policy.capabilities[0].policy, "dynamodb:GetItem")
    error_message = "Capability policy must contain the passed-in statement's action"
  }

  assert {
    condition     = !strcontains(aws_iam_role_policy.capabilities[0].policy, "dynamodb:PutItem")
    error_message = "Capability policy must NOT contain actions that were never passed in"
  }

  # Basic execution + X-Ray managed policies always attached (mirrors CDK's automatic grants).
  assert {
    condition     = aws_iam_role_policy_attachment.basic_execution.policy_arn == "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
    error_message = "Basic execution role policy must always be attached"
  }

  assert {
    condition     = length(aws_iam_role_policy_attachment.xray) == 1
    error_message = "X-Ray policy must be attached when tracing_active is true (default)"
  }

  assert {
    condition     = aws_lambda_function.this.runtime == "nodejs20.x"
    error_message = "Default runtime must be nodejs20.x"
  }

  assert {
    condition     = aws_lambda_function.this.handler == "index.handler"
    error_message = "Handler must be index.handler"
  }

  assert {
    condition     = aws_lambda_function.this.timeout == 10
    error_message = "Default timeout must be 10 seconds (CDK default)"
  }

  assert {
    condition     = aws_lambda_function.this.memory_size == 256
    error_message = "Default memory must be 256 MB (CDK default)"
  }

  assert {
    condition     = aws_lambda_function.this.tracing_config[0].mode == "Active"
    error_message = "X-Ray tracing must be Active by default"
  }
}

run "no_capabilities_means_no_capability_policies" {
  command = apply

  variables {
    function_name = "expiration-tracker-test-fn-nopolicy"
    handler_name   = "dummy-handler"
    source_dir     = "tests/fixtures/dummy-handler"
  }

  assert {
    condition     = length(aws_iam_role_policy.capabilities) == 0
    error_message = "No capability policies should exist when policy_documents_json is empty"
  }
}

run "tracing_can_be_disabled" {
  command = apply

  variables {
    function_name  = "expiration-tracker-test-fn-notrace"
    handler_name    = "dummy-handler"
    source_dir      = "tests/fixtures/dummy-handler"
    tracing_active  = false
  }

  assert {
    condition     = length(aws_iam_role_policy_attachment.xray) == 0
    error_message = "X-Ray policy must not be attached when tracing_active is false"
  }

  assert {
    condition     = length(aws_lambda_function.this.tracing_config) == 0
    error_message = "tracing_config block must be absent when tracing_active is false"
  }
}
