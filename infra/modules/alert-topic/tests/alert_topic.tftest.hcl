# Recreates the acceptance criteria for m5-observability-design.md §4 as native
# `terraform test` assertions. mock_provider - no real AWS credentials/resources needed.

mock_provider "aws" {
  # The default mock_provider computed-attribute generator produces a random string, not a
  # valid ARN, for aws_sns_topic.arn - but aws_sns_topic_subscription.topic_arn validates its
  # input looks like an ARN even under mock_provider (same issue the lambda-function module's
  # aws_iam_role mock override documents). Override just that attribute.
  mock_resource "aws_sns_topic" {
    defaults = {
      arn = "arn:aws:sns:us-east-1:123456789012:mock-topic"
    }
  }
}

run "topic_and_email_subscription_are_wired" {
  command = apply

  variables {
    name_prefix = "exptrk-test"
    alert_email = "ops@example.com"
  }

  assert {
    condition     = aws_sns_topic.this.name == "exptrk-test-alerts"
    error_message = "Topic name must be <name_prefix>-alerts"
  }

  assert {
    condition     = aws_sns_topic_subscription.email.protocol == "email"
    error_message = "Subscription protocol must be email"
  }

  assert {
    condition     = aws_sns_topic_subscription.email.endpoint == "ops@example.com"
    error_message = "Subscription endpoint must be the provided alert_email"
  }
}
