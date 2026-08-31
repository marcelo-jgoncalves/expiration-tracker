output "table_name" {
  value = module.table.table_name
}

output "user_pool_id" {
  value = module.auth.user_pool_id
}

output "api_endpoint" {
  value = module.api.api_endpoint
}

output "dispatch_queue_url" {
  value = module.dispatch_queue.queue_url
}

output "dispatch_queue_dlq_url" {
  value = module.dispatch_queue.dlq_url
}

output "lambda_function_names" {
  value = [
    module.test_ping_handler.function_name,
    module.items_handler.function_name,
    module.reminders_handler.function_name,
    module.reminder_producer.function_name,
    module.reminder_dispatch.function_name,
    module.reminder_reconciliation.function_name,
    module.reminder_materialization_trigger.function_name,
    module.dispatch_outbox_relay.function_name,
    module.outbox_sweeper.function_name,
    module.notification_router.function_name,
    module.notification_email_outbox_relay.function_name,
    module.email_delivery.function_name,
    module.ses_callback.function_name,
    module.notifications_handler.function_name,
    module.documents_handler.function_name,
    module.upload_finalizer_handler.function_name,
    module.malware_result_handler.function_name,
    module.upload_slot_reconciliation_handler.function_name,
    module.parser_sandbox.function_name,
    module.subjects_handler.function_name,
    module.guest_documents_handler.function_name,
    module.document_chasing_dispatch_handler.function_name,
    module.imports_handler.function_name,
    module.import_parse_handler.function_name,
    module.import_commit_handler.function_name,
    module.bff_handler.function_name,
    module.extraction_starter_handler.function_name,
    module.textract_task_handler.function_name,
    module.pdf_parser_task_handler.function_name,
    module.bedrock_extraction_task_handler.function_name,
    module.extraction_validation_task_handler.function_name,
    module.document_purge_handler.function_name,
  ]
}

# Rollback design entrega 1 (docs/architecture/reviews/rollback-mechanism-design/
# codex-round2-final-design.md): `cd.yml` reads this map to build the deploy manifest
# (function_name -> published version + live alias name) - not sensitive, no PII/secrets.
output "lambda_published_versions" {
  value = {
    (module.test_ping_handler.function_name)                  = module.test_ping_handler.published_version
    (module.items_handler.function_name)                      = module.items_handler.published_version
    (module.reminders_handler.function_name)                  = module.reminders_handler.published_version
    (module.reminder_producer.function_name)                  = module.reminder_producer.published_version
    (module.reminder_dispatch.function_name)                  = module.reminder_dispatch.published_version
    (module.reminder_reconciliation.function_name)            = module.reminder_reconciliation.published_version
    (module.reminder_materialization_trigger.function_name)   = module.reminder_materialization_trigger.published_version
    (module.dispatch_outbox_relay.function_name)              = module.dispatch_outbox_relay.published_version
    (module.outbox_sweeper.function_name)                     = module.outbox_sweeper.published_version
    (module.notification_router.function_name)                = module.notification_router.published_version
    (module.notification_email_outbox_relay.function_name)    = module.notification_email_outbox_relay.published_version
    (module.email_delivery.function_name)                     = module.email_delivery.published_version
    (module.ses_callback.function_name)                       = module.ses_callback.published_version
    (module.notifications_handler.function_name)              = module.notifications_handler.published_version
    (module.documents_handler.function_name)                  = module.documents_handler.published_version
    (module.upload_finalizer_handler.function_name)           = module.upload_finalizer_handler.published_version
    (module.malware_result_handler.function_name)             = module.malware_result_handler.published_version
    (module.upload_slot_reconciliation_handler.function_name) = module.upload_slot_reconciliation_handler.published_version
    (module.parser_sandbox.function_name)                     = module.parser_sandbox.published_version
    (module.subjects_handler.function_name)                   = module.subjects_handler.published_version
    (module.guest_documents_handler.function_name)            = module.guest_documents_handler.published_version
    (module.document_chasing_dispatch_handler.function_name)  = module.document_chasing_dispatch_handler.published_version
    (module.imports_handler.function_name)                    = module.imports_handler.published_version
    (module.import_parse_handler.function_name)               = module.import_parse_handler.published_version
    (module.import_commit_handler.function_name)              = module.import_commit_handler.published_version
    (module.bff_handler.function_name)                        = module.bff_handler.published_version
    (module.extraction_starter_handler.function_name)         = module.extraction_starter_handler.published_version
    (module.textract_task_handler.function_name)              = module.textract_task_handler.published_version
    (module.pdf_parser_task_handler.function_name)            = module.pdf_parser_task_handler.published_version
    (module.bedrock_extraction_task_handler.function_name)    = module.bedrock_extraction_task_handler.published_version
    (module.extraction_validation_task_handler.function_name) = module.extraction_validation_task_handler.published_version
  }
}

output "textract_task_handler_function_arn" {
  description = "Live-alias ARN of TextractTaskHandler - item 3's infra/modules/extraction-workflow module needs this once it's finally instantiated (currently still uninstantiated from infra/main.tf, see NEXT_SESSION_PROMPT.md)."
  value       = local.textract_task_handler_function_arn
}

output "pdf_parser_task_handler_function_arn" {
  description = "Live-alias ARN of PdfParserTaskHandler (M7 item 5, D-035) - item 3's infra/modules/extraction-workflow module needs this once it's finally instantiated (currently still uninstantiated from infra/main.tf, see NEXT_SESSION_PROMPT.md)."
  value       = local.pdf_parser_task_handler_function_arn
}

output "bedrock_extraction_task_handler_function_arn" {
  description = "Live-alias ARN of BedrockExtractionTaskHandler (M7 item 6, D-035 §1.9/§1.11) - item 3's infra/modules/extraction-workflow module needs this once it's finally instantiated (currently still uninstantiated from infra/main.tf, see NEXT_SESSION_PROMPT.md)."
  value       = local.bedrock_extraction_task_handler_function_arn
}

output "extraction_validation_task_handler_function_arn" {
  description = "Live-alias ARN of ExtractionValidationTaskHandler (M7 item 7, D-035 §2/§3) - the fourth and last Lambda item 3's infra/modules/extraction-workflow module needs. With this output, ALL FOUR ASL-referenced functions exist for real - item 3 (instantiating the actual aws_sfn_state_machine) is unblocked, see NEXT_SESSION_PROMPT.md."
  value       = local.extraction_validation_task_handler_function_arn
}

output "extraction_state_machine_arn" {
  description = "The real document-extraction Step Functions Standard state machine ARN (M7 item 3). MUST equal local.extraction_state_machine_arn - ExtractionStarterWorker (item 2, already live in dev) has been calling StartExecution against that deterministic name since before this state machine existed for real."
  value       = module.extraction_workflow.state_machine_arn
}

output "extraction_state_machine_name" {
  description = "Plan-time-known name of the state machine (unlike its ARN, a computed attribute only known after apply) - used by terraform test to assert the name matches local.extraction_state_machine_arn's expected name segment without needing command = apply against the real provider."
  value       = module.extraction_workflow.state_machine_name
}

output "tenant_purge_state_machine_name" {
  description = "Plan-time-known name of the W3-07 tenant-purge state machine (D-124). Must match local.tenant_purge_state_machine_arn's name segment - that deterministic ARN is what the memberships handler (CloseOrganizationService) and the sweeper both receive as an env var and call StartExecution against."
  value       = module.tenant_purge_workflow.state_machine_name
}

output "bff_api_endpoint" {
  description = "The BFF's own dedicated HTTP API endpoint (D-053/D-054) - in production this sits behind CloudFront at the same origin as the SPA under the /bff/* path, never called directly by the browser."
  value       = module.bff_api.api_endpoint
}

output "bff_session_table_name" {
  value = module.bff_session_table.table_name
}

output "deploy_manifest_bucket_name" {
  value = module.deploy_manifests.bucket_name
}

output "document_quarantine_bucket_name" {
  value = module.document_buckets.quarantine_bucket_name
}

output "document_clean_bucket_name" {
  value = module.document_buckets.clean_bucket_name
}

output "malware_protection_enabled" {
  value = module.document_malware_protection.enabled
}

output "import_bucket_name" {
  value = module.import_bucket.bucket_name
}

# ADR-0011: cd.yml reads these three to sync the frontend build and invalidate index.html
# after every deploy (etapa 3/4 of NEXT_SESSION_PROMPT.md's plan).
output "spa_bucket_name" {
  value = module.spa_hosting.bucket_name
}

output "spa_distribution_id" {
  value = module.spa_hosting.distribution_id
}

output "spa_distribution_domain_name" {
  description = "The SPA's real origin (no custom domain yet - see the comment on module.spa_hosting in main.tf). This is what var.app_origin should be set to via -var after the first apply."
  value       = module.spa_hosting.distribution_domain_name
}
