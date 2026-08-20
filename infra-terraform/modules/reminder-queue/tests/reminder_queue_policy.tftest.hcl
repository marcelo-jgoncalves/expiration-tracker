# Consume/send IAM policy document content — runs against the REAL aws provider in
# read-only `plan` mode (never apply), same reason as dynamo-table's policy test:
# aws_iam_policy_document's rendered JSON is replaced by an opaque mock string under
# mock_provider, which would make these content assertions vacuous. Requires AWS
# credentials (e.g. AWS_PROFILE=claude-dev) to initialize the provider, but creates/
# modifies/destroys nothing.

provider "aws" {
  region = "us-east-1"
}

run "consume_and_send_policies_are_scoped_correctly" {
  command = plan

  variables {
    queue_name     = "expiration-tracker-test-reminder-dispatch-policy"
    aws_region     = "us-east-1"
    aws_account_id = "123456789012"
  }

  assert {
    condition     = strcontains(data.aws_iam_policy_document.consume.json, "sqs:ReceiveMessage")
    error_message = "Consume policy must grant sqs:ReceiveMessage"
  }

  assert {
    condition     = strcontains(data.aws_iam_policy_document.consume.json, "sqs:DeleteMessage")
    error_message = "Consume policy must grant sqs:DeleteMessage"
  }

  assert {
    condition     = strcontains(data.aws_iam_policy_document.consume.json, "sqs:GetQueueAttributes")
    error_message = "Consume policy must grant sqs:GetQueueAttributes"
  }

  assert {
    condition     = !strcontains(data.aws_iam_policy_document.consume.json, "sqs:SendMessage")
    error_message = "Consume policy must NOT grant sqs:SendMessage"
  }

  assert {
    condition     = strcontains(data.aws_iam_policy_document.send.json, "sqs:SendMessage")
    error_message = "Send policy must grant sqs:SendMessage"
  }

  assert {
    condition     = !strcontains(data.aws_iam_policy_document.send.json, "sqs:ReceiveMessage")
    error_message = "Send policy must NOT grant sqs:ReceiveMessage"
  }
}
