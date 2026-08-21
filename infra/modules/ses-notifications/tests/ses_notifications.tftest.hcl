# Recreates the acceptance criteria for the SES Configuration Set -> SNS -> SQS wiring
# (docs/architecture/m4-notification-engine-design.md §11.1) as native `terraform test`
# assertions.

run "configuration_set_publishes_delivery_bounce_complaint_to_sns" {
  command = plan

  variables {
    name_prefix        = "expiration-tracker-test"
    callback_queue_arn = "arn:aws:sqs:us-east-1:123456789012:expiration-tracker-test-ses-callback"
    aws_region         = "us-east-1"
    aws_account_id     = "123456789012"
  }

  assert {
    condition     = length(aws_sesv2_configuration_set_event_destination.sns.event_destination[0].matching_event_types) == 3
    error_message = "Configuration Set must forward exactly DELIVERY, BOUNCE and COMPLAINT"
  }

  assert {
    condition = alltrue([
      contains(aws_sesv2_configuration_set_event_destination.sns.event_destination[0].matching_event_types, "DELIVERY"),
      contains(aws_sesv2_configuration_set_event_destination.sns.event_destination[0].matching_event_types, "BOUNCE"),
      contains(aws_sesv2_configuration_set_event_destination.sns.event_destination[0].matching_event_types, "COMPLAINT"),
    ])
    error_message = "Missing one of DELIVERY/BOUNCE/COMPLAINT"
  }

  assert {
    condition     = aws_sns_topic_subscription.callback_queue.protocol == "sqs"
    error_message = "SNS topic must subscribe the callback queue via SQS protocol"
  }
}

run "queue_policy_scoped_to_exact_topic_arn_never_wildcard" {
  command = plan

  variables {
    name_prefix        = "expiration-tracker-test"
    callback_queue_arn = "arn:aws:sqs:us-east-1:123456789012:expiration-tracker-test-ses-callback"
    aws_region         = "us-east-1"
    aws_account_id     = "123456789012"
  }

  assert {
    condition     = strcontains(data.aws_iam_policy_document.sns_to_queue.json, "arn:aws:sns:us-east-1:123456789012:expiration-tracker-test-ses-events")
    error_message = "Queue policy must scope SourceArn to the exact SES events topic ARN"
  }

  assert {
    condition     = !strcontains(data.aws_iam_policy_document.sns_to_queue.json, "\"*\"")
    error_message = "Queue policy must never use a wildcard principal or resource"
  }
}
