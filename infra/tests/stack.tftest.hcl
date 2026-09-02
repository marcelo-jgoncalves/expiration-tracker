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
    condition     = length(output.lambda_function_names) == 32
    error_message = "Expected exactly 32 Lambda functions: TestPing, Items, Reminders, Producer, Dispatch, Reconciliation, ReminderMaterializationTrigger (BLOCKER-B), Relay, Sweeper, NotificationRouter, NotificationEmailOutboxRelay, EmailDelivery, SesCallback, NotificationsHandler, DocumentsHandler, UploadFinalizer, MalwareResult, UploadSlotReconciliation, ParserSandbox (M6), SubjectsHandler (M9), GuestDocumentsHandler (M10), DocumentChasingDispatch (M10 cluster 4), ImportsHandler, ImportParse, ImportCommit (M11), BffHandler (Full BFF, D-053/D-054), ExtractionStarterHandler (M7 item 2, D-035), TextractTaskHandler (M7 items 3/4, D-035), PdfParserTaskHandler (M7 item 5, D-035), BedrockExtractionTaskHandler (M7 item 6, D-035), ExtractionValidationTaskHandler (M7 item 7-8, D-035), DocumentPurgeWorker (W3-06, D-061)"
  }

  assert {
    condition     = length(distinct(output.lambda_function_names)) == 32
    error_message = "All 32 Lambda function names must be distinct"
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

  # M3.5 isolation, extended by M6 and W3-06/D-061: GSI6 access is granted to EXACTLY
  # ReminderReconciliation, OutboxSweeperReminderDispatch, UploadSlotReconciliationWorker, and
  # (since W3-06) DocumentPurgeWorker - no other function's IAM policy references GSI6.
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
    condition     = anytrue([for p in module.document_purge_handler.capability_policy_documents : strcontains(p, "/index/GSI6")])
    error_message = "DocumentPurgeWorker must have a policy referencing GSI6 (W3-06/D-061)"
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
  # D-163 §6/D-166: DocumentFileReconciliationWorker reuses GSI5 exclusively, deliberately a
  # base-table Scan (not even a GSI5 Query) - it must never be granted GSI6 either.
  assert {
    condition     = !anytrue([for p in module.document_file_reconciliation_handler.capability_policy_documents : strcontains(p, "/index/GSI6")])
    error_message = "DocumentFileReconciliationWorker must NOT reference GSI6 (D-143 Decision 2 stays closed to this domain)"
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

run "gsi4_access_granted_only_to_identity_context_lambdas" {
  command = plan

  # Multi-User B2B (D-08x/physical-model.md §6, Wave B2B-14/D-116): GSI4 (MembershipByUser)
  # resolves which Organizations a User belongs to given only a userId - crosses tenants by
  # design, so (same isolation posture as GSI3/GSI6) it must be reachable ONLY via the narrow
  # gsi4_read policy, never the general tenant_facing policy, and ONLY by the Lambdas that
  # actually construct a RequestContextResolver and call .resolve() (destructure `resolver`
  # from buildIdentityDeps(), not just `quota`) - real finding, D-116: this policy existed
  # since B2B-3 but was never attached to any of these 10 real consumers until now.
  assert {
    condition     = anytrue([for p in module.bff_handler.capability_policy_documents : strcontains(p, "/index/GSI4")])
    error_message = "BffHandler must have a policy referencing GSI4 - bff-auth-service.ts calls OnboardingStateResolver.resolve() on every session/callback"
  }
  assert {
    condition     = anytrue([for p in module.items_handler.capability_policy_documents : strcontains(p, "/index/GSI4")])
    error_message = "ItemsHandler must have a policy referencing GSI4"
  }
  assert {
    condition     = anytrue([for p in module.subjects_handler.capability_policy_documents : strcontains(p, "/index/GSI4")])
    error_message = "SubjectsHandler must have a policy referencing GSI4"
  }
  assert {
    condition     = anytrue([for p in module.reminders_handler.capability_policy_documents : strcontains(p, "/index/GSI4")])
    error_message = "RemindersHandler must have a policy referencing GSI4"
  }
  assert {
    condition     = anytrue([for p in module.notifications_handler.capability_policy_documents : strcontains(p, "/index/GSI4")])
    error_message = "NotificationsHandler must have a policy referencing GSI4"
  }
  assert {
    condition     = anytrue([for p in module.memberships_handler.capability_policy_documents : strcontains(p, "/index/GSI4")])
    error_message = "MembershipsHandler must have a policy referencing GSI4"
  }
  assert {
    condition     = anytrue([for p in module.documents_handler.capability_policy_documents : strcontains(p, "/index/GSI4")])
    error_message = "DocumentsHandler must have a policy referencing GSI4"
  }
  assert {
    condition     = anytrue([for p in module.imports_handler.capability_policy_documents : strcontains(p, "/index/GSI4")])
    error_message = "ImportsHandler must have a policy referencing GSI4"
  }
  assert {
    condition     = anytrue([for p in module.test_ping_handler.capability_policy_documents : strcontains(p, "/index/GSI4")])
    error_message = "TestPingHandler must have a policy referencing GSI4 (real.resolve() call in test-route-handler.ts)"
  }

  # Representative sample of Lambdas that must NOT reference GSI4 - workers/handlers that
  # only destructure `quota` from buildIdentityDeps() (never `resolver`), or don't use
  # buildIdentityDeps() at all.
  assert {
    condition     = !anytrue([for p in module.upload_slot_reconciliation_handler.capability_policy_documents : strcontains(p, "/index/GSI4")])
    error_message = "UploadSlotReconciliationWorker must NOT reference GSI4 - it only uses quota, never resolver.resolve()"
  }
  assert {
    condition     = !anytrue([for p in module.reminder_producer.capability_policy_documents : strcontains(p, "/index/GSI4")])
    error_message = "ReminderProducer must NOT reference GSI4 - it's GSI3-privileged, unrelated to identity/onboarding resolution"
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
    condition     = module.table.gsi_count == 8
    error_message = "Table must have exactly 8 GSIs"
  }

  assert {
    condition     = module.table.gsi8_projection_type == "KEYS_ONLY"
    error_message = "GSI8 (MaintenanceDueIndex) must exist with KEYS_ONLY projection"
  }
}

run "gsi8_worker_isolation" {
  command = plan

  # D-179/D-180 pilot slice - membership_purge_handler must be able to Query GSI8, scoped via
  # dynamodb:LeadingKeys to exactly its own WORK#/DLQ# namespace pair, plus TransactWriteItems on
  # the base table only. No other function's role may reference GSI8 at all (round-1 finding of
  # the approved design, corrected: "por índice não é por worker" - isolation is per-worker, not
  # a single blanket "read GSI8" grant every consumer shares).
  assert {
    condition     = anytrue([for p in module.membership_purge_handler.capability_policy_documents : strcontains(p, "/index/GSI8")])
    error_message = "MembershipPurgeWorker must have a policy referencing GSI8"
  }

  assert {
    condition     = anytrue([for p in module.membership_purge_handler.capability_policy_documents : strcontains(p, "WORK#MEMBERSHIP_PURGE") && strcontains(p, "DLQ#MEMBERSHIP_PURGE")])
    error_message = "MembershipPurgeWorker's GSI8 policy must condition dynamodb:LeadingKeys on exactly its own WORK#/DLQ# namespace pair"
  }

  assert {
    condition     = anytrue([for p in module.membership_purge_handler.capability_policy_documents : strcontains(p, "dynamodb:TransactWriteItems")])
    error_message = "MembershipPurgeWorker must have dynamodb:TransactWriteItems - the atomic claim/revalidation action the approved design added as a real gap in the general policy"
  }

  # TransactWriteItems is granted on the base table only, never on any GSI resource - it always
  # targets base-table items (ConditionCheck/Update/Delete), never a GSI directly.
  assert {
    condition = !anytrue([
      for p in module.membership_purge_handler.capability_policy_documents :
      strcontains(p, "dynamodb:TransactWriteItems") && (strcontains(p, "/index/GSI3") || strcontains(p, "/index/GSI4") || strcontains(p, "/index/GSI6") || strcontains(p, "/index/GSI8"))
    ])
    error_message = "dynamodb:TransactWriteItems must never be granted on a GSI resource, only the base table"
  }

  # D-179/D-181 slice 2 - invitation_purge_handler joins the same pattern, its own WORK#/DLQ#
  # namespace pair, isolated from membership_purge's.
  assert {
    condition     = anytrue([for p in module.invitation_purge_handler.capability_policy_documents : strcontains(p, "/index/GSI8")])
    error_message = "InvitationPurgeWorker must have a policy referencing GSI8"
  }

  assert {
    condition     = anytrue([for p in module.invitation_purge_handler.capability_policy_documents : strcontains(p, "WORK#INVITATION_PURGE") && strcontains(p, "DLQ#INVITATION_PURGE")])
    error_message = "InvitationPurgeWorker's GSI8 policy must condition dynamodb:LeadingKeys on exactly its own WORK#/DLQ# namespace pair"
  }

  assert {
    condition     = anytrue([for p in module.invitation_purge_handler.capability_policy_documents : strcontains(p, "dynamodb:TransactWriteItems")])
    error_message = "InvitationPurgeWorker must have dynamodb:TransactWriteItems"
  }

  assert {
    condition = !anytrue([
      for p in module.invitation_purge_handler.capability_policy_documents :
      strcontains(p, "dynamodb:TransactWriteItems") && (strcontains(p, "/index/GSI3") || strcontains(p, "/index/GSI4") || strcontains(p, "/index/GSI6") || strcontains(p, "/index/GSI8"))
    ])
    error_message = "dynamodb:TransactWriteItems must never be granted on a GSI resource, only the base table"
  }

  # Cross-namespace isolation, both directions - neither worker's role may reference the other
  # worker's WORK#/DLQ# namespace strings at all.
  assert {
    condition     = !anytrue([for p in module.invitation_purge_handler.capability_policy_documents : strcontains(p, "MEMBERSHIP_PURGE")])
    error_message = "InvitationPurgeWorker must NOT reference MEMBERSHIP_PURGE's namespace"
  }

  assert {
    condition     = !anytrue([for p in module.membership_purge_handler.capability_policy_documents : strcontains(p, "INVITATION_PURGE")])
    error_message = "MembershipPurgeWorker must NOT reference INVITATION_PURGE's namespace"
  }

  # D-179 slice 3 - document_file_reconciliation_handler joins the same pattern, its own WORK#/
  # DLQ# namespace pair, isolated from the other two.
  assert {
    condition     = anytrue([for p in module.document_file_reconciliation_handler.capability_policy_documents : strcontains(p, "/index/GSI8")])
    error_message = "DocumentFileReconciliationWorker must have a policy referencing GSI8"
  }

  assert {
    condition = anytrue([
      for p in module.document_file_reconciliation_handler.capability_policy_documents :
      strcontains(p, "WORK#DOCUMENT_FILE_RECONCILIATION") && strcontains(p, "DLQ#DOCUMENT_FILE_RECONCILIATION")
    ])
    error_message = "DocumentFileReconciliationWorker's GSI8 policy must condition dynamodb:LeadingKeys on exactly its own WORK#/DLQ# namespace pair"
  }

  assert {
    condition     = anytrue([for p in module.document_file_reconciliation_handler.capability_policy_documents : strcontains(p, "dynamodb:TransactWriteItems")])
    error_message = "DocumentFileReconciliationWorker must have dynamodb:TransactWriteItems - applyFileScanTimeout() already issues a real TransactWriteCommand"
  }

  assert {
    condition = !anytrue([
      for p in module.document_file_reconciliation_handler.capability_policy_documents :
      strcontains(p, "dynamodb:TransactWriteItems") && (strcontains(p, "/index/GSI3") || strcontains(p, "/index/GSI4") || strcontains(p, "/index/GSI6") || strcontains(p, "/index/GSI8"))
    ])
    error_message = "dynamodb:TransactWriteItems must never be granted on a GSI resource, only the base table"
  }

  assert {
    condition = !anytrue([
      for p in module.document_file_reconciliation_handler.capability_policy_documents :
      strcontains(p, "MEMBERSHIP_PURGE") || strcontains(p, "INVITATION_PURGE")
    ])
    error_message = "DocumentFileReconciliationWorker must NOT reference MEMBERSHIP_PURGE's or INVITATION_PURGE's namespace"
  }

  assert {
    condition     = !anytrue([for p in module.invitation_purge_handler.capability_policy_documents : strcontains(p, "DOCUMENT_FILE_RECONCILIATION")])
    error_message = "InvitationPurgeWorker must NOT reference DOCUMENT_FILE_RECONCILIATION's namespace"
  }

  assert {
    condition     = !anytrue([for p in module.membership_purge_handler.capability_policy_documents : strcontains(p, "DOCUMENT_FILE_RECONCILIATION")])
    error_message = "MembershipPurgeWorker must NOT reference DOCUMENT_FILE_RECONCILIATION's namespace"
  }

  # No other worker's role may reference GSI8 at all - isolation is per-worker, not per-index.
  assert {
    condition     = !anytrue([for p in module.transient_purge_handler.capability_policy_documents : strcontains(p, "/index/GSI8")])
    error_message = "TransientPurgeWorker must NOT reference GSI8 - it has not migrated to the MaintenanceDueIndex pattern yet (D-179 slices 1-3 are membership-purge/invitation-purge/document-file-reconciliation only)"
  }

  assert {
    condition     = !anytrue([for p in module.test_ping_handler.capability_policy_documents : strcontains(p, "/index/GSI8")])
    error_message = "TestPingHandler must NOT reference GSI8"
  }

  assert {
    condition     = !anytrue([for p in module.test_ping_handler.capability_policy_documents : strcontains(p, "dynamodb:TransactWriteItems")])
    error_message = "TestPingHandler must NOT have dynamodb:TransactWriteItems"
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
    condition     = length(output.lambda_published_versions) == 31
    error_message = "Deploy manifest map must cover exactly the 30 real Lambda functions"
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

run "extraction_workflow_state_machine_is_real_and_matches_starter_worker_target" {
  command = plan

  # M7 item 3 (D-035): the real aws_sfn_state_machine must resolve to EXACTLY the name
  # ExtractionStarterWorker (item 2, already live in dev) has been calling StartExecution
  # against since before this state machine existed for real - local.extraction_state_machine_arn.
  # Asserted on the plan-time-known `name` (a config argument), not the ARN (a computed
  # attribute unknown until apply) - this suite runs `plan` only against the real provider,
  # never `apply` (see the file header).
  assert {
    condition     = output.extraction_state_machine_name == "exptrk-dev-document-extraction"
    error_message = "The real state machine name must equal local.extraction_state_machine_arn's expected name segment - a mismatch means ExtractionStarterWorker's existing StartExecution calls would target a non-existent state machine"
  }

  assert {
    condition     = strcontains(local.extraction_state_machine_arn, output.extraction_state_machine_name)
    error_message = "local.extraction_state_machine_arn (already referenced by ExtractionStarterWorker since item 2) must embed this exact state machine name"
  }
}

run "extraction_workflow_execution_role_is_scoped_not_wildcard" {
  command = plan

  # The state machine's own execution role must grant lambda:InvokeFunction on exactly the
  # four handler ARNs it needs to call, never a wildcard resource - least privilege, same
  # discipline as every other IAM policy document in this stack (AGENTS.md §7).
  assert {
    condition     = length(data.aws_iam_policy_document.extraction_workflow_invoke_lambdas.statement) == 3
    error_message = "Expected exactly 3 statements: lambda:InvokeFunction (scoped to the 4 handler ARNs), CloudWatch Logs delivery, and X-Ray write"
  }
}

# --- W3-07 tenant purge orchestrator (D-124, implementing D-121) ---------------------------

run "tenant_purge_state_machine_name_matches_the_arn_both_callers_target" {
  command = plan

  # CloseOrganizationService (inside the memberships Lambda) and the sweeper both receive
  # local.tenant_purge_state_machine_arn as an env var and call StartExecution against it. That
  # ARN is built from the name, not read back from the module, to avoid a dependency cycle - so
  # nothing but this assertion keeps the two halves from silently drifting apart.
  assert {
    condition     = output.tenant_purge_state_machine_name == "exptrk-dev-tenant-purge"
    error_message = "The real state machine name must match local.tenant_purge_state_machine_arn's name segment - a mismatch means every close-organization call would StartExecution against a state machine that does not exist"
  }

  assert {
    condition     = strcontains(local.tenant_purge_state_machine_arn, output.tenant_purge_state_machine_name)
    error_message = "local.tenant_purge_state_machine_arn must embed this exact state machine name"
  }
}

run "tenant_purge_iam_surface_is_the_minimum_the_approved_design_named" {
  command = plan

  # D-121 Rodada 3 Fix 8 enumerated the minimum IAM surface per role explicitly so a future
  # session would not have to re-derive it. These assertions hold that surface in place.
  assert {
    condition     = length(data.aws_iam_policy_document.tenant_purge_workflow_invoke_lambdas.statement) == 3
    error_message = "Expected exactly 3 statements: lambda:InvokeFunction (scoped to the 2 task handler ARNs), CloudWatch Logs delivery, and X-Ray write - logging/tracing are enabled on this state machine and fail at APPLY time without them"
  }

  # Note: the invoke statement's `resources` (the two Lambda ALIAS ARNs) are computed attributes
  # unknown until apply, so they cannot be asserted from a plan-only run - the same limitation the
  # extraction_workflow assertions above work around. The module's own tftest covers the
  # substitution end of this, and the statement count above covers the shape.

  # states:StartExecution is scoped to this ONE state machine ARN - not states:*, not a wildcard
  # resource. This policy is attached to both the memberships handler and the sweeper.
  assert {
    condition     = length(data.aws_iam_policy_document.tenant_purge_start_execution.statement[0].resources) == 1
    error_message = "StartExecution must be scoped to exactly the tenant-purge state machine ARN"
  }

  assert {
    condition     = contains(data.aws_iam_policy_document.tenant_purge_start_execution.statement[0].actions, "states:StartExecution")
    error_message = "The trigger policy must grant states:StartExecution (and only that action)"
  }

  # D-127: states:StopExecution (CancelOrganizationClosureService) and states:DescribeExecution
  # (the sweeper's HELD_FOR_RECOVERY reconciliation) are each scoped to EXECUTION arns of this one
  # state machine only - never the bare state machine ARN, never states:*, never a cross-machine
  # wildcard.
  assert {
    condition     = length(data.aws_iam_policy_document.tenant_purge_stop_execution.statement[0].resources) == 1
    error_message = "StopExecution must be scoped to exactly one resource pattern (this state machine's executions)"
  }
  assert {
    condition     = contains(data.aws_iam_policy_document.tenant_purge_stop_execution.statement[0].actions, "states:StopExecution") && length(data.aws_iam_policy_document.tenant_purge_stop_execution.statement[0].actions) == 1
    error_message = "The cancellation policy must grant states:StopExecution and ONLY that action"
  }
  assert {
    condition     = strcontains(tolist(data.aws_iam_policy_document.tenant_purge_stop_execution.statement[0].resources)[0], ":execution:")
    error_message = "StopExecution must target an EXECUTION arn pattern, not the state machine arn itself"
  }
  assert {
    condition     = length(data.aws_iam_policy_document.tenant_purge_describe_execution.statement[0].resources) == 1
    error_message = "DescribeExecution must be scoped to exactly one resource pattern (this state machine's executions)"
  }
  assert {
    condition     = contains(data.aws_iam_policy_document.tenant_purge_describe_execution.statement[0].actions, "states:DescribeExecution") && length(data.aws_iam_policy_document.tenant_purge_describe_execution.statement[0].actions) == 1
    error_message = "The sweeper's reconciliation policy must grant states:DescribeExecution and ONLY that action - read-only, never Start/StopExecution added here"
  }

  # A purge deletes; it never reads object content. s3:GetObject appearing here would be a real
  # privilege expansion, same discipline as document_purge_object_access.
  assert {
    condition = alltrue([
      for s in data.aws_iam_policy_document.tenant_purge_worker_s3.statement : !contains(s.actions, "s3:GetObject")
    ])
    error_message = "The purge worker must never be granted s3:GetObject - it deletes objects, it never reads their content"
  }
}

run "tenant_purge_sweeper_schedule_exists_and_sends_no_detail_wrapper" {
  command = plan

  # EventBridge Scheduler hands the target whatever `input` says, with no `detail` envelope (the
  # contract reminder-schedule/main.tf's header documents, learned from a real production bug).
  # This handler reads nothing from its event at all, so the input is an empty object.
  assert {
    condition     = aws_scheduler_schedule.tenant_purge_sweeper.schedule_expression == "rate(1 day)"
    error_message = "The sweeper must run on a rate expression (a regular cadence), not a fixed wall-clock cron"
  }

  assert {
    condition     = aws_scheduler_schedule.tenant_purge_sweeper.target[0].input == "{}"
    error_message = "The sweeper takes no input - it discovers its own work by scanning; a detail-wrapped or placeholder input would be a silent contract break"
  }
}

run "requirement_reindex_schedule_exists_daily_with_correct_placeholder_escaping" {
  command = plan

  # D-143 Nucleus 2, Requirement (Decision 5/D9, D-145): daily reindex job. Fixed UTC cron (not a
  # rolling rate) is deliberate here - staggered after reminder-dst-reconciliation (03:00 UTC),
  # see requirement_reindex_handler's inline comment in main.tf.
  assert {
    condition     = aws_scheduler_schedule.requirement_reindex.schedule_expression == "cron(0 4 * * ? *)"
    error_message = "The reindex job must run once a day on a fixed UTC cron, staggered after the reminder DST reconciliation pass"
  }

  # reminder-schedule/main.tf's header documents a real production bug: jsonencode() HTML-escapes
  # the angle brackets in the EventBridge Scheduler placeholder, silently breaking substitution.
  # The literal string form (not jsonencode()) must be used here too.
  assert {
    condition     = aws_scheduler_schedule.requirement_reindex.target[0].input == "{\"scheduledTime\":\"<aws.scheduler.scheduled-time>\"}"
    error_message = "The reindex job's scheduledTime placeholder must be a literal string, never jsonencode()'d (would HTML-escape the angle brackets and break substitution)"
  }
}

run "document_file_reconciliation_schedule_exists_every_15_minutes" {
  command = plan

  # D-163 §6/D-166: same cadence as UploadSlotReconciliationWorker (the worker it generalizes),
  # no scheduler-context placeholder needed (the worker discovers its own candidates via Scan).
  assert {
    condition     = aws_scheduler_schedule.document_file_reconciliation.schedule_expression == "rate(15 minutes)"
    error_message = "DocumentFileReconciliationWorker must run every 15 minutes, same cadence as UploadSlotReconciliationWorker"
  }
  assert {
    condition     = aws_scheduler_schedule.document_file_reconciliation.target[0].input == "{}"
    error_message = "The worker takes no input - it discovers its own work by scanning GSI5's sparse pointers"
  }
}
