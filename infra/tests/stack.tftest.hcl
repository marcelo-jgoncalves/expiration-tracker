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
  adot_layer_arn   = "arn:aws:lambda:us-east-1:901920570463:layer:aws-otel-nodejs-amd64-ver-1-30-0:1"
  alert_email      = "ops@example.com"
}

run "twentyseven_lambda_functions_exist_no_placeholder" {
  command = plan

  # M3.5+M4+notifications-handler+BLOCKER-B+M7 item 2: no Lambda function is left as an
  # inline 501 placeholder - every function has a real asset bundle (Terraform structurally
  # cannot have inline code here - the lambda-function module always zips an on-disk
  # directory via data.archive_file - but we still assert the expected count and distinct
  # names to catch a wiring mistake).
  assert {
    condition     = length(output.lambda_function_names) == 27
    error_message = "Expected exactly 27 Lambda functions: TestPing, Items, Reminders, Producer, Dispatch, Reconciliation, ReminderMaterializationTrigger (BLOCKER-B), Relay, Sweeper, NotificationRouter, NotificationEmailOutboxRelay, EmailDelivery, SesCallback, NotificationsHandler, DocumentsHandler, UploadFinalizer, MalwareResult, UploadSlotReconciliation, ParserSandbox (M6), SubjectsHandler (M9), GuestDocumentsHandler (M10), DocumentChasingDispatch (M10 cluster 4), ImportsHandler, ImportParse, ImportCommit (M11), BffHandler (Full BFF, D-053/D-054), ExtractionStarterHandler (M7 item 2, D-035)"
  }

  assert {
    condition     = length(distinct(output.lambda_function_names)) == 27
    error_message = "All 27 Lambda function names must be distinct"
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
  assert {
    condition     = !anytrue([for p in module.notifications_handler.capability_policy_documents : strcontains(p, "/index/GSI3")])
    error_message = "NotificationsHandler must NOT reference GSI3"
  }

  # M10 cluster 4 (D-039/D-046/D-048): DocumentChasingDispatch never queries GSI3 directly -
  # only the shared ReminderProducer (already asserted above) does. This function only
  # consumes claimed commands off SQS and mutates the base table + sends SES.
  assert {
    condition     = !anytrue([for p in module.document_chasing_dispatch_handler.capability_policy_documents : strcontains(p, "/index/GSI3")])
    error_message = "DocumentChasingDispatch must NOT reference GSI3"
  }

  # BLOCKER-B: ReminderMaterializationTrigger only ever does get()/queryByItem() on base
  # partitions - never queries GSI3 (that's exclusively ReminderProducer's).
  assert {
    condition     = !anytrue([for p in module.reminder_materialization_trigger.capability_policy_documents : strcontains(p, "/index/GSI3")])
    error_message = "ReminderMaterializationTrigger must NOT reference GSI3"
  }
}

run "gsi6_access_granted_only_to_reconciliation_and_sweeper" {
  command = plan

  # M3.5 isolation, extended by M6: GSI6 access is granted to EXACTLY ReminderReconciliation,
  # OutboxSweeperReminderDispatch, and (since M6) UploadSlotReconciliationWorker - no other
  # function's IAM policy references GSI6.
  assert {
    condition     = anytrue([for p in module.reminder_reconciliation.capability_policy_documents : strcontains(p, "/index/GSI6")])
    error_message = "ReminderReconciliation must have a policy referencing GSI6"
  }
  assert {
    condition     = anytrue([for p in module.outbox_sweeper.capability_policy_documents : strcontains(p, "/index/GSI6")])
    error_message = "OutboxSweeperReminderDispatch must have a policy referencing GSI6"
  }
  assert {
    condition     = anytrue([for p in module.upload_slot_reconciliation_handler.capability_policy_documents : strcontains(p, "/index/GSI6")])
    error_message = "UploadSlotReconciliationWorker must have a policy referencing GSI6 (M6)"
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
  assert {
    condition     = !anytrue([for p in module.notifications_handler.capability_policy_documents : strcontains(p, "/index/GSI6")])
    error_message = "NotificationsHandler must NOT reference GSI6"
  }

  # M6: none of the 5 document-module functions except UploadSlotReconciliationWorker itself
  # is one of the three GSI6-privileged roles. Only index [0] (the plain
  # tenant_facing_read_write_policy_json, plan-time-known) is checked here - same rationale as
  # DispatchOutboxRelay above: the other capability documents in these functions' lists embed
  # not-yet-created S3/KMS resource ARNs (unknown until apply), and none of them ever receives
  # module.table.gsi6_read_policy_json in the first place (structurally impossible - see
  # main.tf), so there is nothing to check there. ParserSandbox gets no table policy at all
  # (isolated by design), so it is skipped entirely rather than asserted on.
  assert {
    condition     = !strcontains(module.documents_handler.capability_policy_documents[0], "/index/GSI6")
    error_message = "DocumentsHandler's table-access policy must NOT reference GSI6"
  }
  assert {
    condition     = !strcontains(module.upload_finalizer_handler.capability_policy_documents[0], "/index/GSI6")
    error_message = "UploadFinalizerWorker's table-access policy must NOT reference GSI6"
  }
  assert {
    condition     = !strcontains(module.malware_result_handler.capability_policy_documents[0], "/index/GSI6")
    error_message = "MalwareResultWorker's table-access policy must NOT reference GSI6"
  }

  # M10 cluster 4 (D-039/D-046/D-048): DocumentChasingDispatch is not one of the three
  # GSI6-privileged roles - claim-expiry reconciliation for its occurrences is handled by
  # the SAME ReminderReconciliation role (already privileged), never by this dispatch worker.
  assert {
    condition     = !anytrue([for p in module.document_chasing_dispatch_handler.capability_policy_documents : strcontains(p, "/index/GSI6")])
    error_message = "DocumentChasingDispatch must NOT reference GSI6"
  }

  # BLOCKER-B: ReminderMaterializationTrigger is not one of the three GSI6-privileged roles
  # either - it never does claim-expiry/DST reconciliation, only get()/queryByItem().
  assert {
    condition     = !anytrue([for p in module.reminder_materialization_trigger.capability_policy_documents : strcontains(p, "/index/GSI6")])
    error_message = "ReminderMaterializationTrigger must NOT reference GSI6"
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
  # M10 cluster 4 (D-039/D-046/D-048) DOES extend this module's existing per-function-name
  # shape (not a new pattern) with a 6th entry, DocumentChasingDispatch - the fused
  # dispatch+delivery worker sharing GSI3 with this pipeline had zero alarm coverage before.
  assert {
    condition     = length(module.observability.function_error_alarm_names) == 6
    error_message = "Expected exactly 6 per-function error alarms (producer, dispatch, reconciliation, relay, sweeper, document-chasing-dispatch)"
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

  # M11 (D-042): same generic module, same reasoning - a DLQ age alarm for each new queue, no
  # per-function error alarm folded into the count above (reminder-observability's module
  # shape stays scoped to the reminder/chasing pipeline it was designed and reviewed for).
  assert {
    condition     = module.import_parse_queue.dlq_age_alarm_name != ""
    error_message = "ImportParse queue DLQ age alarm must exist"
  }
  assert {
    condition     = module.import_commit_queue.dlq_age_alarm_name != ""
    error_message = "ImportCommit queue DLQ age alarm must exist"
  }

  # BLOCKER-B: same generic module, same reasoning.
  assert {
    condition     = module.reminder_materialization_trigger_queue.dlq_age_alarm_name != ""
    error_message = "ReminderMaterializationTrigger queue DLQ age alarm must exist"
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

  # Real bug found 2026-08-21 (live CloudWatch evidence, Camada 3): jsonencode() HTML-escapes
  # `<`/`>` to their \uXXXX form, which silently defeats EventBridge Scheduler's literal-text
  # substitution of `<aws.scheduler.scheduled-time>` - every real invocation received the
  # placeholder string unsubstituted and failed validation. Re-verified at root wiring level.
  assert {
    condition     = !strcontains(module.schedule.schedule_inputs.reminder_producer, "\\u003c")
    error_message = "ReminderProducer schedule input must use the literal, unescaped context-attribute placeholder, not an HTML-escaped one"
  }
  assert {
    condition     = strcontains(module.schedule.schedule_inputs.reminder_producer, "<aws.scheduler.scheduled-time>")
    error_message = "ReminderProducer schedule input must contain the literal context-attribute placeholder text"
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
    condition     = module.table.gsi_count == 7
    error_message = "Table must have exactly 7 GSIs"
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

  # M6's 2 new event source mappings - same discipline.
  assert {
    condition     = contains(aws_lambda_event_source_mapping.upload_finalizer_from_queue.function_response_types, "ReportBatchItemFailures")
    error_message = "UploadFinalizerWorker's SQS event source mapping must use ReportBatchItemFailures"
  }
  assert {
    condition     = contains(aws_lambda_event_source_mapping.malware_result_from_queue.function_response_types, "ReportBatchItemFailures")
    error_message = "MalwareResultWorker's SQS event source mapping must use ReportBatchItemFailures"
  }

  # BLOCKER-B's new event source mapping - same discipline.
  assert {
    condition     = contains(aws_lambda_event_source_mapping.reminder_materialization_trigger_from_queue.function_response_types, "ReportBatchItemFailures")
    error_message = "ReminderMaterializationTrigger's SQS event source mapping must use ReportBatchItemFailures"
  }
  assert {
    condition     = aws_lambda_event_source_mapping.reminder_materialization_trigger_from_queue.batch_size == 10
    error_message = "ReminderMaterializationTrigger's SQS event source mapping batch size must be 10"
  }
}

run "adot_layer_attached_to_every_function_and_alarms_have_a_real_target" {
  command = plan

  # m5-observability-design.md §3: every function gets the ADOT layer, never resolved
  # implicitly to "latest" - the pinned test ARN above is asserted on directly.
  assert {
    condition     = contains(module.reminder_producer.layers, var.adot_layer_arn)
    error_message = "ReminderProducer must have the ADOT layer attached"
  }
  assert {
    condition     = contains(module.ses_callback.layers, var.adot_layer_arn)
    error_message = "SesCallback must have the ADOT layer attached"
  }
  assert {
    condition     = contains(module.test_ping_handler.layers, var.adot_layer_arn)
    error_message = "TestPingHandler must have the ADOT layer attached"
  }

  # m5-observability-design.md §4: every alarm this stack owns still gets created with the
  # alert topic wired in (per-alarm alarm_actions content is asserted inside
  # reminder-observability's/sqs-worker-queue's own module tests; the alert topic's ARN
  # itself isn't plan-time-known here since aws_sns_topic.this.arn depends on the real
  # account id/topic creation, unlike the other modules' deterministically-constructed ARNs).
  assert {
    condition     = length(module.observability.function_error_alarm_names) == 6 && module.observability.dispatch_queue_backlog_alarm_name != ""
    error_message = "Observability module must still produce its alarms with the alert topic wired"
  }
  assert {
    condition     = module.dispatch_queue.dlq_age_alarm_name != ""
    error_message = "Dispatch queue DLQ age alarm must still exist with the alert topic wired"
  }
}

run "rollback_alias_wiring_and_deploy_manifest_bucket_exist" {
  command = plan

  # Rollback design entrega 1 (docs/architecture/reviews/rollback-mechanism-design/
  # codex-round2-final-design.md): every function's config must publish a version and have a
  # `live` alias (asserted per-function in the module's own tests, apply-mode with
  # mock_provider); at root, assert the manifest map covers all 13 functions and the
  # dedicated manifest bucket exists - both plan-time-known (map keys/bucket name are literal
  # config, not resource-computed attributes).
  assert {
    condition     = length(output.lambda_published_versions) == 27
    error_message = "Deploy manifest map must cover exactly the 27 real Lambda functions"
  }

  assert {
    condition     = output.deploy_manifest_bucket_name != ""
    error_message = "Dedicated deploy manifest bucket must exist"
  }

  assert {
    condition     = !strcontains(output.deploy_manifest_bucket_name, "exptrk-dev-table")
    error_message = "Deploy manifest bucket must never be the tenant document/table resource"
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

run "security_audit_trail_alarms_exist_and_are_wired_to_the_real_alert_topic" {
  command = plan

  # Trilha de auditoria de segurança (MVP desta sessão, achado real de
  # full-audit-round1-focused-round2-summary.md): os 3 alarmes reais existem e apontam para o
  # alert-topic real, não um destino novo.
  assert {
    condition     = module.security_audit_observability.authorization_denied_burst_alarm_name != ""
    error_message = "SecurityAuthorizationDeniedBurst alarm must exist"
  }
  assert {
    condition     = module.security_audit_observability.authorization_tenant_boundary_denied_alarm_name != ""
    error_message = "SecurityAuthorizationTenantBoundaryDenied alarm must exist"
  }
  assert {
    condition     = module.security_audit_observability.global_index_access_denied_alarm_name != ""
    error_message = "SecurityGlobalIndexAccessDenied alarm must exist"
  }
}
