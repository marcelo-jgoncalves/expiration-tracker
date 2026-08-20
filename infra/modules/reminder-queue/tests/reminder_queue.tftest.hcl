# Recreates the acceptance criteria implied by infra/lib/reminder-queue.ts as native
# `terraform test` assertions. mock_provider — no real AWS credentials/resources needed.

mock_provider "aws" {}

variables {
  aws_region     = "us-east-1"
  aws_account_id = "123456789012"
}

run "dlq_wiring_and_max_receive_count" {
  command = apply

  variables {
    queue_name = "expiration-tracker-test-reminder-dispatch"
  }

  assert {
    condition     = strcontains(aws_sqs_queue.this.redrive_policy, "\"maxReceiveCount\":5")
    error_message = "Main queue's redrive policy must set maxReceiveCount to 5"
  }

  assert {
    condition     = strcontains(aws_sqs_queue.this.redrive_policy, "deadLetterTargetArn")
    error_message = "Main queue's redrive policy must target the DLQ"
  }

  assert {
    condition     = aws_sqs_queue.dlq.message_retention_seconds == 1209600
    error_message = "DLQ retention must be 14 days (1209600s)"
  }

  assert {
    condition     = aws_sqs_queue.this.message_retention_seconds == 345600
    error_message = "Main queue retention must be 4 days (345600s)"
  }

  assert {
    condition     = aws_sqs_queue.this.receive_wait_time_seconds == 20
    error_message = "Main queue must use long polling (20s wait time)"
  }

  # Default consumer_timeout_seconds = 10 -> visibility timeout = 60 (6x rule).
  assert {
    condition     = aws_sqs_queue.this.visibility_timeout_seconds == 60
    error_message = "Visibility timeout must be 6x the consumer timeout (default 10s -> 60s)"
  }
}

run "visibility_timeout_scales_with_consumer_timeout" {
  command = apply

  variables {
    queue_name               = "expiration-tracker-test-reminder-dispatch-2"
    consumer_timeout_seconds = 30
  }

  assert {
    condition     = aws_sqs_queue.this.visibility_timeout_seconds == 180
    error_message = "Visibility timeout must be 6x a non-default consumer timeout (30s -> 180s)"
  }
}

run "dlq_age_alarm_exists_with_one_hour_threshold" {
  command = apply

  variables {
    queue_name = "expiration-tracker-test-reminder-dispatch-3"
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.dlq_age.threshold == 3600
    error_message = "DLQ age alarm threshold must be 1 hour (3600s)"
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.dlq_age.metric_name == "ApproximateAgeOfOldestMessage"
    error_message = "DLQ age alarm must watch ApproximateAgeOfOldestMessage"
  }

  assert {
    condition     = aws_cloudwatch_metric_alarm.dlq_age.comparison_operator == "GreaterThanThreshold"
    error_message = "DLQ age alarm must compare with GreaterThanThreshold"
  }
}

