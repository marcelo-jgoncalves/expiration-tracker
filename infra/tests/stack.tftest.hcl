# Full acceptance suite — ADR-0009 step 3. Recreates every assertion in
# test/infra/stack.test.ts (the CDK synth-time suite) as native `terraform test`
# assertions against the root module. Runs against the REAL aws provider in read-only
# `plan` mode (never apply) — same rationale as the dynamo-table module's
# dynamo_table_policy.tftest.hcl: every policy document/config value asserted on below is
# plan-time-known (deterministic ARNs built from aws_region/aws_account_id, static
# jsonencode() inputs, count/for_each driven by variable-length lists), so a full `plan`
# proves the wiring without creating/modifying/destroying anything. Requires AWS
# credentials (e.g. AWS_PROFILE=claude-dev) to initialize the provider, even though no
# mutating API calls are made. mock_provider is not used here because
# aws_iam_policy_document's/aws_iam_role_policy's rendered JSON is replaced by an opaque
# mock string under mock_provider, which would make the GSI3/GSI6 isolation assertions
# (this suite's most important property) vacuous.

provider "aws" {
  region = "us-east-1"
}

variables {
  aws_account_id   = "123456789012"
  aws_region       = "us-east-1"
  environment      = "dev"
  ses_from_address = "noreply@example.com"
}

run "twelve_lambda_functions_exist_no_placeholder" {
  command = plan

  # M3.5+M4: no Lambda function is left as an inline 501 placeholder - every function has a
  # real asset bundle (Terraform structurally cannot have inline code here - the
  # lambda-function module always zips an on-disk directory via data.archive_file - but we
  # still assert the expected count and distinct names to catch a wiring mistake).
  assert {
    condition     = length(output.lambda_function_names) == 12
    error_message = "Expected exactly 12 Lambda functions: TestPing, Items, Reminders, Producer, Dispatch, Reconciliation, Relay, Sweeper, NotificationRouter, NotificationEmailOutboxRelay, EmailDelivery, SesCallback"
  }

  assert {
    condition     = length(distinct(output.lambda_function_names)) == 12
    error_message = "All 12 Lambda function names must be distinct"
  }
}

run "gsi3_access_granted_only_to_reminder_producer" {
  command = plan

  # M3 isolation (implementation-blueprint.md §9.2/threat-model.md gap 3): GSI3 access is
  # granted to the ReminderProducer role ONLY - no other function's IAM policy references
  # the GSI3 index.
  assert {
    condition     = anytrue([for p in module.reminder_producer.capability_policy_documents : strcontains(p, "/index/GSI3")])
    error_message = "ReminderProducer must have a policy referencing GSI3 - otherwise the producer couldn't work"
  }

  assert {
    condition     = !anytrue([for p in module.test_ping_handler.capability_policy_documents : strcontains(p, "/index/GSI3")])
    error_message = "TestPingHandler must NOT reference GSI3"
  }
  assert {
    condition     = !anytrue([for p in module.items_handler.capability_policy_documents : strcontains(p, "/index/GSI3")])
    error_message = "ItemsHandler must NOT reference GSI3"
  }
  assert {
    condition     = !anytrue([for p in module.reminders_handler.capability_policy_documents : strcontains(p, "/index/GSI3")])
    error_message = "RemindersHandler must NOT reference GSI3"
  }
  assert {
    condition     = !anytrue([for p in module.reminder_dispatch.capability_policy_documents : strcontains(p, "/index/GSI3")])
    error_message = "ReminderDispatch must NOT reference GSI3"
  }
  assert {
    condition     = !anytrue([for p in module.reminder_reconciliation.capability_policy_documents : strcontains(p, "/index/GSI3")])
    error_message = "ReminderReconciliation must NOT reference GSI3"
  }
  # DispatchOutboxRelay's third capability document (DynamoDB Streams read) is built from
  # the table's live stream ARN, which is only known after apply - not plan-time-known like
  # every other policy document here. Its first two entries (table RW, queue send) ARE
  # plan-time-known and asserted on individually; the third is a fixed, hand-written
  # dynamodb:GetRecords/GetShardIterator/DescribeStream/ListStreams statement
  # (main.tf's data.aws_iam_policy_document.dispatch_outbox_relay_stream_read) that by
  # construction never mentions an index ARN, so omitting it here does not weaken the GSI3
  # isolation guarantee.
  assert {
    condition     = !strcontains(module.dispatch_outbox_relay.capability_policy_documents[0], "/index/GSI3")
    error_message = "DispatchOutboxRelay's table-access policy must NOT reference GSI3"
  }
  assert {
    condition     = !strcontains(module.dispatch_outbox_relay.capability_policy_documents[1], "/index/GSI3")
    error_message = "DispatchOutboxRelay's queue-send policy must NOT reference GSI3"
  }
  assert {
    condition     = !anytrue([for p in module.outbox_sweeper.capability_policy_documents : strcontains(p, "/index/GSI3")])
    error_message = "OutboxSweeperReminderDispatch must NOT reference GSI3"
  }

  # M4: none of the 4 notification functions ever needs GSI3 (that's exclusively
  # ReminderProducer's, unrelated to notification routing/delivery/callback).
  assert {
    condition     = !strcontains(module.notification_router.capability_policy_documents[0], "/index/GSI3")
    error_message = "NotificationRouter's table-access policy must NOT reference GSI3"
  }
  assert {
    condition     = !strcontains(module.notification_email_outbox_relay.capability_policy_documents[0], "/index/GSI3")
    error_message = "NotificationEmailOutboxRelay's table-access policy must NOT reference GSI3"
  }
  assert {
    condition     = !anytrue([for p in module.email_delivery.capability_policy_documents : strcontains(p, "/index/GSI3")])
    error_message = "EmailDelivery must NOT reference GSI3"
  }
  assert {
    condition     = !anytrue([for p in module.ses_callback.capability_policy_documents : strcontains(p, "/index/GSI3")])
    error_message = "SesCallback must NOT reference GSI3"
  }
}

run "gsi6_access_granted_only_to_reconciliation_and_sweeper" {
  command = plan

  # M3.5 isolation: GSI6 access is granted to EXACTLY ReminderReconciliation and
  # OutboxSweeperReminderDispatch - no other function's IAM policy references GSI6.
  assert {
    condition     = anytrue([for p in module.reminder_reconciliation.capability_policy_documents : strcontains(p, "/index/GSI6")])
    error_message = "ReminderReconciliation must have a policy referencing GSI6"
  }
  assert {
    condition     = anytrue([for p in module.outbox_sweeper.capability_policy_documents : strcontains(p, "/index/GSI6")])
    error_message = "OutboxSweeperReminderDispatch must have a policy referencing GSI6"
  }

  assert {
    condition     = !anytrue([for p in module.test_ping_handler.capability_policy_documents : strcontains(p, "/index/GSI6")])
    error_message = "TestPingHandler must NOT reference GSI6"
  }
  assert {
    condition     = !anytrue([for p in module.items_handler.capability_policy_documents : strcontains(p, "/index/GSI6")])
    error_message = "ItemsHandler must NOT reference GSI6"
  }
  assert {
    condition     = !anytrue([for p in module.reminders_handler.capability_policy_documents : strcontains(p, "/index/GSI6")])
    error_message = "RemindersHandler must NOT reference GSI6"
  }
  assert {
    condition     = !anytrue([for p in module.reminder_producer.capability_policy_documents : strcontains(p, "/index/GSI6")])
    error_message = "ReminderProducer must NOT reference GSI6"
  }
  assert {
    condition     = !anytrue([for p in module.reminder_dispatch.capability_policy_documents : strcontains(p, "/index/GSI6")])
    error_message = "ReminderDispatch must NOT reference GSI6"
  }
  # See the GSI3 run block above for why only the plan-time-known entries are checked here.
  assert {
    condition     = !strcontains(module.dispatch_outbox_relay.capability_policy_documents[0], "/index/GSI6")
    error_message = "DispatchOutboxRelay's table-access policy must NOT reference GSI6"
  }
  assert {
    condition     = !strcontains(module.dispatch_outbox_relay.capability_policy_documents[1], "/index/GSI6")
    error_message = "DispatchOutboxRelay's queue-send policy must NOT reference GSI6"
  }

  # M4: none of the 4 notification functions is one of the two GSI6-privileged roles.
  assert {
    condition     = !strcontains(module.notification_router.capability_policy_documents[0], "/index/GSI6")
    error_message = "NotificationRouter's table-access policy must NOT reference GSI6"
  }
  assert {
    condition     = !strcontains(module.notification_email_outbox_relay.capability_policy_documents[0], "/index/GSI6")
    error_message = "NotificationEmailOutboxRelay's table-access policy must NOT reference GSI6"
  }
  assert {
    condition     = !anytrue([for p in module.email_delivery.capability_policy_documents : strcontains(p, "/index/GSI6")])
    error_message = "EmailDelivery must NOT reference GSI6"
  }
  assert {
    condition     = !anytrue([for p in module.ses_callback.capability_policy_documents : strcontains(p, "/index/GSI6")])
    error_message = "SesCallback must NOT reference GSI6"
  }
}

run "dlq_max_receive_count_5_and_age_alarm_exists" {
  command = plan

  assert {
    condition     = module.dispatch_queue.dlq_max_receive_count == 5
    error_message = "ReminderDispatchQueue's redrive policy must have maxReceiveCount=5"
  }

  assert {
    condition     = module.dispatch_queue.dlq_age_alarm_threshold == 3600
    error_message = "DLQ age alarm must exist with a 1-hour threshold"
  }
}

run "seven_reminder_alarms_plus_one_dlq_age_alarm_per_m4_queue" {
  command = plan

  # 1 DLQ age alarm (dispatch_queue, sqs-worker-queue module) + 5 per-function error alarms
  # + 1 dispatch-queue backlog-age alarm (reminder-observability module) = 7, matching
  # test/infra/stack.test.ts's `template.resourceCountIs("AWS::CloudWatch::Alarm", 7)` from
  # the original CDK stack (M3.5-era baseline, unchanged by M4). M4 adds 3 more DLQ age
  # alarms (one per new sqs-worker-queue instance: router/email-deliver/ses-callback) via
  # the SAME generic module - asserted separately below, not folded into a renamed "total"
  # count, since M4 deliberately does NOT add per-function error alarms or a backlog-age
  # alarm for the new functions yet (docs/architecture observability milestone, planned as
  # the next work item after M4, is where that gets decided holistically rather than
  # duplicating reminder-observability's non-generic per-function-name module shape here).
  assert {
    condition     = length(module.observability.function_error_alarm_names) == 5
    error_message = "Expected exactly 5 per-function error alarms (producer, dispatch, reconciliation, relay, sweeper) - unchanged by M4"
  }

  assert {
    condition     = module.observability.dispatch_queue_backlog_alarm_name != ""
    error_message = "Dispatch queue backlog-age alarm must exist"
  }

  assert {
    condition     = module.dispatch_queue.dlq_age_alarm_name != ""
    error_message = "ReminderDispatchQueue DLQ age alarm must exist"
  }

  assert {
    condition     = module.router_queue.dlq_age_alarm_name != ""
    error_message = "NotificationRouter queue DLQ age alarm must exist"
  }
  assert {
    condition     = module.email_deliver_queue.dlq_age_alarm_name != ""
    error_message = "EmailDeliver queue DLQ age alarm must exist"
  }
  assert {
    condition     = module.ses_callback_queue.dlq_age_alarm_name != ""
    error_message = "SesCallback queue DLQ age alarm must exist"
  }
}

run "schedule_inputs_have_no_detail_wrapper_and_have_scheduled_time" {
  command = plan

  # M3.5 contract: EventBridge Scheduler's Input is a top-level JSON payload with
  # scheduledTime, never a `detail` envelope (legacy Rule shape) - re-verified at root
  # wiring level, not just inside the reminder-schedule module's own unit test.
  assert {
    condition     = !strcontains(module.schedule.schedule_inputs.reminder_producer, "detail")
    error_message = "ReminderProducer schedule input must not have a detail envelope"
  }
  assert {
    condition     = strcontains(module.schedule.schedule_inputs.reminder_producer, "scheduledTime")
    error_message = "ReminderProducer schedule input must have scheduledTime"
  }

  assert {
    condition     = !strcontains(module.schedule.schedule_inputs.reminder_claim_reconciliation, "detail")
    error_message = "CLAIMS reconciliation schedule input must not have a detail envelope"
  }
  assert {
    condition     = jsondecode(module.schedule.schedule_inputs.reminder_claim_reconciliation)["mode"] == "CLAIMS"
    error_message = "CLAIMS reconciliation schedule must set mode=CLAIMS"
  }

  assert {
    condition     = !strcontains(module.schedule.schedule_inputs.reminder_dst_reconciliation, "detail")
    error_message = "DST reconciliation schedule input must not have a detail envelope"
  }
  assert {
    condition     = jsondecode(module.schedule.schedule_inputs.reminder_dst_reconciliation)["mode"] == "DST"
    error_message = "DST reconciliation schedule must set mode=DST"
  }

  assert {
    condition     = !strcontains(module.schedule.schedule_inputs.outbox_sweeper, "detail")
    error_message = "Outbox sweeper schedule input must not have a detail envelope"
  }
  assert {
    condition     = strcontains(module.schedule.schedule_inputs.outbox_sweeper, "scheduledTime")
    error_message = "Outbox sweeper schedule input must have scheduledTime"
  }

  assert {
    condition     = module.schedule.schedule_count == 4
    error_message = "Expected exactly 4 EventBridge Scheduler schedules (producer, claims-reconciliation, dst-reconciliation, sweeper)"
  }
}

run "gsi3_has_keys_only_projection" {
  command = plan

  assert {
    condition     = module.table.gsi3_projection_type == "KEYS_ONLY"
    error_message = "GSI3 must exist with KEYS_ONLY projection"
  }

  assert {
    condition     = module.table.gsi_count == 6
    error_message = "Table must have exactly 6 GSIs"
  }
}

run "reserved_concurrency_matches_cdk_stack" {
  command = plan

  # Forces enable_reserved_concurrency=true regardless of what env/dev.tfvars says, so this
  # test keeps proving the CDK-parity design is correct even though the real dev account
  # can't use it yet (its Lambda concurrency quota is only 10 - see variables.tf and
  # env/dev.tfvars for the real finding from the first terraform apply, 2026-08-20).
  variables {
    enable_reserved_concurrency = true
  }

  # infra/lib/expiration-tracker-stack.ts: producer=2, dispatch=10, reconciliation=1,
  # relay=2, sweeper=2.
  assert {
    condition     = module.reminder_producer.reserved_concurrent_executions == 2
    error_message = "ReminderProducer reservedConcurrentExecutions must be 2"
  }
  assert {
    condition     = module.reminder_dispatch.reserved_concurrent_executions == 10
    error_message = "ReminderDispatch reservedConcurrentExecutions must be 10"
  }
  assert {
    condition     = module.reminder_reconciliation.reserved_concurrent_executions == 1
    error_message = "ReminderReconciliation reservedConcurrentExecutions must be 1"
  }
  assert {
    condition     = module.dispatch_outbox_relay.reserved_concurrent_executions == 2
    error_message = "DispatchOutboxRelay reservedConcurrentExecutions must be 2"
  }
  assert {
    condition     = module.outbox_sweeper.reserved_concurrent_executions == 2
    error_message = "OutboxSweeperReminderDispatch reservedConcurrentExecutions must be 2"
  }
}

run "event_source_mappings_use_partial_batch_failure" {
  command = plan

  assert {
    condition     = contains(aws_lambda_event_source_mapping.reminder_dispatch_from_queue.function_response_types, "ReportBatchItemFailures")
    error_message = "SQS event source mapping must use ReportBatchItemFailures"
  }
  assert {
    condition     = aws_lambda_event_source_mapping.reminder_dispatch_from_queue.batch_size == 10
    error_message = "SQS event source mapping batch size must be 10"
  }

  assert {
    condition     = contains(aws_lambda_event_source_mapping.dispatch_outbox_relay_from_stream.function_response_types, "ReportBatchItemFailures")
    error_message = "DynamoDB Streams event source mapping must use ReportBatchItemFailures"
  }
  assert {
    condition     = aws_lambda_event_source_mapping.dispatch_outbox_relay_from_stream.starting_position == "LATEST"
    error_message = "DynamoDB Streams event source mapping must start at LATEST"
  }
  assert {
    condition     = aws_lambda_event_source_mapping.dispatch_outbox_relay_from_stream.batch_size == 25
    error_message = "DynamoDB Streams event source mapping batch size must be 25"
  }

  # M4's 4 new event source mappings - same partial-batch-failure discipline.
  assert {
    condition     = contains(aws_lambda_event_source_mapping.notification_router_from_stream.function_response_types, "ReportBatchItemFailures")
    error_message = "NotificationRouter's Streams event source mapping must use ReportBatchItemFailures"
  }
  assert {
    condition     = contains(aws_lambda_event_source_mapping.notification_email_outbox_relay_from_stream.function_response_types, "ReportBatchItemFailures")
    error_message = "NotificationEmailOutboxRelay's Streams event source mapping must use ReportBatchItemFailures"
  }
  assert {
    condition     = contains(aws_lambda_event_source_mapping.email_delivery_from_queue.function_response_types, "ReportBatchItemFailures")
    error_message = "EmailDelivery's SQS event source mapping must use ReportBatchItemFailures"
  }
  assert {
    condition     = contains(aws_lambda_event_source_mapping.ses_callback_from_queue.function_response_types, "ReportBatchItemFailures")
    error_message = "SesCallback's SQS event source mapping must use ReportBatchItemFailures"
  }
}

run "monthly_cost_budget_exists" {
  command = plan

  assert {
    condition     = module.cost_budget.time_unit == "MONTHLY"
    error_message = "Budget must be monthly"
  }
  assert {
    condition     = module.cost_budget.limit_unit == "USD"
    error_message = "Budget must be in USD"
  }
  assert {
    condition     = tonumber(module.cost_budget.limit_amount) > 0
    error_message = "Budget limit must be greater than 0"
  }
}
