# Recreates the acceptance criteria implied by infra/lib/reminder-schedule.ts as native
# `terraform test` assertions. mock_provider — no real AWS credentials/resources needed
# (unlike dynamo-table/reminder-queue's policy tests, every IAM document here is a plain
# jsonencode(), not an aws_iam_policy_document data source, so nothing is replaced by an
# opaque mock string).

mock_provider "aws" {
  # The default mock_provider computed-attribute generator produces a random string, not a
  # valid ARN, for aws_iam_role.arn — but aws_scheduler_schedule.target.role_arn validates
  # its input looks like an ARN even under mock_provider (same issue documented in the
  # lambda-function module's test). Override just that attribute with a realistic value.
  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::123456789012:role/mock-role"
    }
  }
}

run "four_schedules_enabled_by_default_with_correct_expressions" {
  command = apply

  variables {
    reminder_producer_function_arn        = "arn:aws:lambda:us-east-1:123456789012:function:reminder-producer"
    reminder_producer_function_name       = "reminder-producer"
    reminder_reconciliation_function_arn  = "arn:aws:lambda:us-east-1:123456789012:function:reminder-reconciliation"
    reminder_reconciliation_function_name = "reminder-reconciliation"
    outbox_sweeper_function_arn           = "arn:aws:lambda:us-east-1:123456789012:function:outbox-sweeper-reminder-dispatch"
    outbox_sweeper_function_name          = "outbox-sweeper-reminder-dispatch"
  }

  assert {
    condition     = aws_scheduler_schedule.reminder_producer.state == "ENABLED"
    error_message = "Schedules must default to ENABLED"
  }

  assert {
    condition     = aws_scheduler_schedule.reminder_producer.schedule_expression == "rate(1 minute)"
    error_message = "ReminderProducer schedule must run every 1 minute"
  }

  assert {
    condition     = aws_scheduler_schedule.reminder_claim_reconciliation.schedule_expression == "rate(5 minutes)"
    error_message = "CLAIMS reconciliation schedule must run every 5 minutes"
  }

  assert {
    condition     = aws_scheduler_schedule.reminder_dst_reconciliation.schedule_expression == "cron(0 3 * * ? *)"
    error_message = "DST reconciliation schedule must run daily at 03:00 UTC"
  }

  assert {
    condition     = aws_scheduler_schedule.reminder_dst_reconciliation.flexible_time_window[0].mode == "FLEXIBLE"
    error_message = "DST reconciliation schedule must use a flexible time window"
  }

  assert {
    condition     = aws_scheduler_schedule.reminder_dst_reconciliation.flexible_time_window[0].maximum_window_in_minutes == 15
    error_message = "DST reconciliation flexible window must be 15 minutes"
  }

  assert {
    condition     = aws_scheduler_schedule.outbox_sweeper.schedule_expression == "rate(5 minutes)"
    error_message = "Outbox sweeper schedule must run every 5 minutes"
  }

  # Every OTHER schedule (not DST) uses an OFF flexible window.
  assert {
    condition     = aws_scheduler_schedule.reminder_producer.flexible_time_window[0].mode == "OFF"
    error_message = "ReminderProducer schedule must not use a flexible window"
  }
}

run "scheduler_input_has_no_detail_wrapper_and_correct_top_level_fields" {
  command = apply

  variables {
    reminder_producer_function_arn        = "arn:aws:lambda:us-east-1:123456789012:function:reminder-producer"
    reminder_producer_function_name       = "reminder-producer"
    reminder_reconciliation_function_arn  = "arn:aws:lambda:us-east-1:123456789012:function:reminder-reconciliation"
    reminder_reconciliation_function_name = "reminder-reconciliation"
    outbox_sweeper_function_arn           = "arn:aws:lambda:us-east-1:123456789012:function:outbox-sweeper-reminder-dispatch"
    outbox_sweeper_function_name          = "outbox-sweeper-reminder-dispatch"
  }

  # CRITICAL CONTRACT: no `detail` envelope anywhere (that's a legacy Rule shape, not
  # Scheduler) - the previous Codex-found bug this replicates a regression test for.
  assert {
    condition     = !strcontains(aws_scheduler_schedule.reminder_producer.target[0].input, "detail")
    error_message = "ReminderProducer schedule input must NOT wrap payload in a detail envelope"
  }

  assert {
    condition     = !strcontains(aws_scheduler_schedule.reminder_claim_reconciliation.target[0].input, "detail")
    error_message = "CLAIMS reconciliation schedule input must NOT wrap payload in a detail envelope"
  }

  assert {
    condition     = !strcontains(aws_scheduler_schedule.reminder_dst_reconciliation.target[0].input, "detail")
    error_message = "DST reconciliation schedule input must NOT wrap payload in a detail envelope"
  }

  assert {
    condition     = !strcontains(aws_scheduler_schedule.outbox_sweeper.target[0].input, "detail")
    error_message = "Outbox sweeper schedule input must NOT wrap payload in a detail envelope"
  }

  # Top-level fields the handlers actually read. Real bug found 2026-08-21 (live CloudWatch
  # evidence, Camada 3): comparing against `jsonencode(...)` here was asserting the BUGGY
  # value as correct - jsonencode HTML-escapes angle brackets to their \uXXXX form, which
  # defeats EventBridge Scheduler's literal-text context-attribute substitution, so every
  # real invocation received the placeholder string unsubstituted and failed validation.
  # These assertions now check for the literal, unescaped placeholder text.
  assert {
    condition     = aws_scheduler_schedule.reminder_producer.target[0].input == "{\"scheduledTime\":\"<aws.scheduler.scheduled-time>\"}"
    error_message = "ReminderProducer schedule input must be exactly {scheduledTime} with the literal, unescaped context-attribute placeholder"
  }

  assert {
    condition     = aws_scheduler_schedule.reminder_claim_reconciliation.target[0].input == "{\"mode\":\"CLAIMS\",\"scheduledTime\":\"<aws.scheduler.scheduled-time>\"}"
    error_message = "CLAIMS reconciliation schedule input must be exactly {mode: CLAIMS, scheduledTime} with the literal, unescaped context-attribute placeholder"
  }

  assert {
    condition     = aws_scheduler_schedule.reminder_dst_reconciliation.target[0].input == "{\"mode\":\"DST\",\"scheduledTime\":\"<aws.scheduler.scheduled-time>\"}"
    error_message = "DST reconciliation schedule input must be exactly {mode: DST, scheduledTime} with the literal, unescaped context-attribute placeholder"
  }

  assert {
    condition     = aws_scheduler_schedule.outbox_sweeper.target[0].input == "{\"scheduledTime\":\"<aws.scheduler.scheduled-time>\"}"
    error_message = "Outbox sweeper schedule input must be exactly {scheduledTime} with the literal, unescaped context-attribute placeholder"
  }
}

run "each_schedule_has_its_own_role_scoped_to_only_its_target" {
  command = apply

  variables {
    reminder_producer_function_arn        = "arn:aws:lambda:us-east-1:123456789012:function:reminder-producer"
    reminder_producer_function_name       = "reminder-producer"
    reminder_reconciliation_function_arn  = "arn:aws:lambda:us-east-1:123456789012:function:reminder-reconciliation"
    reminder_reconciliation_function_name = "reminder-reconciliation"
    outbox_sweeper_function_arn           = "arn:aws:lambda:us-east-1:123456789012:function:outbox-sweeper-reminder-dispatch"
    outbox_sweeper_function_name          = "outbox-sweeper-reminder-dispatch"
  }

  # 4 distinct roles, each trusting scheduler.amazonaws.com.
  assert {
    condition     = strcontains(aws_iam_role.reminder_producer.assume_role_policy, "scheduler.amazonaws.com")
    error_message = "ReminderProducer schedule role must trust scheduler.amazonaws.com"
  }

  assert {
    condition     = aws_iam_role.reminder_producer.name != aws_iam_role.reminder_claim_reconciliation.name
    error_message = "ReminderProducer and CLAIMS reconciliation schedules must use distinct IAM roles"
  }

  assert {
    condition     = aws_iam_role.reminder_claim_reconciliation.name != aws_iam_role.reminder_dst_reconciliation.name
    error_message = "CLAIMS and DST reconciliation schedules must use distinct IAM roles (even though they share a target Lambda)"
  }

  # Invoke permission scoped to only that schedule's own target function.
  assert {
    condition     = strcontains(aws_iam_role_policy.reminder_producer_invoke.policy, var.reminder_producer_function_arn)
    error_message = "ReminderProducer invoke policy must reference the producer function ARN"
  }

  assert {
    condition     = !strcontains(aws_iam_role_policy.reminder_producer_invoke.policy, var.outbox_sweeper_function_arn)
    error_message = "ReminderProducer invoke policy must NOT reference the outbox sweeper function ARN"
  }

  assert {
    condition     = strcontains(aws_iam_role_policy.outbox_sweeper_invoke.policy, var.outbox_sweeper_function_arn)
    error_message = "Outbox sweeper invoke policy must reference its own function ARN"
  }

  assert {
    condition     = !strcontains(aws_iam_role_policy.outbox_sweeper_invoke.policy, var.reminder_producer_function_arn)
    error_message = "Outbox sweeper invoke policy must NOT reference the producer function ARN"
  }
}

run "schedules_can_be_disabled_via_kill_switch" {
  command = apply

  variables {
    reminder_producer_function_arn        = "arn:aws:lambda:us-east-1:123456789012:function:reminder-producer"
    reminder_producer_function_name       = "reminder-producer-2"
    reminder_reconciliation_function_arn  = "arn:aws:lambda:us-east-1:123456789012:function:reminder-reconciliation"
    reminder_reconciliation_function_name = "reminder-reconciliation-2"
    outbox_sweeper_function_arn           = "arn:aws:lambda:us-east-1:123456789012:function:outbox-sweeper-reminder-dispatch"
    outbox_sweeper_function_name          = "outbox-sweeper-reminder-dispatch-2"
    schedules_enabled                     = false
  }

  assert {
    condition     = aws_scheduler_schedule.reminder_producer.state == "DISABLED"
    error_message = "Kill switch must set schedule state to DISABLED"
  }

  assert {
    condition     = aws_scheduler_schedule.outbox_sweeper.state == "DISABLED"
    error_message = "Kill switch must disable every schedule, not just one"
  }
}
